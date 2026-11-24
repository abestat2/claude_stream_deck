import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	instances: [] as unknown[],
}));

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {
		get actions(): unknown[] {
			return hoisted.instances;
		}
	}
	return {
		default: { logger: { error: vi.fn(), info: vi.fn() } },
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

import { Connection } from "../../src/actions/connection";
import { hookServerStatus } from "../../src/server/hook-server";
import { SessionStore } from "../../src/state/sessions";
import type { UsageService } from "../../src/usage/client";
import { decodeDataUri, textElements } from "../helpers/svg";
import { xmlProblem } from "../helpers/xml";

type FakeInstance = {
	id: string;
	isKey: () => boolean;
	isDial: () => boolean;
	setImage: ReturnType<typeof vi.fn>;
	setFeedback: ReturnType<typeof vi.fn>;
};

function instance(kind: "key" | "dial", id: string): FakeInstance {
	return {
		id,
		isKey: () => kind === "key",
		isDial: () => kind === "dial",
		setImage: vi.fn(),
		setFeedback: vi.fn(),
	};
}

type FakeUsageState = { windows: Record<string, unknown>; fetchedAt: Date | undefined; error: string | undefined };

/** Event emitter with a `state()` method; performs no network or credential access. */
class FakeUsage extends EventEmitter {
	current: FakeUsageState = { windows: {}, fetchedAt: undefined, error: undefined };
	state(): FakeUsageState {
		return this.current;
	}
	set(next: Partial<FakeUsageState>): void {
		this.current = { ...this.current, ...next };
		this.emit("change", this.current);
	}
}

const REFRESH_MS = 5_000;

describe("Connection", () => {
	let store: SessionStore;
	let usage: FakeUsage;
	let handler: Connection;
	let k: FakeInstance;
	let d: FakeInstance;

	const hook = (name: string, session = "s1") => store.handle({ hook_event_name: name, session_id: session });
	const svgOf = () => decodeDataUri(String(k.setImage.mock.calls.at(-1)?.[0]));
	/** Row values keyed by row label from the last drawing. */
	const rows = () => {
		const t = textElements(svgOf()).slice(1);
		const result: Record<string, string> = {};
		for (let i = 0; i + 1 < t.length; i += 2) result[t[i] as string] = t[i + 1] as string;
		return result;
	};
	/** Interval timers owned by the action: pending fake timers; the store sweep is not started. */
	const actionTimers = () => vi.getTimerCount();
	const appear = () => handler.onWillAppear({ action: k } as never);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		hookServerStatus.listening = true;
		hookServerStatus.error = undefined;
		store = new SessionStore();
		usage = new FakeUsage();
		k = instance("key", "k1");
		d = instance("dial", "d1");
		hoisted.instances.length = 0;
		hoisted.instances.push(k, d);
		handler = new Connection(store, usage as unknown as UsageService);
	});

	afterEach(() => {
		store.stop();
		hookServerStatus.listening = false;
		hookServerStatus.error = undefined;
		vi.useRealTimers();
	});

	describe("lifecycle", () => {
		it("draws a well-formed SVG data URI on appear", () => {
			appear();
			expect(k.setImage).toHaveBeenCalledTimes(1);
			const uri = String(k.setImage.mock.calls[0]?.[0]);
			expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(xmlProblem(decodeDataUri(uri))).toBe("");
		});

		it("starts one interval on appear and redraws every 5000 ms", () => {
			expect(actionTimers()).toBe(0);
			appear();
			expect(actionTimers()).toBe(1);
			k.setImage.mockClear();
			vi.advanceTimersByTime(REFRESH_MS - 1);
			expect(k.setImage).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(k.setImage).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(REFRESH_MS * 2);
			expect(k.setImage).toHaveBeenCalledTimes(3);
		});

		it("does not start a second interval when another instance appears", () => {
			appear();
			handler.onWillAppear({ action: instance("key", "k2") } as never);
			expect(actionTimers()).toBe(1);
		});

		it("keeps the interval until the last visible instance disappears", () => {
			appear();
			handler.onWillAppear({ action: instance("key", "k2") } as never);
			handler.onWillDisappear();
			expect(actionTimers()).toBe(1);
			k.setImage.mockClear();
			vi.advanceTimersByTime(REFRESH_MS);
			expect(k.setImage).toHaveBeenCalledTimes(1);
			handler.onWillDisappear();
			expect(actionTimers()).toBe(0);
			k.setImage.mockClear();
			vi.advanceTimersByTime(REFRESH_MS * 3);
			expect(k.setImage).not.toHaveBeenCalled();
		});

		it("starts a new interval when an instance appears after all disappeared", () => {
			appear();
			handler.onWillDisappear();
			expect(actionTimers()).toBe(0);
			appear();
			expect(actionTimers()).toBe(1);
		});

		it("tolerates a disappear without a matching appear", () => {
			handler.onWillDisappear();
			handler.onWillDisappear();
			appear();
			expect(actionTimers()).toBe(1);
			handler.onWillDisappear();
			expect(actionTimers()).toBe(0);
		});

		it("redraws on store change events", () => {
			appear();
			k.setImage.mockClear();
			hook("SessionStart");
			expect(k.setImage).toHaveBeenCalledTimes(1);
		});

		it("redraws on usage change events", () => {
			appear();
			k.setImage.mockClear();
			usage.set({ error: "offline" });
			expect(k.setImage).toHaveBeenCalledTimes(1);
			expect(rows().USAGE).toBe("offline");
		});

		it("draws key instances only", () => {
			appear();
			hook("SessionStart");
			usage.set({ error: "x" });
			vi.advanceTimersByTime(REFRESH_MS);
			expect(d.setImage).not.toHaveBeenCalled();
			expect(d.setFeedback).not.toHaveBeenCalled();
		});

		it("draws every key instance", () => {
			const k2 = instance("key", "k2");
			hoisted.instances.push(k2);
			appear();
			expect(k2.setImage).toHaveBeenCalledTimes(1);
			expect(k2.setImage.mock.calls[0]?.[0]).toBe(k.setImage.mock.calls[0]?.[0]);
		});
	});

	describe("hooks row", () => {
		it("shows none yet when listening and no event has arrived", () => {
			appear();
			expect(rows().HOOKS).toBe("none yet");
		});

		it("shows starting when the server is not listening", () => {
			hookServerStatus.listening = false;
			appear();
			expect(rows().HOOKS).toBe("starting");
		});

		it("shows port busy when the server has an error, taking precedence over listening", () => {
			hookServerStatus.error = "port in use";
			appear();
			expect(rows().HOOKS).toBe("port busy");
			hookServerStatus.listening = false;
			vi.advanceTimersByTime(REFRESH_MS);
			expect(rows().HOOKS).toBe("port busy");
		});

		it("shows the time since the last hook event and advances with time", () => {
			appear();
			hook("SessionStart");
			expect(rows().HOOKS).toBe("0s ago");
			vi.advanceTimersByTime(30_000);
			expect(rows().HOOKS).toBe("30s ago");
			vi.advanceTimersByTime(90_000);
			expect(rows().HOOKS).toBe("2m ago");
			vi.advanceTimersByTime(60 * 60_000);
			expect(rows().HOOKS).toBe("1h ago");
		});

		it("resets the elapsed time on a new event", () => {
			appear();
			hook("SessionStart");
			vi.advanceTimersByTime(40_000);
			hook("PostToolUse");
			expect(rows().HOOKS).toBe("0s ago");
		});

		it("follows changes to the server status on the next redraw", () => {
			appear();
			hookServerStatus.listening = false;
			vi.advanceTimersByTime(REFRESH_MS);
			expect(rows().HOOKS).toBe("starting");
		});
	});

	describe("status line row", () => {
		it("shows none yet before any status line update", () => {
			appear();
			expect(rows().STATUS).toBe("none yet");
		});

		it("shows the time since the last status line update", () => {
			appear();
			store.handleStatus({ session_id: "s1" });
			expect(rows().STATUS).toBe("0s ago");
			vi.advanceTimersByTime(45_000);
			expect(rows().STATUS).toBe("45s ago");
		});

		it("is independent of the hook event time", () => {
			appear();
			hook("SessionStart");
			vi.advanceTimersByTime(20_000);
			store.handleStatus({ session_id: "s1" });
			vi.advanceTimersByTime(10_000);
			expect(rows().HOOKS).toBe("30s ago");
			expect(rows().STATUS).toBe("10s ago");
		});
	});

	describe("sessions row", () => {
		it("shows the number of tracked sessions", () => {
			appear();
			expect(rows().SESSIONS).toBe("0");
			hook("SessionStart", "s1");
			hook("SessionStart", "s2");
			expect(rows().SESSIONS).toBe("2");
			hook("SessionEnd", "s1");
			expect(rows().SESSIONS).toBe("1");
		});
	});

	describe("usage row", () => {
		it("shows off when there is neither a reading nor an error", () => {
			appear();
			expect(rows().USAGE).toBe("off");
		});

		it("shows ok when a reading exists", () => {
			appear();
			usage.set({ fetchedAt: new Date() });
			expect(rows().USAGE).toBe("ok");
		});

		it("shows the error text when an error is set", () => {
			appear();
			usage.set({ error: "unauthorized" });
			expect(rows().USAGE).toBe("unauthorized");
		});

		it("prefers the error over a reading", () => {
			appear();
			usage.set({ fetchedAt: new Date(), error: "rate limited" });
			expect(rows().USAGE).toBe("rate limited");
		});
	});

	describe("with a UsageService", () => {
		it("shows ok after plan limits arrive from the status line", async () => {
			const { UsageService } = await import("../../src/usage/client");
			const real = new UsageService();
			const connection = new Connection(store, real);
			connection.onWillAppear({ action: k } as never);
			expect(rows().USAGE).toBe("off");
			real.ingestStatusLine({ five_hour: { used_percentage: 10 } });
			expect(rows().USAGE).toBe("ok");
			connection.onWillDisappear();
		});
	});
});
