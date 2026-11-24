import type { UsageError, UsageState, WindowId } from "../usage/client";

const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const TRACK = "#34302c";
const OK = "#7fb77e";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

const TITLES: Record<WindowId, string> = {
	session: "5-HOUR",
	week: "WEEK",
	sonnet: "SONNET WEEK",
};

const ERROR_TEXT: Record<UsageError, string[]> = {
	"no-login": ["not signed in"],
	expired: ["login expired", "use Claude"],
	"rate-limited": ["rate limited"],
	offline: ["offline"],
	failed: ["no data"],
};

/** Colour for a usage percentage: green until 70%, amber until 90%, then red. */
export function usageColor(percent: number): string {
	return percent >= 90 ? CRITICAL : percent >= 70 ? WARN : OK;
}

/** Formats the time until a reset, for example `2h 14m`, `3d 4h`, or `45m`. */
export function formatReset(resetsAt: Date | undefined, now = Date.now()): string {
	if (!resetsAt) {
		return "";
	}
	const minutes = Math.max(0, Math.round((resetsAt.getTime() - now) / 60_000));
	if (minutes >= 24 * 60) {
		return `${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`;
	}
	if (minutes >= 60) {
		return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	}
	return `${minutes}m`;
}

function text(x: number, y: number, size: number, fill: string, content: string, anchor: "start" | "middle" | "end" = "middle"): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fill}">${content}</text>`;
}

function bar(x: number, y: number, width: number, height: number, percent: number): string {
	const fill = Math.max(0, Math.min(100, percent)) / 100 * width;
	return (
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK}"/>` +
		(fill > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(fill, height)}" height="${height}" rx="${height / 2}" fill="${usageColor(percent)}"/>` : "")
	);
}

function wrap(width: number, height: number, parts: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${BACKGROUND}"/>${parts.join("")}</svg>`;
}

/**
 * Renders one usage window as an SVG for a 144 x 144 key.
 * When the last request failed, the last known value is kept and marked with a warning label.
 */
export function renderUsageKey(window: WindowId, state: UsageState): string {
	const usage = state.windows[window];
	const parts = [text(72, 28, 16, LABEL, TITLES[window])];

	if (!usage) {
		const lines = state.error ? ERROR_TEXT[state.error] : ["loading"];
		lines.forEach((line, i) => parts.push(text(72, 76 + i * 24, 18, state.error ? WARN : LABEL, line)));
		return wrap(144, 144, parts);
	}

	const percent = Math.round(usage.percent);
	parts.push(text(72, 86, 46, usageColor(usage.percent), `${percent}%`));
	parts.push(bar(14, 100, 116, 10, usage.percent));
	const reset = formatReset(usage.resetsAt);
	if (state.error) {
		parts.push(text(72, 133, 14, WARN, ERROR_TEXT[state.error][0] ?? ""));
	} else if (reset) {
		parts.push(text(72, 133, 15, LABEL, `resets ${reset}`));
	}
	return wrap(144, 144, parts);
}

/**
 * Renders one usage window as an SVG for a 200 x 100 touch strip segment.
 * When the last request failed, the last known value is kept and marked with a warning label.
 */
export function renderUsageDial(window: WindowId, state: UsageState): string {
	const usage = state.windows[window];
	const parts = [text(12, 24, 14, LABEL, TITLES[window], "start")];

	if (!usage) {
		const line = state.error ? (ERROR_TEXT[state.error].join(" - ")) : "loading";
		parts.push(text(100, 62, 20, state.error ? WARN : LABEL, line));
		return wrap(200, 100, parts);
	}

	parts.push(text(12, 68, 42, usageColor(usage.percent), `${Math.round(usage.percent)}%`, "start"));
	const reset = formatReset(usage.resetsAt);
	if (state.error) {
		parts.push(text(188, 24, 13, WARN, ERROR_TEXT[state.error][0] ?? "", "end"));
	}
	if (reset) {
		parts.push(text(188, 68, 15, LABEL, `resets ${reset}`, "end"));
	}
	parts.push(bar(12, 80, 176, 10, usage.percent));
	return wrap(200, 100, parts);
}
