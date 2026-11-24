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
		default: { logger: { error: vi.fn() } },
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

import { ClaudeStatus } from "../../src/actions/claude-status";
import { AlertConfig } from "../../src/alerts/config";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, fillOf, textElements } from "../helpers/svg";
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

const FRAME_MS = 180;
const ESCALATED = "#e5534b";
const WARNING = "#ffb454";
const CLOCK_COLOR = "#f1ece4";

describe("ClaudeStatus", () => {
	let store: SessionStore;
	let alerts: AlertConfig;
	let handler: ClaudeStatus;
	let k: FakeInstance;
	let d: FakeInstance;
	let unrefs: ReturnType<typeof vi.fn>[];

	const hook = (name: string, session = "s1", extra: Record<string, unknown> = {}) =>
		store.handle({ hook_event_name: name, session_id: session, ...extra });
	const permission = (session = "s1") => hook("PermissionRequest", session, { tool_name: "Bash", tool_input: { command: "ls" } });
	const svgOf = (target: FakeInstance = k) => decodeDataUri(String(target.setImage.mock.calls.at(-1)?.[0]));
	const texts = () => textElements(svgOf());
	const clock = () => texts().find((t) => /^(\d+:)?\d+:\d\d$/.test(t) || /^\d+m$/.test(t));
	const shapes = (svg: string) => svg.replace(/<text [^>]*>[^<]*<\/text>/g, "");
	const advance = (ms: number) => vi.advanceTimersByTime(ms);
	/** Animation timers owned by the action: pending fake timers; the store sweep is not started. */
	const animationTimers = () => vi.getTimerCount();

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		unrefs = [];
		const realSetInterval = globalThis.setInterval;
		vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
			const handle = realSetInterval(fn, ms) as NodeJS.Timeout;
			const unref = vi.fn(handle.unref.bind(handle));
			handle.unref = unref as never;
			unrefs.push(unref);
			return handle;
		}) as never);

		store = new SessionStore();
		alerts = new AlertConfig();
		k = instance("key", "k1");
		d = instance("dial", "d1");
		hoisted.instances.length = 0;
		hoisted.instances.push(k, d);
		handler = new ClaudeStatus(store, alerts);
		unrefs.length = 0;
	});

	afterEach(() => {
		store.stop();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("drawing", () => {
		it("draws on appear as a well-formed SVG data URI", () => {
			handler.onWillAppear({ action: k } as never);
			expect(k.setImage).toHaveBeenCalledTimes(1);
			const uri = String(k.setImage.mock.calls[0]?.[0]);
			expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(xmlProblem(decodeDataUri(uri))).toBe("");
			expect(texts()).toEqual(["idle"]);
		});

		it("redraws when the store emits change", () => {
			handler.onWillAppear({ action: k } as never);
			hook("PostToolUse");
			expect(texts()).toContain("working");
			hook("Stop");
			expect(texts()).toContain("done");
		});

		it("redraws when the store emits detail", () => {
			handler.onWillAppear({ action: k } as never);
			hook("SessionStart");
			k.setImage.mockClear();
			store.emit("detail");
			expect(k.setImage).toHaveBeenCalledTimes(1);
		});

		it("draws every key instance and ignores non-key instances", () => {
			const k2 = instance("key", "k2");
			hoisted.instances.push(k2);
			hook("UserPromptSubmit");
			expect(k.setImage).toHaveBeenCalled();
			expect(k2.setImage).toHaveBeenCalled();
			expect(svgOf(k2)).toBe(svgOf(k));
			expect(d.setImage).not.toHaveBeenCalled();
			expect(d.setFeedback).not.toHaveBeenCalled();
		});

		it("shows the state label for each overall state", () => {
			hook("SessionStart");
			expect(texts()).toEqual(["idle"]);
			hook("UserPromptSubmit");
			expect(texts()).toContain("working");
			permission();
			expect(texts()).toContain("NEEDS YOU");
			hook("Stop");
			expect(texts()).toContain("done");
		});
	});

	describe("animation timer", () => {
		it("does not start while idle", () => {
			handler.onWillAppear({ action: k } as never);
			hook("SessionStart");
			expect(animationTimers()).toBe(0);
			const calls = k.setImage.mock.calls.length;
			advance(5 * FRAME_MS);
			expect(k.setImage).toHaveBeenCalledTimes(calls);
		});

		it("starts at 180 ms when the overall state becomes working", () => {
			hook("UserPromptSubmit");
			expect(animationTimers()).toBe(1);
			expect(vi.mocked(globalThis.setInterval)).toHaveBeenCalledWith(expect.any(Function), FRAME_MS);
			k.setImage.mockClear();
			advance(FRAME_MS - 1);
			expect(k.setImage).not.toHaveBeenCalled();
			advance(1);
			expect(k.setImage).toHaveBeenCalledTimes(1);
		});

		it("starts when the overall state becomes attention", () => {
			permission();
			expect(animationTimers()).toBe(1);
			k.setImage.mockClear();
			advance(3 * FRAME_MS);
			expect(k.setImage).toHaveBeenCalledTimes(3);
		});

		it("unrefs the timer so it does not keep the process alive", () => {
			hook("UserPromptSubmit");
			expect(unrefs).toHaveLength(1);
			expect(unrefs[0]).toHaveBeenCalled();
		});

		it("draws a different frame on each tick", () => {
			hook("UserPromptSubmit");
			const frames = [shapes(svgOf())];
			for (let i = 0; i < 4; i++) {
				advance(FRAME_MS);
				frames.push(shapes(svgOf()));
			}
			expect(frames[1]).not.toBe(frames[0]);
			expect(frames[2]).not.toBe(frames[1]);
			expect(frames[3]).not.toBe(frames[2]);
			expect(frames[3]).not.toBe(frames[0]);
		});

		it("repeats the walk cycle after eight frames", () => {
			hook("UserPromptSubmit");
			const first = shapes(svgOf());
			advance(8 * FRAME_MS);
			expect(shapes(svgOf())).toBe(first);
		});

		it("animates the attention character between two poses", () => {
			permission();
			const a = shapes(svgOf());
			advance(FRAME_MS);
			const b = shapes(svgOf());
			expect(b).not.toBe(a);
			advance(FRAME_MS);
			expect(shapes(svgOf())).toBe(a);
		});

		it("does not start a second timer when the state moves between animated states", () => {
			hook("UserPromptSubmit");
			permission();
			hook("PostToolUse");
			hook("SubagentStart", "s2", { agent_id: "a" });
			expect(animationTimers()).toBe(1);
			expect(vi.mocked(globalThis.setInterval)).toHaveBeenCalledTimes(1);
		});

		it("does not start a second timer on repeated change events while animated", () => {
			hook("UserPromptSubmit");
			store.emit("detail");
			store.emit("detail");
			expect(animationTimers()).toBe(1);
			k.setImage.mockClear();
			advance(FRAME_MS);
			expect(k.setImage).toHaveBeenCalledTimes(1);
		});

		it("stops, resets to frame 0, and redraws once when the state becomes done", () => {
			hook("UserPromptSubmit");
			advance(3 * FRAME_MS);
			k.setImage.mockClear();
			hook("Stop");
			expect(animationTimers()).toBe(0);
			expect(texts()).toContain("done");
			const calls = k.setImage.mock.calls.length;
			expect(calls).toBeGreaterThanOrEqual(1);
			advance(10 * FRAME_MS);
			expect(k.setImage).toHaveBeenCalledTimes(calls);
		});

		it("stops when the state becomes idle", () => {
			hook("UserPromptSubmit");
			hook("SessionEnd");
			expect(animationTimers()).toBe(0);
			expect(texts()).toEqual(["idle"]);
		});

		it("restarts at frame 0 after a stop", () => {
			hook("UserPromptSubmit");
			const first = shapes(svgOf());
			advance(3 * FRAME_MS);
			expect(shapes(svgOf())).not.toBe(first);
			hook("Stop");
			hook("UserPromptSubmit");
			expect(animationTimers()).toBe(1);
			expect(shapes(svgOf())).toBe(first);
		});
	});

	describe("working clock", () => {
		it("shows the turn time as m:ss and advances with time", () => {
			hook("UserPromptSubmit");
			expect(clock()).toBe("0:00");
			advance(5_000);
			expect(clock()).toBe("0:04");
			advance(65_000);
			expect(clock()).toBe("1:09");
		});

		it("uses the longest running turn across sessions", () => {
			hook("UserPromptSubmit", "s1");
			advance(30_000);
			hook("UserPromptSubmit", "s2");
			advance(60_000);
			expect(clock()).toBe("1:30");
		});

		it("styles the clock text", () => {
			hook("UserPromptSubmit");
			expect(fillOf(svgOf(), "0:00")).toBe(CLOCK_COLOR);
		});

		it("shows no turn clock while a session works only through a subagent", () => {
			hook("SubagentStart", "s1", { agent_id: "a" });
			expect(texts()).toContain("working");
			expect(clock()).toBeUndefined();
		});
	});

	describe("attention wait", () => {
		it("shows no wait before 60 seconds", () => {
			permission();
			expect(clock()).toBeUndefined();
			advance(59_000);
			expect(clock()).toBeUndefined();
		});

		it("shows whole minutes from 60 seconds", () => {
			permission();
			advance(61_000);
			expect(clock()).toBe("1m");
			advance(58_000);
			expect(clock()).toBe("1m");
			advance(2_000);
			expect(clock()).toBe("2m");
		});

		it("uses the longest wait across sessions", () => {
			permission("s1");
			advance(120_000);
			permission("s2");
			advance(60_000);
			expect(clock()).toBe("3m");
		});

		it("does not show the turn clock while attention is the overall state", () => {
			hook("UserPromptSubmit", "s1");
			permission("s2");
			advance(30_000);
			expect(texts()).toContain("NEEDS YOU");
			expect(texts().some((t) => t.includes(":"))).toBe(false);
		});
	});

	describe("escalation", () => {
		it("keeps the amber alert before the escalation time and turns it red at it", () => {
			permission();
			advance(179_000);
			expect(fillOf(svgOf(), "!")).toBe(WARNING);
			expect(fillOf(svgOf(), "NEEDS YOU")).toBe(WARNING);
			advance(1_000);
			expect(fillOf(svgOf(), "!")).toBe(ESCALATED);
			expect(fillOf(svgOf(), "NEEDS YOU")).toBe(ESCALATED);
		});

		it("stays escalated as the wait continues", () => {
			permission();
			advance(10 * 60_000);
			expect(fillOf(svgOf(), "!")).toBe(ESCALATED);
		});

		it("never escalates when escalateMinutes is 0", () => {
			alerts.set({ escalateMinutes: 0 });
			permission();
			advance(30 * 60_000);
			expect(fillOf(svgOf(), "!")).toBe(WARNING);
			expect(fillOf(svgOf(), "NEEDS YOU")).toBe(WARNING);
		});

		it("uses the configured number of minutes", () => {
			alerts.set({ escalateMinutes: 1 });
			permission();
			advance(59_000);
			expect(fillOf(svgOf(), "!")).toBe(WARNING);
			advance(1_180);
			expect(fillOf(svgOf(), "!")).toBe(ESCALATED);
		});

		it("applies a configuration change on the next draw", () => {
			permission();
			advance(5 * 60_000);
			expect(fillOf(svgOf(), "!")).toBe(ESCALATED);
			alerts.set({ escalateMinutes: 0 });
			advance(FRAME_MS);
			expect(fillOf(svgOf(), "!")).toBe(WARNING);
			alerts.set({ escalateMinutes: 10 });
			advance(FRAME_MS);
			expect(fillOf(svgOf(), "!")).toBe(WARNING);
			alerts.set({ escalateMinutes: 5 });
			advance(FRAME_MS);
			expect(fillOf(svgOf(), "!")).toBe(ESCALATED);
		});

		it("escalates on the longest wait across sessions", () => {
			permission("s1");
			advance(150_000);
			permission("s2");
			advance(30_000);
			expect(fillOf(svgOf(), "!")).toBe(ESCALATED);
		});

		it("does not mark a working state as escalated", () => {
			hook("UserPromptSubmit");
			advance(10 * 60_000 - 1000);
			expect(svgOf()).not.toContain(ESCALATED);
		});

		it("clears the escalation once the session is no longer waiting", () => {
			permission();
			advance(5 * 60_000);
			hook("PostToolUse");
			expect(svgOf()).not.toContain(ESCALATED);
		});
	});

	describe("subagents", () => {
		it("shows the agent count while subagents run", () => {
			hook("UserPromptSubmit");
			expect(texts()).not.toContain("1 agent");
			hook("SubagentStart", "s1", { agent_id: "a1" });
			expect(texts()).toContain("1 agent");
			hook("SubagentStart", "s1", { agent_id: "a2" });
			expect(texts()).toContain("2 agents");
		});

		it("removes the agent count when subagents stop", () => {
			hook("UserPromptSubmit");
			hook("SubagentStart", "s1", { agent_id: "a1" });
			hook("SubagentStop", "s1", { agent_id: "a1" });
			expect(texts().some((t) => t.includes("agent"))).toBe(false);
		});
	});
});
