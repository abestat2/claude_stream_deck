import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageService, type UsageState } from "../../src/usage/client";

const START = Date.parse("2026-03-01T12:00:00Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("UsageService pace", () => {
	let dir: string;
	let fetchMock: ReturnType<typeof vi.fn>;
	let service: UsageService;
	const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

	const at = (ms: number) => vi.setSystemTime(START + ms);
	const epoch = (ms: number) => (START + ms) / 1000;

	/** Feeds a status line reading at the given offset from the start time. Windows left undefined are omitted. */
	function feed(ms: number, session?: number, week?: number, resets: { session?: number; week?: number } = {}): void {
		at(ms);
		const limits: Record<string, unknown> = {};
		if (session !== undefined) {
			limits.five_hour = { used_percentage: session, resets_at: epoch(resets.session ?? 6 * HOUR) };
		}
		if (week !== undefined) {
			limits.seven_day = { used_percentage: week, resets_at: epoch(resets.week ?? 3 * 24 * HOUR) };
		}
		service.ingestStatusLine(limits);
	}

	/** Feeds one reading per minute with a rising session percentage, from `from` minutes to `to` minutes. */
	function feedSteps(from: number, to: number, start: number, step = 1): void {
		for (let m = from; m <= to; m++) {
			feed(m * MINUTE, start + (m - from) * step);
		}
	}

	const history = (id: string): unknown[] => (service as unknown as { history: Record<string, unknown[]> }).history[id] as unknown[];

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(START);
		dir = mkdtempSync(join(tmpdir(), "usage-pace-"));
		process.env.CLAUDE_CONFIG_DIR = dir;
		writeFileSync(join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-token", expiresAt: START + 48 * HOUR } }));
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		service = new UsageService();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		rmSync(dir, { recursive: true, force: true });
		if (originalConfigDir === undefined) {
			delete process.env.CLAUDE_CONFIG_DIR;
		} else {
			process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
		}
	});

	describe("history requirements", () => {
		it("has no pace without readings", () => {
			expect(service.pace()).toEqual({});
		});

		it("has no pace with one reading", () => {
			feed(0, 10, 10);
			expect(service.pace()).toEqual({});
		});

		it("has no pace while the readings span less than five minutes", () => {
			feedSteps(0, 4, 10);
			expect(service.pace()).toEqual({});
		});

		it("has a pace once the readings span five minutes with rising use", () => {
			feedSteps(0, 5, 10);
			expect(service.pace().session).toBeDefined();
		});

		it("has no pace for a window whose use stays flat", () => {
			for (let m = 0; m <= 10; m++) {
				feed(m * MINUTE, 10, 10 + m);
			}
			const pace = service.pace();
			expect(pace.session).toBeUndefined();
			expect(pace.week).toBeDefined();
		});
	});

	describe("rate and projection", () => {
		it("measures the rate from the oldest to the newest reading", () => {
			feedSteps(0, 5, 10);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(60, 8);
		});

		it("reports the time to the limit when it comes before the reset", () => {
			feedSteps(0, 5, 10);
			const pace = service.pace().session;
			expect(pace?.limitInMs).toBeCloseTo(85 * MINUTE, 3);
			expect(pace?.projectedAtReset).toBeUndefined();
		});

		it("reports the projected percentage when the reset comes first", () => {
			for (let m = 0; m <= 5; m++) {
				feed(m * MINUTE, 10 + m, undefined, { session: HOUR });
			}
			const pace = service.pace().session;
			expect(pace?.limitInMs).toBeUndefined();
			expect(pace?.projectedAtReset).toBeCloseTo(70, 8);
		});

		it("measures from the current time of the call", () => {
			feedSteps(0, 5, 10);
			at(15 * MINUTE);
			expect(service.pace().session?.limitInMs).toBeCloseTo(85 * MINUTE, 3);
		});

		it("uses only the oldest and newest readings inside the lookback", () => {
			feed(0, 10);
			feed(10 * MINUTE, 12);
			feed(20 * MINUTE, 28);
			feed(30 * MINUTE, 30);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(40, 8);
		});

		it("has no pace once the reset time has passed", () => {
			feedSteps(0, 5, 10);
			expect(service.pace(START + 6 * HOUR).session).toBeUndefined();
		});
	});

	describe("per-window independence", () => {
		it("measures a week window over a longer lookback than a session window", () => {
			feed(0, 10, 10);
			feed(20 * MINUTE, 20, 20);
			at(40 * MINUTE);
			const pace = service.pace();
			expect(pace.session).toBeUndefined();
			expect(pace.week?.ratePerHour).toBeCloseTo(30, 8);
		});

		it("measures a session window whose readings are inside its lookback", () => {
			feed(0, 10, 10);
			feed(20 * MINUTE, 20, 20);
			at(25 * MINUTE);
			const pace = service.pace();
			expect(pace.session?.ratePerHour).toBeCloseTo(30, 8);
			expect(pace.week?.ratePerHour).toBeCloseTo(30, 8);
		});

		it("includes only windows that have a pace", () => {
			for (let m = 0; m <= 6; m++) {
				feed(m * MINUTE, 10, 10 + m);
			}
			expect(Object.keys(service.pace())).toEqual(["week"]);
		});

		it("keeps the history of a window when another window is reset", () => {
			feed(0, 50, 10);
			feed(3 * MINUTE, 20, 13);
			feed(6 * MINUTE, 25, 16);
			const pace = service.pace();
			expect(pace.session).toBeUndefined();
			expect(pace.week?.ratePerHour).toBeCloseTo(60, 8);
		});

		it("has no sonnet pace from status line readings", () => {
			feedSteps(0, 10, 10);
			expect(service.pace().sonnet).toBeUndefined();
		});
	});

	describe("sampling interval", () => {
		it("does not store a reading less than 60 seconds after the previous one", () => {
			feed(0, 10);
			feed(5 * MINUTE, 20);
			feed(5 * MINUTE + 30 * SECOND, 30);
			expect(history("session")).toHaveLength(2);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(120, 8);
		});

		it("stores a reading exactly 60 seconds after the previous one", () => {
			feed(0, 10);
			feed(5 * MINUTE, 20);
			feed(6 * MINUTE, 30);
			expect(history("session")).toHaveLength(3);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(200, 8);
		});

		it("does not store a reading 59.999 seconds after the previous one", () => {
			feed(0, 10);
			feed(59_999, 11);
			expect(history("session")).toHaveLength(1);
		});

		it("spaces storage from the last stored reading, not the last received one", () => {
			feed(0, 10);
			feed(40 * SECOND, 11);
			feed(80 * SECOND, 12);
			expect(history("session")).toHaveLength(2);
		});
	});

	describe("reset detection", () => {
		function primed(): void {
			feed(0, 20);
			feed(5 * MINUTE, 30);
			expect(service.pace().session).toBeDefined();
		}

		it("clears history on a drop of more than 0.5 points", () => {
			primed();
			feed(6 * MINUTE, 29.4);
			expect(service.pace().session).toBeUndefined();
			expect(history("session")).toHaveLength(1);
		});

		it("measures again once new readings span five minutes after a clear", () => {
			primed();
			feed(6 * MINUTE, 29.4);
			feed(10 * MINUTE, 33);
			expect(service.pace().session).toBeUndefined();
			feed(11 * MINUTE, 35);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(((35 - 29.4) / 5) * 60, 8);
		});

		it("keeps history on a drop smaller than 0.5 points", () => {
			primed();
			feed(6 * MINUTE, 29.6);
			expect(history("session")).toHaveLength(3);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(((29.6 - 20) / 6) * 60, 8);
		});

		it("clears history on a drop of exactly 0.5 points", () => {
			primed();
			feed(6 * MINUTE, 29.5);
			expect(service.pace().session).toBeUndefined();
		});

		it("clears history when the reset time moves forward by more than 30 minutes", () => {
			feed(0, 20);
			feed(5 * MINUTE, 30);
			feed(6 * MINUTE, 31, undefined, { session: 6 * HOUR + 30 * MINUTE + SECOND });
			expect(history("session")).toHaveLength(1);
			expect(service.pace().session).toBeUndefined();
		});

		it("keeps history when the reset time moves forward by exactly 30 minutes", () => {
			feed(0, 20);
			feed(5 * MINUTE, 30);
			feed(6 * MINUTE, 31, undefined, { session: 6 * HOUR + 30 * MINUTE });
			expect(history("session")).toHaveLength(3);
			expect(service.pace().session).toBeDefined();
		});

		it("keeps history when the reset time moves backward", () => {
			feed(0, 20);
			feed(5 * MINUTE, 30);
			feed(6 * MINUTE, 31, undefined, { session: 4 * HOUR });
			expect(history("session")).toHaveLength(3);
		});

		it("compares the reset time with the one from the previous reading", () => {
			feed(0, 20, undefined, { session: 6 * HOUR });
			feed(2 * MINUTE, 22, undefined, { session: 6 * HOUR + 25 * MINUTE });
			feed(4 * MINUTE, 24, undefined, { session: 6 * HOUR + 50 * MINUTE });
			feed(6 * MINUTE, 26, undefined, { session: 6 * HOUR + 75 * MINUTE });
			expect(history("session")).toHaveLength(4);
		});

		it("clears the history of only the window that was reset", () => {
			feed(0, 20, 20);
			feed(5 * MINUTE, 30, 30);
			feed(6 * MINUTE, 5, 31);
			expect(service.pace().session).toBeUndefined();
			expect(history("session")).toHaveLength(1);
			expect(history("week")).toHaveLength(3);
		});
	});

	describe("retention", () => {
		it("drops readings older than 24 hours when a new reading is stored", () => {
			feed(0, 10, 10);
			feed(12 * HOUR, 20, 20);
			feed(24 * HOUR + MINUTE, 30, 30);
			expect(history("week")).toHaveLength(2);
			expect(history("session")).toHaveLength(2);
		});

		it("keeps a reading exactly 24 hours old", () => {
			feed(0, 10, 10);
			feed(12 * HOUR, 20, 20);
			feed(24 * HOUR, 30, 30);
			expect(history("week")).toHaveLength(3);
		});
	});

	describe("explicit time", () => {
		it("measures from the given time instead of the clock", () => {
			feedSteps(0, 5, 10);
			expect(service.pace(START + 5 * MINUTE).session).toBeDefined();
			expect(service.pace(START + 5 * MINUTE + 30 * MINUTE + 1).session).toBeUndefined();
		});

		it("applies the reset time relative to the given time", () => {
			for (let m = 0; m <= 5; m++) {
				feed(m * MINUTE, 10 + m, undefined, { session: HOUR });
			}
			const early = service.pace(START + 5 * MINUTE).session;
			const late = service.pace(START + 20 * MINUTE).session;
			expect(early?.projectedAtReset).toBeCloseTo(70, 8);
			expect(late?.projectedAtReset).toBeCloseTo(15 + 60 * (40 / 60), 8);
		});

		it("does not alter stored history", () => {
			feedSteps(0, 5, 10);
			service.pace(START + 10 * HOUR);
			expect(history("session")).toHaveLength(6);
		});
	});

	describe("change events", () => {
		it("emits one change per changed reading", () => {
			const changes: UsageState[] = [];
			service.on("change", (state: UsageState) => changes.push(state));
			feedSteps(0, 5, 10);
			expect(changes).toHaveLength(6);
			expect(changes.at(-1)?.windows.session?.percent).toBe(15);
		});

		it("does not emit or record when a reading repeats the current values", () => {
			const changes: UsageState[] = [];
			feed(0, 10);
			service.on("change", (state: UsageState) => changes.push(state));
			feed(2 * MINUTE, 10);
			expect(changes).toHaveLength(0);
			expect(history("session")).toHaveLength(1);
		});

		it("keeps the state shape", () => {
			feedSteps(0, 5, 10);
			expect(Object.keys(service.state()).sort()).toEqual(["error", "fetchedAt", "windows"]);
		});
	});

	describe("own request path", () => {
		const body = (session: number | undefined, week: number | undefined, sessionReset = "2026-03-01T18:00:00Z") => ({
			...(session !== undefined && { five_hour: { utilization: session, resets_at: sessionReset } }),
			...(week !== undefined && { seven_day: { utilization: week, resets_at: "2026-03-05T00:00:00Z" } }),
		});

		async function read(ms: number, session?: number, week?: number, sessionReset?: string): Promise<void> {
			at(ms);
			fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body(session, week, sessionReset)), { status: 200 }));
			await service.refresh();
		}

		it("records a reading on each successful refresh", async () => {
			for (let m = 0; m <= 5; m++) {
				await read(m * MINUTE, 10 + m, 50);
			}
			expect(fetchMock).toHaveBeenCalledTimes(6);
			expect(history("session")).toHaveLength(6);
			expect(service.pace().session?.ratePerHour).toBeCloseTo(60, 8);
			expect(service.pace().session?.limitInMs).toBeCloseTo(85 * MINUTE, 3);
		});

		it("does not record a reading when a request fails", async () => {
			await read(0, 10, 10);
			at(MINUTE);
			fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
			await service.refresh();
			expect(history("session")).toHaveLength(1);
		});

		it("clears the history of a window missing from a later reading", async () => {
			await read(0, 10, 10);
			await read(MINUTE, 11, 11);
			await read(2 * MINUTE, 12, undefined);
			expect(history("session")).toHaveLength(3);
			expect(history("week")).toHaveLength(0);
		});

		it("starts the history of a window again when it returns", async () => {
			await read(0, 10, 10);
			await read(MINUTE, 11, undefined);
			await read(2 * MINUTE, 12, 20);
			expect(history("week")).toHaveLength(1);
		});

		it("detects a reset time moving forward by more than 30 minutes", async () => {
			await read(0, 10, 10, "2026-03-01T18:00:00Z");
			await read(5 * MINUTE, 20, 10, "2026-03-01T18:00:00Z");
			await read(6 * MINUTE, 21, 10, "2026-03-01T18:30:01Z");
			expect(history("session")).toHaveLength(1);
		});

		it("does not record status line readings while its own reading is recent", async () => {
			await read(0, 10, 10);
			feed(2 * MINUTE, 50, 50);
			expect(history("session")).toHaveLength(1);
		});

		it("records status line readings once its own reading is older than five minutes", async () => {
			await read(0, 10, 10);
			feed(6 * MINUTE, 50, 50);
			expect(history("session")).toHaveLength(2);
		});
	});
});
