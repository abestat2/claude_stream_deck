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
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

import { Usage } from "../../src/actions/usage";
import type { UsageService, UsageState } from "../../src/usage/client";
import { decodeDataUri, textElements } from "../helpers/svg";

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

type Settings = { first?: string; second?: string };

class FakeService extends EventEmitter {
	current: UsageState = { windows: {}, fetchedAt: undefined, error: undefined };
	refresh = vi.fn().mockResolvedValue(undefined);
	paceByWindow: Record<string, unknown> = {};
	state(): UsageState {
		return this.current;
	}
	pace(): Record<string, unknown> {
		return this.paceByWindow;
	}
}

const NOW = new Date("2026-01-01T00:00:00Z");
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const reading = (error: UsageState["error"] = undefined): UsageState => ({
	windows: {
		session: { percent: 37.4, resetsAt: inMinutes(134) },
		week: { percent: 81, resetsAt: inMinutes(3 * 24 * 60 + 4 * 60) },
		sonnet: { percent: 5, resetsAt: undefined },
	},
	fetchedAt: NOW.getTime(),
	error,
});

describe("Usage", () => {
	let service: FakeService;
	let handler: Usage;
	let k: FakeInstance;
	let d: FakeInstance;
	let handles: { unref: ReturnType<typeof vi.fn> }[];

	const appear = (target: FakeInstance, settings: Settings = {}) => handler.onWillAppear({ action: target, payload: { settings } } as never);
	const disappear = (target: FakeInstance) => handler.onWillDisappear({ action: target, payload: { settings: {} } } as never);
	const keySvg = (target = k) => decodeDataUri(String(target.setImage.mock.calls.at(-1)?.[0]));
	const keyTexts = (target = k) => textElements(keySvg(target));
	const dialSvg = (target = d) => decodeDataUri(String(target.setFeedback.mock.calls.at(-1)?.[0].canvas));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const real = globalThis.setInterval;
		handles = [];
		vi.spyOn(globalThis, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
			const handle = real(...args);
			vi.spyOn(handle, "unref");
			handles.push(handle as never);
			return handle;
		}) as never);
		service = new FakeService();
		k = instance("key", "k1");
		d = instance("dial", "d1");
		hoisted.instances.length = 0;
		hoisted.instances.push(k, d);
		handler = new Usage(service as unknown as UsageService);
	});

	afterEach(() => {
		disappear(k);
		disappear(d);
		vi.clearAllTimers();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("refresh interval", () => {
		it("requests a refresh once and starts a 30 second interval when the first instance appears", () => {
			appear(k);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			expect(service.refresh).toHaveBeenCalledWith();
			expect(setInterval).toHaveBeenCalledTimes(1);
			expect(vi.mocked(setInterval).mock.calls[0]?.[1]).toBe(30_000);
		});

		it("refreshes and redraws on every tick", () => {
			appear(k);
			service.refresh.mockClear();
			k.setImage.mockClear();
			vi.advanceTimersByTime(29_999);
			expect(service.refresh).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			expect(service.refresh).toHaveBeenLastCalledWith();
			expect(k.setImage).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(60_000);
			expect(service.refresh).toHaveBeenCalledTimes(3);
			expect(k.setImage).toHaveBeenCalledTimes(3);
		});

		it("unrefs the interval handle", () => {
			appear(k);
			expect(handles).toHaveLength(1);
			expect(handles[0]?.unref).toHaveBeenCalledTimes(1);
		});

		it("does not start a second interval or an extra immediate refresh for a second instance", () => {
			appear(k);
			appear(d);
			expect(setInterval).toHaveBeenCalledTimes(1);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			service.refresh.mockClear();
			vi.advanceTimersByTime(30_000);
			expect(service.refresh).toHaveBeenCalledTimes(1);
		});

		it("keeps the interval while another instance is visible", () => {
			appear(k);
			appear(d);
			disappear(k);
			service.refresh.mockClear();
			vi.advanceTimersByTime(30_000);
			expect(service.refresh).toHaveBeenCalledTimes(1);
		});

		it("stops the interval when the last instance disappears", () => {
			appear(k);
			appear(d);
			disappear(k);
			disappear(d);
			service.refresh.mockClear();
			vi.advanceTimersByTime(120_000);
			expect(service.refresh).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		});

		it("restarts with an immediate refresh when an instance appears again", () => {
			appear(k);
			disappear(k);
			service.refresh.mockClear();
			appear(k);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			expect(setInterval).toHaveBeenCalledTimes(2);
			vi.advanceTimersByTime(30_000);
			expect(service.refresh).toHaveBeenCalledTimes(2);
		});

		it("ignores a disappear event for an instance that never appeared", () => {
			appear(k);
			disappear(d);
			service.refresh.mockClear();
			vi.advanceTimersByTime(30_000);
			expect(service.refresh).toHaveBeenCalledTimes(1);
		});
	});

	describe("window selection", () => {
		beforeEach(() => {
			service.current = reading();
		});

		it("shows the session and week windows by default", () => {
			appear(k);
			expect(keyTexts()).toEqual(expect.arrayContaining(["5-HOUR", "37%", "WEEK", "81%"]));
			expect(keyTexts()).not.toContain("SONNET WK");
		});

		it("shows the configured windows", () => {
			appear(k, { first: "sonnet", second: "week" });
			const texts = keyTexts();
			expect(texts.indexOf("SONNET WK")).toBeLessThan(texts.indexOf("WEEK"));
			expect(texts).toContain("5%");
			expect(texts).not.toContain("5-HOUR");
		});

		it("shows the next window on the bottom bar when both bars are the same window", () => {
			appear(k, { first: "week", second: "week" });
			const texts = keyTexts();
			expect(texts).toContain("WEEK");
			expect(texts).toContain("SONNET WK");
			expect(texts).not.toContain("5-HOUR");
		});

		it("falls back to the defaults for invalid values", () => {
			appear(k, { first: "month", second: "year" });
			expect(keyTexts()).toEqual(expect.arrayContaining(["5-HOUR", "WEEK"]));
		});

		it("updates the pair and redraws when settings change", () => {
			appear(k);
			k.setImage.mockClear();
			handler.onDidReceiveSettings({ action: k, payload: { settings: { first: "week", second: "sonnet" } } } as never);
			expect(k.setImage).toHaveBeenCalledTimes(1);
			expect(keyTexts()).toEqual(expect.arrayContaining(["WEEK", "SONNET WK"]));
			expect(keyTexts()).not.toContain("5-HOUR");
		});

		it("draws an instance whose settings arrive without a prior appear event", () => {
			handler.onDidReceiveSettings({ action: d, payload: { settings: {} } } as never);
			expect(d.setFeedback).toHaveBeenCalledTimes(1);
		});

		it("uses a separate pair for each instance", () => {
			const k2 = instance("key", "k2");
			hoisted.instances.push(k2);
			appear(k, { first: "session", second: "week" });
			appear(k2, { first: "sonnet", second: "session" });
			expect(keyTexts(k)).toContain("WEEK");
			expect(keyTexts(k)).not.toContain("SONNET WK");
			expect(keyTexts(k2)).toContain("SONNET WK");
			expect(keyTexts(k2)).not.toContain("WEEK");
			disappear(k2);
		});

		it("forgets the pair of an instance that disappeared", () => {
			appear(k);
			appear(d);
			disappear(k);
			k.setImage.mockClear();
			service.emit("change");
			expect(k.setImage).not.toHaveBeenCalled();
			expect(d.setFeedback).toHaveBeenCalled();
		});
	});

	describe("input", () => {
		it("requests a forced refresh on a key press", () => {
			appear(k);
			service.refresh.mockClear();
			handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			expect(service.refresh).toHaveBeenCalledWith(true);
		});

		it("requests a forced refresh on a dial press", () => {
			handler.onDialDown({ action: d, payload: { settings: {} } } as never);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			expect(service.refresh).toHaveBeenCalledWith(true);
		});

		it("requests a forced refresh on a touch tap", () => {
			handler.onTouchTap({ action: d, payload: { settings: {} } } as never);
			expect(service.refresh).toHaveBeenCalledTimes(1);
			expect(service.refresh).toHaveBeenCalledWith(true);
		});
	});

	describe("drawing", () => {
		it("sets an SVG data URI image on keys and a canvas feedback on dials", () => {
			service.current = reading();
			appear(k);
			appear(d);
			expect(String(k.setImage.mock.calls.at(-1)?.[0]).startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(String(d.setFeedback.mock.calls.at(-1)?.[0].canvas).startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(k.setFeedback).not.toHaveBeenCalled();
			expect(d.setImage).not.toHaveBeenCalled();
			expect(Object.keys(d.setFeedback.mock.calls.at(-1)?.[0])).toEqual(["canvas"]);
		});

		it("renders two filled bars on a key and on a dial", () => {
			service.current = reading();
			appear(k);
			appear(d);
			expect(keySvg().match(/rx="4"/g)).toHaveLength(4);
			expect(dialSvg().match(/rx="4.5"/g)).toHaveLength(4);
			expect(dialSvg()).toContain("5-HOUR");
			expect(dialSvg()).toContain("WEEK");
		});

		it("shows rounded percentages and the time until reset", () => {
			service.current = reading();
			appear(k);
			appear(d);
			expect(keyTexts()).toEqual(["5-HOUR", "2h 14m", "37%", "WEEK", "3d 4h", "81%"]);
			expect(dialSvg()).toContain(">37%</text>");
			expect(dialSvg()).toContain(">81%</text>");
		});

		it("shows loading when there is no reading and no error", () => {
			appear(k);
			appear(d);
			expect(keyTexts()).toEqual(["loading"]);
			expect(textElements(dialSvg())).toEqual(["loading"]);
		});

		it.each([
			["no-login", ["not signed in"]],
			["expired", ["login expired", "use Claude"]],
			["rate-limited", ["rate limited"]],
			["offline", ["offline"]],
			["failed", ["no data"]],
		] as const)("shows the %s error text when there is no reading", (error, lines) => {
			service.current = { windows: {}, fetchedAt: undefined, error };
			appear(k);
			appear(d);
			expect(keyTexts()).toEqual(lines);
			expect(textElements(dialSvg())).toEqual(lines);
		});

		it("shows the warning beside each title and keeps the last reading when a request failed", () => {
			service.current = reading("offline");
			appear(k);
			appear(d);
			expect(keyTexts()).toEqual(["5-HOUR", "offline", "37%", "WEEK", "offline", "81%"]);
			expect(dialSvg()).toContain(">offline</text>");
			expect(dialSvg()).toContain(">37%</text>");
		});

		it("shows loading when neither window of the pair has a reading and dashes when only one does", () => {
			service.current = { windows: { sonnet: { percent: 5, resetsAt: undefined } }, fetchedAt: NOW.getTime(), error: undefined };
			appear(k);
			expect(keyTexts()).toEqual(["loading"]);
			appear(k, { first: "sonnet", second: "week" });
			expect(keyTexts()).toEqual(["SONNET WK", "5%", "WEEK", "--"]);
		});

		it("redraws every visible instance when the service emits a change", () => {
			appear(k);
			appear(d);
			expect(keyTexts()).toEqual(["loading"]);
			service.current = reading();
			service.emit("change");
			expect(keyTexts()).toContain("37%");
			expect(dialSvg()).toContain(">37%</text>");
		});

		it("skips instances that have not appeared", () => {
			appear(k);
			service.current = reading();
			service.emit("change");
			expect(k.setImage).toHaveBeenCalledTimes(2);
			expect(d.setFeedback).not.toHaveBeenCalled();
		});

		it("draws nothing when no instance is registered with the action", () => {
			appear(k);
			hoisted.instances.length = 0;
			k.setImage.mockClear();
			service.emit("change");
			expect(k.setImage).not.toHaveBeenCalled();
		});
	});
});
