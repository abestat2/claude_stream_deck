import type { UsageError, UsageState, WindowId } from "../usage/client";

const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const DIM = "#6f675f";
const VALUE = "#f1ece4";
const TRACK = "#34302c";
const ACCENT = "#d97757";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

/** Two usage windows shown together, top to bottom. */
export type WindowPair = [WindowId, WindowId];

const TITLES: Record<WindowId, string> = {
	session: "5-HOUR",
	week: "WEEK",
	sonnet: "SONNET WK",
};

const ERROR_TEXT: Record<UsageError, string[]> = {
	"no-login": ["not signed in"],
	expired: ["login expired", "use Claude"],
	"rate-limited": ["rate limited"],
	offline: ["offline"],
	failed: ["no data"],
};

/** Bar colour for a usage percentage: terracotta until 70%, amber until 90%, then red. */
export function usageColor(percent: number): string {
	return percent >= 90 ? CRITICAL : percent >= 70 ? WARN : ACCENT;
}

/** Formats the time until a reset, for example `2h 14m`, `3d 4h`, or `45m`. */
export function formatReset(resetsAt: Date | undefined, now = Date.now()): string {
	if (!resetsAt || Number.isNaN(resetsAt.getTime())) {
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

function text(
	x: number,
	y: number,
	size: number,
	fill: string,
	content: string,
	anchor: "start" | "middle" | "end" = "middle",
	weight = 700,
): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${content}</text>`;
}

function bar(x: number, y: number, width: number, height: number, percent: number | undefined): string {
	const track = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK}"/>`;
	if (percent === undefined || percent <= 0) {
		return track;
	}
	const filled = Math.max(height, (Math.min(100, percent) / 100) * width);
	return track + `<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${height / 2}" fill="${usageColor(percent)}"/>`;
}

function wrap(width: number, height: number, parts: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${BACKGROUND}"/>${parts.join("")}</svg>`;
}

/** Note shown beside a window's title: the warning when the last request failed, otherwise the time until reset. */
function note(id: WindowId, state: UsageState): { text: string; color: string } {
	if (state.error) {
		return { text: ERROR_TEXT[state.error][0] ?? "", color: WARN };
	}
	return { text: formatReset(state.windows[id]?.resetsAt), color: DIM };
}

/** Message shown instead of the bars when neither selected window has a reading. */
function messageLines(state: UsageState): string[] {
	return state.error ? ERROR_TEXT[state.error] : ["loading"];
}

function keyRow(id: WindowId, top: number, state: UsageState): string[] {
	const usage = state.windows[id];
	const n = note(id, state);
	return [
		text(14, top + 20, 13, LABEL, TITLES[id], "start"),
		n.text ? text(130, top + 20, 12, n.color, n.text, "end", 400) : "",
		text(14, top + 48, 30, usage ? VALUE : DIM, usage ? `${Math.round(usage.percent)}%` : "--", "start"),
		bar(14, top + 55, 116, 8, usage?.percent),
	];
}

/**
 * Renders two usage windows as stacked bars in an SVG for a 144 x 144 key.
 * When the last request failed, the last known values stay on screen with a warning beside each title.
 */
export function renderUsageKey(windows: WindowPair, state: UsageState): string {
	if (!windows.some((id) => state.windows[id])) {
		const lines = messageLines(state);
		return wrap(
			144,
			144,
			lines.map((line, i) => text(72, 70 + i * 24 - (lines.length - 1) * 12, 18, state.error ? WARN : LABEL, line)),
		);
	}
	return wrap(144, 144, [...keyRow(windows[0], 0, state), ...keyRow(windows[1], 72, state)]);
}

function dialRow(id: WindowId, top: number, state: UsageState): string[] {
	const usage = state.windows[id];
	const n = note(id, state);
	const heading =
		`<text x="10" y="${top + 22}" font-family="Arial, sans-serif" font-size="12">` +
		`<tspan font-weight="700" fill="${LABEL}">${TITLES[id]}</tspan>` +
		(n.text ? `<tspan dx="8" font-weight="400" fill="${n.color}">${n.text}</tspan>` : "") +
		`</text>`;
	return [
		heading,
		text(190, top + 26, 24, usage ? VALUE : DIM, usage ? `${Math.round(usage.percent)}%` : "--", "end"),
		bar(10, top + 32, 180, 9, usage?.percent),
	];
}

/**
 * Renders two usage windows as stacked bars in an SVG for a 200 x 100 touch strip segment.
 * When the last request failed, the last known values stay on screen with a warning beside each title.
 */
export function renderUsageDial(windows: WindowPair, state: UsageState): string {
	if (!windows.some((id) => state.windows[id])) {
		const lines = messageLines(state);
		return wrap(
			200,
			100,
			lines.map((line, i) => text(100, 56 + (i - (lines.length - 1) / 2) * 24, 18, state.error ? WARN : LABEL, line)),
		);
	}
	return wrap(200, 100, [...dialRow(windows[0], 0, state), ...dialRow(windows[1], 50, state)]);
}
