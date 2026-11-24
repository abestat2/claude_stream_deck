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
import type { Pace } from "../../src/usage/pace";
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

class FakeService extends EventEmitter {
	current: UsageState = { windows: {}, fetchedAt: undefined, error: undefined };
	refresh = vi.fn().mockResolvedValue(undefined);
	paceByWindow: Record<string, Pace> = {};
	pace = vi.fn(() => this.paceByWindow);
	state(): UsageState {
		return this.current;
	}
}

const NOW = new Date("2026-01-01T00:00:00Z");
const MINUTE = 60_000;
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

const reading = (error: UsageState["error"] = undefined): UsageState => ({
	windows: {
		session: { percent: 37.4, resetsAt: inMinutes(134) },
		week: { percent: 81, resetsAt: inMinutes(3 * 24 * 60 + 4 * 60) },
		sonnet: { percent: 5, resetsAt: undefined },
	},
	fetchedAt: NOW.getTime(),
	error,
});

const pace = (limitInMs: number | undefined, projectedAtReset: number | undefined = undefined): Pace => ({ ratePerHour: 10, limitInMs, projectedAtReset });

/** Number of 2 px wide pace markers in an SVG. */
const markerCount = (svg: string) => (svg.match(/width="2" height="\d+" rx="1" fill="#f1ece4"/g) ?? []).length;

describe("Usage pace", () => {
	let service: FakeService;
	let handler: Usage;
	let k: FakeInstance;
	let d: FakeInstance;

	const appear = (target: FakeInstance, settings: { first?: string; second?: string } = {}) =>
		handler.onWillAppear({ action: target, payload: { settings } } as never);
	const disappear = (target: FakeInstance) => handler.onWillDisappear({ action: target, payload: { settings: {} } } as never);
	const keySvg = () => decodeDataUri(String(k.setImage.mock.calls.at(-1)?.[0]));
	const dialSvg = () => decodeDataUri(String(d.setFeedback.mock.calls.at(-1)?.[0].canvas));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		service = new FakeService();
		service.current = reading();
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

	describe("rendering", () => {
		it("shows the limit text and the marker on a key", () => {
			service.paceByWindow = { session: pace(90 * MINUTE, 50) };
			appear(k);
			const svg = keySvg();
			expect(textElements(svg)).toContain("limit in");
			expect(textElements(svg)).toContain("1h 30m");
			expect(svg).toContain('<rect x="71" y="53" width="2" height="12" rx="1" fill="#f1ece4"/>');
		});

		it("shows the limit text and the marker on a dial", () => {
			service.paceByWindow = { session: pace(90 * MINUTE, 50) };
			appear(d);
			const svg = dialSvg();
			expect(textElements(svg)).toContain("limit 1h 30m");
			expect(svg).toContain('<rect x="99" y="30" width="2" height="13" rx="1" fill="#f1ece4"/>');
		});

		it("shows the sonnet variant on a dial set to the sonnet window", () => {
			service.paceByWindow = { sonnet: pace(45 * MINUTE) };
			appear(d, { first: "sonnet", second: "week" });
			expect(textElements(dialSvg())).toContain("! 45m");
		});

		it("applies the pace of the window each row shows", () => {
			service.paceByWindow = { week: pace(undefined, 90) };
			appear(k, { first: "week", second: "session" });
			expect(markerCount(keySvg())).toBe(1);
			expect(keySvg()).toContain('<rect x="117.4" y="53"');
		});

		it("shows neither the limit text nor a marker when the pace is empty", () => {
			appear(k);
			appear(d);
			expect(textElements(keySvg())).not.toContain("limit in");
			expect(markerCount(keySvg())).toBe(0);
			expect(textElements(dialSvg()).some((t) => t.startsWith("limit"))).toBe(false);
			expect(markerCount(dialSvg())).toBe(0);
		});

		it("draws the same output as an unpaced render when the pace is empty", () => {
			appear(k);
			const plain = keySvg();
			service.paceByWindow = { session: pace(30 * MINUTE) };
			service.emit("change");
			expect(keySvg()).not.toBe(plain);
			service.paceByWindow = {};
			service.emit("change");
			expect(keySvg()).toBe(plain);
		});

		it("shows no pace while the service reports an error", () => {
			service.current = reading("offline");
			service.paceByWindow = { session: pace(30 * MINUTE, 50) };
			appear(k);
			appear(d);
			expect(textElements(keySvg())).not.toContain("limit in");
			expect(markerCount(keySvg())).toBe(0);
			expect(markerCount(dialSvg())).toBe(0);
		});

		it("draws the same pace on every visible instance", () => {
			const k2 = instance("key", "k2");
			hoisted.instances.push(k2);
			service.paceByWindow = { session: pace(30 * MINUTE) };
			appear(k);
			appear(k2);
			expect(k2.setImage.mock.calls.at(-1)?.[0]).toBe(k.setImage.mock.calls.at(-1)?.[0]);
			disappear(k2);
		});
	});

	describe("reads", () => {
		it("reads the pace once per draw with two instances visible", () => {
			appear(k);
			service.pace.mockClear();
			appear(d);
			expect(service.pace).toHaveBeenCalledTimes(1);
		});

		it("passes the same pace object to the key and the dial", () => {
			const shared = { session: pace(30 * MINUTE) };
			service.paceByWindow = shared;
			appear(k);
			appear(d);
			service.pace.mockClear();
			service.emit("change");
			expect(service.pace).toHaveBeenCalledTimes(1);
			expect(textElements(keySvg())).toContain("limit in");
			expect(textElements(dialSvg())).toContain("limit 30m");
		});

		it("reads the pace again on every interval tick", () => {
			appear(k);
			service.pace.mockClear();
			vi.advanceTimersByTime(30_000);
			expect(service.pace).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(60_000);
			expect(service.pace).toHaveBeenCalledTimes(3);
		});

		it("reads the pace again on every service change event", () => {
			appear(k);
			service.pace.mockClear();
			service.emit("change");
			service.emit("change");
			expect(service.pace).toHaveBeenCalledTimes(2);
		});

		it("reads the pace when the settings change", () => {
			appear(k);
			service.pace.mockClear();
			handler.onDidReceiveSettings({ action: k, payload: { settings: { first: "week", second: "sonnet" } } } as never);
			expect(service.pace).toHaveBeenCalledTimes(1);
		});

		it("shows a pace that appears between draws on the next tick", () => {
			appear(k);
			expect(textElements(keySvg())).not.toContain("limit in");
			service.paceByWindow = { session: pace(30 * MINUTE) };
			vi.advanceTimersByTime(30_000);
			expect(textElements(keySvg())).toContain("limit in");
		});

		it("does not read the pace after the last instance disappears and the interval stops", () => {
			appear(k);
			disappear(k);
			service.pace.mockClear();
			vi.advanceTimersByTime(120_000);
			expect(service.pace).not.toHaveBeenCalled();
		});

		it("does not read the pace for presses that only request a refresh", () => {
			appear(k);
			service.pace.mockClear();
			handler.onKeyDown({} as never);
			handler.onDialDown({} as never);
			handler.onTouchTap({} as never);
			expect(service.pace).not.toHaveBeenCalled();
		});
	});
});
