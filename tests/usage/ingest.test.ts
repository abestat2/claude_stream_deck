import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageService, type UsageState } from "../../src/usage/client";

const NOW = new Date("2026-03-01T12:00:00Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const FALLBACK_AFTER = 5 * MINUTE;

describe("UsageService.ingestStatusLine", () => {
	let dir: string;
	let fetchMock: ReturnType<typeof vi.fn>;
	let service: UsageService;
	let changes: UsageState[];
	const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

	const limits = (session = 30, week = 60) => ({
		five_hour: { used_percentage: session, resets_at: 1_772_366_400 },
		seven_day: { used_percentage: week, resets_at: 1_772_800_000 },
	});

	function respond(status: number, payload: unknown = {}): void {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status }));
	}

	const ownReading = (extra: object = {}) => ({
		five_hour: { utilization: 25, resets_at: "2026-03-01T15:00:00Z" },
		seven_day: { utilization: 50, resets_at: "2026-03-05T00:00:00Z" },
		...extra,
	});

	async function readOwn(extra: object = {}): Promise<void> {
		respond(200, ownReading(extra));
		await service.refresh();
	}

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		dir = mkdtempSync(join(tmpdir(), "usage-ingest-"));
		process.env.CLAUDE_CONFIG_DIR = dir;
		writeFileSync(join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-token", expiresAt: NOW.getTime() + 24 * 3_600_000 } }));
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		service = new UsageService();
		changes = [];
		service.on("change", (state: UsageState) => changes.push(state));
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

	describe("mapping", () => {
		it("maps five_hour to the session window and seven_day to the week window", () => {
			service.ingestStatusLine(limits(30, 60));
			const { windows } = service.state();
			expect(windows.session).toEqual({ percent: 30, resetsAt: new Date(1_772_366_400 * 1000) });
			expect(windows.week).toEqual({ percent: 60, resetsAt: new Date(1_772_800_000 * 1000) });
		});

		it("converts reset times from epoch seconds", () => {
			service.ingestStatusLine({ five_hour: { used_percentage: 1, resets_at: 1_000 } });
			expect(service.state().windows.session?.resetsAt?.getTime()).toBe(1_000_000);
		});

		it("leaves the reset time undefined when it is not a number", () => {
			service.ingestStatusLine({ five_hour: { used_percentage: 1, resets_at: "2026-03-01T15:00:00Z" } });
			expect(service.state().windows.session).toEqual({ percent: 1, resetsAt: undefined });
		});

		it("keeps a window with zero percent", () => {
			service.ingestStatusLine({ five_hour: { used_percentage: 0 } });
			expect(service.state().windows.session).toEqual({ percent: 0, resetsAt: undefined });
		});

		it("applies one window without the other", () => {
			service.ingestStatusLine({ seven_day: { used_percentage: 12, resets_at: 100 } });
			expect(service.state().windows.session).toBeUndefined();
			expect(service.state().windows.week?.percent).toBe(12);
		});

		it("does not map other keys to windows", () => {
			service.ingestStatusLine({ seven_day_sonnet: { used_percentage: 5 }, session: { used_percentage: 5 } });
			expect(service.state().windows).toEqual({});
		});

		it.each([undefined, null, 5, "text", true, []])("ignores non-object rate limits %j", (value) => {
			service.ingestStatusLine(value);
			expect(service.state()).toEqual({ windows: {}, fetchedAt: undefined, error: undefined });
			expect(changes).toEqual([]);
		});

		it("ignores malformed entries and keeps valid ones", () => {
			service.ingestStatusLine({
				five_hour: { used_percentage: "30", resets_at: 1 },
				seven_day: { used_percentage: 60, resets_at: 100 },
			});
			expect(service.state().windows.session).toBeUndefined();
			expect(service.state().windows.week?.percent).toBe(60);
		});

		it.each([null, 5, "x", {}, { used_percentage: null }, { used_percentage: undefined }])("ignores the entry %j", (entry) => {
			service.ingestStatusLine({ five_hour: entry, seven_day: entry });
			expect(service.state().windows).toEqual({});
			expect(changes).toEqual([]);
		});

		it("keeps other windows such as sonnet", async () => {
			await readOwn({ seven_day_sonnet: { utilization: 7, resets_at: null } });
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(31, 61));
			const { windows } = service.state();
			expect(windows.sonnet).toEqual({ percent: 7, resetsAt: undefined });
			expect(windows.session?.percent).toBe(31);
			expect(windows.week?.percent).toBe(61);
		});

		it("keeps an existing window that the status line does not report", async () => {
			await readOwn();
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine({ five_hour: { used_percentage: 90, resets_at: 5 } });
			expect(service.state().windows.session?.percent).toBe(90);
			expect(service.state().windows.week?.percent).toBe(50);
		});
	});

	describe("precedence over the service's own reading", () => {
		it("applies when there is no reading", () => {
			service.ingestStatusLine(limits());
			expect(service.state().windows.session?.percent).toBe(30);
			expect(changes).toHaveLength(1);
		});

		it("does nothing while the own reading is younger than five minutes", async () => {
			await readOwn();
			changes.length = 0;
			vi.advanceTimersByTime(FALLBACK_AFTER - 1);
			service.ingestStatusLine(limits(99, 99));
			expect(service.state().windows.session?.percent).toBe(25);
			expect(service.state().windows.week?.percent).toBe(50);
			expect(changes).toEqual([]);
		});

		it("does nothing immediately after the own reading", async () => {
			await readOwn();
			service.ingestStatusLine(limits(99, 99));
			expect(service.state().windows.session?.percent).toBe(25);
		});

		it("applies once the own reading is five minutes old", async () => {
			await readOwn();
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(99, 98));
			expect(service.state().windows.session?.percent).toBe(99);
			expect(service.state().windows.week?.percent).toBe(98);
		});

		it("applies when the service has an error even though the own reading is recent", async () => {
			await readOwn();
			vi.advanceTimersByTime(61 * SECOND);
			respond(500);
			await service.refresh();
			expect(service.state().error).toBe("failed");
			service.ingestStatusLine(limits(77, 88));
			expect(service.state().windows.session?.percent).toBe(77);
			expect(service.state().windows.week?.percent).toBe(88);
		});

		it("clears the error when status line data is applied", async () => {
			await readOwn();
			vi.advanceTimersByTime(61 * SECOND);
			respond(500);
			await service.refresh();
			service.ingestStatusLine(limits(77, 88));
			expect(service.state().error).toBeUndefined();
		});

		it("applies when the login file is missing", async () => {
			rmSync(join(dir, ".credentials.json"));
			await service.refresh();
			expect(service.state().error).toBe("no-login");
			service.ingestStatusLine(limits());
			expect(service.state().windows.session?.percent).toBe(30);
			expect(service.state().error).toBeUndefined();
		});

		it("does not make a network request", () => {
			service.ingestStatusLine(limits());
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("lets a later own reading replace status line data", async () => {
			service.ingestStatusLine(limits());
			vi.advanceTimersByTime(2 * MINUTE);
			await readOwn();
			expect(service.state().windows.session?.percent).toBe(25);
			expect(service.state().error).toBeUndefined();
		});
	});

	describe("change events", () => {
		it("emits change with the new state when windows change", () => {
			service.ingestStatusLine(limits());
			expect(changes).toHaveLength(1);
			expect(changes[0]).toBe(service.state());
		});

		it("does not emit change when the windows are identical", async () => {
			await readOwn({ five_hour: { utilization: 30, resets_at: new Date(1_772_366_400 * 1000).toISOString() }, seven_day: { utilization: 60, resets_at: new Date(1_772_800_000 * 1000).toISOString() } });
			changes.length = 0;
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(30, 60));
			expect(changes).toEqual([]);
		});

		it("does not emit change for input that maps to nothing", () => {
			service.ingestStatusLine({});
			expect(changes).toEqual([]);
		});

		it("does not emit change for a reset time that moves by nothing", async () => {
			await readOwn();
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(1, 2));
			changes.length = 0;
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(1, 2));
			expect(changes).toEqual([]);
		});

		it("emits change when the percentage differs", async () => {
			await readOwn();
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(1, 2));
			changes.length = 0;
			vi.advanceTimersByTime(FALLBACK_AFTER);
			service.ingestStatusLine(limits(3, 2));
			expect(changes).toHaveLength(1);
		});
	});

	describe("successive status line updates", () => {
		it("applies each update while no own reading exists", () => {
			service.ingestStatusLine(limits(10, 20));
			vi.advanceTimersByTime(10 * SECOND);
			service.ingestStatusLine(limits(15, 25));
			expect(service.state().windows.session?.percent).toBe(15);
			expect(service.state().windows.week?.percent).toBe(25);
		});
	});
});
