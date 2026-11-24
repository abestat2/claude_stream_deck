import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
		for (const limit of data.limits as { kind?: unknown; percent?: unknown; resets_at?: unknown }[]) {
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
	private waitUntil = 0;
	private inFlight = false;

	/** Returns the latest result. */
	state(): UsageState {
		return this.current;
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
			this.update(await this.request());
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

	private update(result: Pick<UsageState, "error"> & { windows?: UsageState["windows"] }): void {
		const next: UsageState = result.windows
			? { windows: result.windows, fetchedAt: Date.now(), error: undefined }
			: { ...this.current, error: result.error };

		if (JSON.stringify(next) !== JSON.stringify(this.current)) {
			this.current = next;
			this.emit("change", next);
		}
	}
}
