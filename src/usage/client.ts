import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { computePace, LOOKBACK_MS, type Pace, type Sample } from "./pace";

/** Plan usage windows that can be displayed. */
export type WindowId = "session" | "week" | "sonnet";

/** Usage of one window as a percentage of the plan limit, and when it resets. */
export type UsageWindow = {
	percent: number;
	resetsAt: Date | undefined;
};

/** Why usage could not be read:
 * - `no-login`: no Claude Code login file was found.
 * - `expired`: the stored access token is expired or was rejected.
 * - `rate-limited`: the usage service asked the client to wait.
 * - `offline`: the usage service could not be reached.
 * - `failed`: the usage service answered with an unexpected response.
 */
export type UsageError = "no-login" | "expired" | "rate-limited" | "offline" | "failed";

/** Latest usage result. `windows` holds the last successful reading, which is kept when a later request fails. */
export type UsageState = {
	windows: Partial<Record<WindowId, UsageWindow>>;
	fetchedAt: number | undefined;
	error: UsageError | undefined;
};

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

/** Shortest time between requests to the usage service. */
const MIN_INTERVAL_MS = 60_000;

/** Shortest time between requests when a refresh is requested manually. */
const MIN_MANUAL_INTERVAL_MS = 10_000;

/** Wait applied after a rate-limit response that carries no `Retry-After` header. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 120_000;

const REQUEST_TIMEOUT_MS = 8_000;

/** Shortest time between stored readings used to measure pace. */
const SAMPLE_INTERVAL_MS = 60_000;

/** How long stored readings are kept. */
const SAMPLE_RETENTION_MS = 24 * 60 * 60_000;

/** A drop of at least this many percentage points between readings means the window was reset. */
const RESET_DROP_PERCENT = 0.5;

/** A reset time that moves forward by more than this between readings means the window was reset. */
const RESET_TIME_JUMP_MS = 30 * 60_000;

const WINDOW_IDS: WindowId[] = ["session", "week", "sonnet"];

/** Age of the service's own reading after which status line limits may replace it. */
const STATUS_LINE_FALLBACK_AFTER_MS = 5 * 60_000;

type Credentials = { accessToken: string; expiresAt: number | undefined };

/** Reads the access token from the Claude Code login file. The file is only read, never modified. */
async function readCredentials(): Promise<Credentials | undefined> {
	const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	try {
		const parsed = JSON.parse(await readFile(join(dir, ".credentials.json"), "utf8")) as {
			claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
		};
		const oauth = parsed.claudeAiOauth;
		if (typeof oauth?.accessToken !== "string" || oauth.accessToken.length === 0) {
			return undefined;
		}
		return { accessToken: oauth.accessToken, expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined };
	} catch {
		return undefined;
	}
}

function toWindow(value: unknown): UsageWindow | undefined {
	const w = value as { utilization?: unknown; resets_at?: unknown } | null | undefined;
	if (typeof w?.utilization !== "number") {
		return undefined;
	}
	const resetsAt = typeof w.resets_at === "string" ? new Date(w.resets_at) : undefined;
	return { percent: w.utilization, resetsAt: resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : undefined };
}

/** Converts a usage service response body into displayable windows. */
export function parseUsage(body: unknown): Partial<Record<WindowId, UsageWindow>> {
	const data = (body ?? {}) as Record<string, unknown>;
	const windows: Partial<Record<WindowId, UsageWindow>> = {};

	const session = toWindow(data.five_hour);
	const week = toWindow(data.seven_day);
	const sonnet = toWindow(data.seven_day_sonnet);
	if (session) windows.session = session;
	if (week) windows.week = week;
	if (sonnet) windows.sonnet = sonnet;

	// Accounts that lack the top-level windows report the same figures in the limits list.
	if (Array.isArray(data.limits)) {
		for (const limit of data.limits as ({ kind?: unknown; percent?: unknown; resets_at?: unknown } | null)[]) {
			if (!limit || typeof limit !== "object") {
				continue;
			}
			const id = limit.kind === "session" ? "session" : limit.kind === "weekly_all" ? "week" : undefined;
			if (id && !windows[id] && typeof limit.percent === "number") {
				windows[id] = toWindow({ utilization: limit.percent, resets_at: limit.resets_at });
			}
		}
	}

	return windows;
}

/**
 * Reads plan usage from the Claude usage service using the Claude Code login, and emits `change`
 * whenever the result changes. Requests are spaced out and back off when the service asks for it.
 * The access token is never refreshed or stored: Claude Code keeps its own login file current,
 * and an expired token is reported as an error until it is.
 */
export class UsageService extends EventEmitter {
	private current: UsageState = { windows: {}, fetchedAt: undefined, error: undefined };
	private lastAttempt = 0;
	/** Epoch milliseconds of the last reading obtained from the usage service itself. */
	private lastOwnReading: number | undefined;
	private waitUntil = 0;
	private inFlight = false;
	private readonly history: Record<WindowId, Sample[]> = { session: [], week: [], sonnet: [] };
	private readonly lastResetsAt: Partial<Record<WindowId, number>> = {};

	/** Returns the latest result. */
	state(): UsageState {
		return this.current;
	}

	/**
	 * Returns how fast each window is being used, measured from readings stored since the plugin started.
	 * A window has no entry until enough history exists, while its use is not increasing, and when it
	 * has no reading.
	 * @param now Epoch milliseconds to measure from.
	 */
	pace(now = Date.now()): Partial<Record<WindowId, Pace>> {
		const result: Partial<Record<WindowId, Pace>> = {};
		for (const id of WINDOW_IDS) {
			const pace = computePace(this.history[id], now, this.current.windows[id]?.resetsAt, LOOKBACK_MS[id]);
			if (pace) {
				result[id] = pace;
			}
		}
		return result;
	}

	/**
	 * Applies plan limits reported by the Claude Code status line, as a fallback while the service's own
	 * reading is unavailable or more than five minutes old. The 5-hour and weekly windows are replaced;
	 * other windows are kept.
	 */
	ingestStatusLine(rateLimits: unknown): void {
		const limits = (typeof rateLimits === "object" && rateLimits !== null ? rateLimits : {}) as Record<string, unknown>;
		const own = this.lastOwnReading;
		if (own !== undefined && !this.current.error && Date.now() - own < STATUS_LINE_FALLBACK_AFTER_MS) {
			return;
		}

		const windows = { ...this.current.windows };
		for (const [key, id] of [["five_hour", "session"], ["seven_day", "week"]] as const) {
			const entry = limits[key] as { used_percentage?: unknown; resets_at?: unknown } | null | undefined;
			if (typeof entry?.used_percentage === "number") {
				const resetsAt = typeof entry.resets_at === "number" ? new Date(entry.resets_at * 1000) : undefined;
				windows[id] = { percent: entry.used_percentage, resetsAt };
			}
		}
		if (JSON.stringify(windows) !== JSON.stringify(this.current.windows)) {
			this.update({ windows, error: undefined });
		}
	}

	/**
	 * Requests fresh usage if enough time has passed since the last request.
	 * @param manual When true, a shorter minimum interval applies.
	 */
	async refresh(manual = false): Promise<void> {
		const now = Date.now();
		const minInterval = manual ? MIN_MANUAL_INTERVAL_MS : MIN_INTERVAL_MS;
		if (this.inFlight || now < this.waitUntil || now - this.lastAttempt < minInterval) {
			return;
		}

		this.inFlight = true;
		this.lastAttempt = now;
		try {
			const result = await this.request();
			if (result.windows) {
				this.lastOwnReading = Date.now();
			}
			this.update(result);
		} finally {
			this.inFlight = false;
		}
	}

	private async request(): Promise<Pick<UsageState, "error"> & { windows?: UsageState["windows"] }> {
		const credentials = await readCredentials();
		if (!credentials) {
			return { error: "no-login" };
		}
		if (credentials.expiresAt !== undefined && credentials.expiresAt <= Date.now()) {
			return { error: "expired" };
		}

		let response: Response;
		try {
			response = await fetch(ENDPOINT, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${credentials.accessToken}`,
					"anthropic-beta": "oauth-2025-04-20",
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			return { error: "offline" };
		}

		if (response.status === 401 || response.status === 403) {
			return { error: "expired" };
		}
		if (response.status === 429) {
			const seconds = Number(response.headers.get("retry-after"));
			this.waitUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_WAIT_MS);
			return { error: "rate-limited" };
		}
		if (!response.ok) {
			return { error: "failed" };
		}

		try {
			const windows = parseUsage(await response.json());
			return Object.keys(windows).length > 0 ? { windows, error: undefined } : { error: "failed" };
		} catch {
			return { error: "failed" };
		}
	}

	/** Stores one reading per window, at most one per minute, and drops the history of a window that was reset. */
	private record(windows: UsageState["windows"], now: number): void {
		for (const id of WINDOW_IDS) {
			const window = windows[id];
			const list = this.history[id];
			if (!window) {
				list.length = 0;
				delete this.lastResetsAt[id];
				continue;
			}

			const last = list[list.length - 1];
			const resetsAt = window.resetsAt?.getTime();
			const previousReset = this.lastResetsAt[id];
			const reset =
				last !== undefined &&
				(window.percent <= last.percent - RESET_DROP_PERCENT ||
					(resetsAt !== undefined && previousReset !== undefined && resetsAt - previousReset > RESET_TIME_JUMP_MS));
			if (reset) {
				list.length = 0;
			}
			if (resetsAt !== undefined) {
				this.lastResetsAt[id] = resetsAt;
			}

			const newest = list[list.length - 1];
			if (!newest || now - newest.at >= SAMPLE_INTERVAL_MS) {
				list.push({ at: now, percent: window.percent });
			}
			while (list[0] && now - list[0].at > SAMPLE_RETENTION_MS) {
				list.shift();
			}
		}
	}

	private update(result: Pick<UsageState, "error"> & { windows?: UsageState["windows"] }): void {
		if (result.windows) {
			this.record(result.windows, Date.now());
		}

		const next: UsageState = result.windows
			? { windows: result.windows, fetchedAt: Date.now(), error: undefined }
			: { ...this.current, error: result.error };

		if (JSON.stringify(next) !== JSON.stringify(this.current)) {
			this.current = next;
			this.emit("change", next);
		}
	}
}
