import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUsage, UsageService, type UsageState } from "../../src/usage/client";

const NOW = new Date("2026-03-01T12:00:00Z");
const SECOND = 1000;

describe("parseUsage", () => {
	it("reads the three top-level windows", () => {
		const windows = parseUsage({
			five_hour: { utilization: 12.5, resets_at: "2026-03-01T15:00:00Z" },
			seven_day: { utilization: 40, resets_at: "2026-03-05T00:00:00Z" },
			seven_day_sonnet: { utilization: 3, resets_at: null },
		});
		expect(windows.session).toEqual({ percent: 12.5, resetsAt: new Date("2026-03-01T15:00:00Z") });
		expect(windows.week).toEqual({ percent: 40, resetsAt: new Date("2026-03-05T00:00:00Z") });
		expect(windows.sonnet).toEqual({ percent: 3, resetsAt: undefined });
	});

	it("keeps a window with zero utilization", () => {
		expect(parseUsage({ five_hour: { utilization: 0 } }).session).toEqual({ percent: 0, resetsAt: undefined });
	});

	it("omits windows that are missing, null, or lack a numeric utilization", () => {
		expect(
			parseUsage({
				five_hour: null,
				seven_day: { utilization: "50" },
				seven_day_sonnet: { resets_at: "2026-03-01T15:00:00Z" },
			}),
		).toEqual({});
	});

	it("drops an unparseable reset time but keeps the percentage", () => {
		expect(parseUsage({ five_hour: { utilization: 5, resets_at: "not a date" } }).session).toEqual({
			percent: 5,
			resetsAt: undefined,
		});
	});

	it("ignores a reset time that is not a string", () => {
		expect(parseUsage({ five_hour: { utilization: 5, resets_at: 1700000000 } }).session?.resetsAt).toBeUndefined();
	});

	it.each([undefined, null, 5, "text", [], true])("returns no windows for body %j", (body) => {
		expect(parseUsage(body)).toEqual({});
	});

	it("falls back to the limits list for session and weekly windows", () => {
		const windows = parseUsage({
			limits: [
				{ kind: "session", percent: 20, resets_at: "2026-03-01T15:00:00Z" },
				{ kind: "weekly_all", percent: 55 },
			],
		});
		expect(windows.session).toEqual({ percent: 20, resetsAt: new Date("2026-03-01T15:00:00Z") });
		expect(windows.week).toEqual({ percent: 55, resetsAt: undefined });
	});

	it("prefers the top-level window over the limits list", () => {
		const windows = parseUsage({
			five_hour: { utilization: 10 },
			limits: [{ kind: "session", percent: 99 }],
		});
		expect(windows.session?.percent).toBe(10);
	});

	it("fills only the windows that the top level lacks from the limits list", () => {
		const windows = parseUsage({
			five_hour: { utilization: 10 },
			limits: [
				{ kind: "session", percent: 99 },
				{ kind: "weekly_all", percent: 60 },
			],
		});
		expect(windows.session?.percent).toBe(10);
		expect(windows.week?.percent).toBe(60);
	});

	it("ignores limits with unknown kinds or non-numeric percentages", () => {
		expect(
			parseUsage({
				limits: [
					{ kind: "weekly_sonnet", percent: 5 },
					{ kind: "session", percent: "5" },
				],
			}),
		).toEqual({});
	});

	it("ignores a limits value that is not an array", () => {
		expect(parseUsage({ limits: { kind: "session", percent: 5 } })).toEqual({});
	});

	it("skips null entries in the limits list", () => {
		expect(parseUsage({ limits: [null, { kind: "session", percent: 5 }] }).session?.percent).toBe(5);
	});
});

describe("UsageService", () => {
	let dir: string;
	let fetchMock: ReturnType<typeof vi.fn>;
	let service: UsageService;
	let changes: UsageState[];
	const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

	const body = (extra: object = {}) => ({
		five_hour: { utilization: 25, resets_at: "2026-03-01T15:00:00Z" },
		seven_day: { utilization: 60, resets_at: "2026-03-05T00:00:00Z" },
		...extra,
	});

	function respond(status: number, payload: unknown = body(), headers: Record<string, string> = {}): void {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status, headers }));
	}

	function login(oauth: object | undefined): void {
		writeFileSync(join(dir, ".credentials.json"), JSON.stringify(oauth === undefined ? {} : { claudeAiOauth: oauth }));
	}

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		dir = mkdtempSync(join(tmpdir(), "usage-test-"));
		process.env.CLAUDE_CONFIG_DIR = dir;
		login({ accessToken: "test-token", expiresAt: NOW.getTime() + 3_600_000 });
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

	describe("successful reads", () => {
		it("starts with empty state", () => {
			expect(service.state()).toEqual({ windows: {}, fetchedAt: undefined, error: undefined });
		});

		it("stores parsed windows and the fetch time", async () => {
			respond(200);
			await service.refresh();
			const state = service.state();
			expect(state.error).toBeUndefined();
			expect(state.fetchedAt).toBe(NOW.getTime());
			expect(state.windows.session?.percent).toBe(25);
			expect(state.windows.week?.percent).toBe(60);
		});

		it("sends the bearer token and the OAuth beta header to the usage endpoint", async () => {
			respond(200);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
			expect(init.headers).toMatchObject({
				Authorization: "Bearer test-token",
				"anthropic-beta": "oauth-2025-04-20",
				Accept: "application/json",
			});
		});

		it("emits change with the new state", async () => {
			respond(200);
			await service.refresh();
			expect(changes).toHaveLength(1);
			expect(changes[0]).toBe(service.state());
		});

		it("proceeds when the credentials carry no expiry", async () => {
			login({ accessToken: "test-token" });
			respond(200);
			await service.refresh();
			expect(service.state().windows.session).toBeDefined();
		});

		it("clears an earlier error on success", async () => {
			respond(500);
			await service.refresh();
			expect(service.state().error).toBe("failed");
			vi.advanceTimersByTime(61 * SECOND);
			respond(200);
			await service.refresh();
			expect(service.state().error).toBeUndefined();
		});
	});

	describe("login problems", () => {
		it("reports no-login when the credentials file is missing", async () => {
			rmSync(join(dir, ".credentials.json"));
			await service.refresh();
			expect(service.state().error).toBe("no-login");
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("reports no-login when the file is not valid JSON", async () => {
			writeFileSync(join(dir, ".credentials.json"), "{ nope");
			await service.refresh();
			expect(service.state().error).toBe("no-login");
		});

		it("reports no-login when the OAuth section is missing", async () => {
			login(undefined);
			await service.refresh();
			expect(service.state().error).toBe("no-login");
		});

		it.each([{ accessToken: "" }, { accessToken: 12 }, {}])("reports no-login for token %j", async (oauth) => {
			login(oauth);
			await service.refresh();
			expect(service.state().error).toBe("no-login");
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("reports expired when the stored expiry has passed, without a request", async () => {
			login({ accessToken: "test-token", expiresAt: NOW.getTime() - 1 });
			await service.refresh();
			expect(service.state().error).toBe("expired");
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("reports expired when the expiry equals the current time", async () => {
			login({ accessToken: "test-token", expiresAt: NOW.getTime() });
			await service.refresh();
			expect(service.state().error).toBe("expired");
		});

		it("ignores a non-numeric expiry", async () => {
			login({ accessToken: "test-token", expiresAt: "soon" });
			respond(200);
			await service.refresh();
			expect(service.state().error).toBeUndefined();
		});

		it.each([401, 403])("reports expired for status %i", async (status) => {
			respond(status, {});
			await service.refresh();
			expect(service.state().error).toBe("expired");
		});

		it("reads a replaced credentials file on the next request", async () => {
			login({ accessToken: "test-token", expiresAt: NOW.getTime() - 1 });
			await service.refresh();
			login({ accessToken: "new-token", expiresAt: NOW.getTime() + 3_600_000 });
			vi.advanceTimersByTime(61 * SECOND);
			respond(200);
			await service.refresh();
			expect(service.state().error).toBeUndefined();
			expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer new-token" });
		});

		it("does not read credentials outside the configured directory", async () => {
			const empty = mkdtempSync(join(tmpdir(), "usage-empty-"));
			process.env.CLAUDE_CONFIG_DIR = empty;
			try {
				await service.refresh();
				expect(service.state().error).toBe("no-login");
				expect(fetchMock).not.toHaveBeenCalled();
			} finally {
				rmSync(empty, { recursive: true, force: true });
			}
		});

		it("treats a credentials path that is a directory as no login", async () => {
			rmSync(join(dir, ".credentials.json"));
			mkdirSync(join(dir, ".credentials.json"));
			await service.refresh();
			expect(service.state().error).toBe("no-login");
		});
	});

	describe("failures", () => {
		it("reports offline when the request rejects", async () => {
			fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
			await service.refresh();
			expect(service.state().error).toBe("offline");
		});

		it.each([400, 404, 500, 503])("reports failed for status %i", async (status) => {
			respond(status, {});
			await service.refresh();
			expect(service.state().error).toBe("failed");
		});

		it("reports failed when the body is not JSON", async () => {
			fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
			await service.refresh();
			expect(service.state().error).toBe("failed");
		});

		it("reports failed when the body has no recognised windows", async () => {
			respond(200, { unrelated: true });
			await service.refresh();
			expect(service.state().error).toBe("failed");
			expect(service.state().windows).toEqual({});
		});

		it("reports failed when the body is JSON null", async () => {
			respond(200, null);
			await service.refresh();
			expect(service.state().error).toBe("failed");
		});

		it("keeps the last good reading after a failure", async () => {
			respond(200);
			await service.refresh();
			const good = service.state();

			vi.advanceTimersByTime(61 * SECOND);
			respond(500, {});
			await service.refresh();

			expect(service.state().error).toBe("failed");
			expect(service.state().windows).toEqual(good.windows);
			expect(service.state().fetchedAt).toBe(good.fetchedAt);
		});

		it.each([
			["offline", () => fetchMock.mockRejectedValueOnce(new Error("down"))],
			["expired", () => respond(401, {})],
			["rate-limited", () => respond(429, {})],
			["failed", () => respond(500, {})],
		] as const)("keeps the last good reading after an %s result", async (error, arrange) => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(200 * SECOND);
			arrange();
			await service.refresh();
			expect(service.state().error).toBe(error);
			expect(service.state().windows.session?.percent).toBe(25);
		});

		it("emits when an error appears and not when the same error repeats", async () => {
			respond(500, {});
			await service.refresh();
			vi.advanceTimersByTime(61 * SECOND);
			respond(500, {});
			await service.refresh();
			expect(changes).toHaveLength(1);
		});

		it("emits when an identical reading is fetched at a later time", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(61 * SECOND);
			respond(200);
			await service.refresh();
			expect(changes).toHaveLength(2);
		});

		it("does not emit when the first request ends with no change to the empty state", async () => {
			rmSync(join(dir, ".credentials.json"));
			await service.refresh();
			await service.refresh();
			expect(changes).toHaveLength(1);
		});
	});

	describe("request spacing", () => {
		it("makes the first request immediately", async () => {
			respond(200);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("skips a second automatic refresh within one minute", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(59 * SECOND);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("allows an automatic refresh after exactly one minute", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(60 * SECOND);
			respond(200);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("counts failed attempts toward the spacing", async () => {
			respond(500, {});
			await service.refresh();
			vi.advanceTimersByTime(30 * SECOND);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("counts attempts that end in no-login toward the spacing", async () => {
			rmSync(join(dir, ".credentials.json"));
			await service.refresh();
			login({ accessToken: "test-token" });
			vi.advanceTimersByTime(30 * SECOND);
			await service.refresh();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("skips a manual refresh within ten seconds", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(9 * SECOND);
			await service.refresh(true);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("allows a manual refresh after ten seconds", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(10 * SECOND);
			respond(200);
			await service.refresh(true);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("still skips an automatic refresh ten seconds after the last request", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(10 * SECOND);
			await service.refresh(false);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("runs a single request when refreshes overlap", async () => {
			let release: (value: Response) => void = () => {};
			fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
			const first = service.refresh();
			await vi.advanceTimersByTimeAsync(0);
			const second = service.refresh(true);
			release(new Response(JSON.stringify(body()), { status: 200 }));
			await Promise.all([first, second]);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("allows a new request after an in-flight request fails", async () => {
			fetchMock.mockRejectedValueOnce(new Error("down"));
			await service.refresh();
			vi.advanceTimersByTime(61 * SECOND);
			respond(200);
			await service.refresh();
			expect(service.state().error).toBeUndefined();
		});
	});

	describe("rate limiting", () => {
		it("reports rate-limited on 429", async () => {
			respond(429, {}, { "retry-after": "30" });
			await service.refresh();
			expect(service.state().error).toBe("rate-limited");
		});

		it("waits for Retry-After when it exceeds the normal spacing", async () => {
			respond(429, {}, { "retry-after": "300" });
			await service.refresh();
			vi.advanceTimersByTime(299 * SECOND);
			await service.refresh(true);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1 * SECOND);
			respond(200);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("blocks manual refreshes during the Retry-After wait", async () => {
			respond(429, {}, { "retry-after": "45" });
			await service.refresh();
			vi.advanceTimersByTime(30 * SECOND);
			await service.refresh(true);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("falls back to the normal spacing when Retry-After is shorter than one minute", async () => {
			respond(429, {}, { "retry-after": "5" });
			await service.refresh();
			vi.advanceTimersByTime(30 * SECOND);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(30 * SECOND);
			respond(200);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("waits two minutes when Retry-After is absent", async () => {
			respond(429, {});
			await service.refresh();
			vi.advanceTimersByTime(119 * SECOND);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1 * SECOND);
			respond(200);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it.each(["abc", "0", "-5", ""])("waits two minutes for Retry-After %j", async (value) => {
			respond(429, {}, { "retry-after": value });
			await service.refresh();
			vi.advanceTimersByTime(119 * SECOND);
			await service.refresh();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("recovers after the wait and clears the rate-limited error", async () => {
			respond(200);
			await service.refresh();
			vi.advanceTimersByTime(61 * SECOND);
			respond(429, {}, { "retry-after": "90" });
			await service.refresh();
			expect(service.state().error).toBe("rate-limited");
			expect(service.state().windows.session?.percent).toBe(25);
			vi.advanceTimersByTime(90 * SECOND);
			respond(200, body({ five_hour: { utilization: 30 } }));
			await service.refresh();
			expect(service.state().error).toBeUndefined();
			expect(service.state().windows.session?.percent).toBe(30);
		});
	});
});
