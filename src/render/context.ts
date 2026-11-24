import { escapeXml, clipText } from "./text";
import { usageColor } from "./usage";

const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const DIM = "#6f675f";
const VALUE = "#f1ece4";
const TRACK = "#34302c";
const WARN = "#ffb454";

/** Context window use of one session. */
export type ContextInfo = {
	percent: number;
	tokens: number | undefined;
	size: number | undefined;
	model: string | undefined;
};

/** Why no context reading is available: no status line update has arrived, or none has a reading yet. */
export type ContextMissing = "not-set-up" | "no-messages";

/** Formats a token count compactly, for example `950`, `112k`, or `1M`. */
export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) {
		const millions = tokens / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${Math.round(tokens / 1_000)}k`;
	}
	return String(tokens);
}

function usage(info: ContextInfo): string {
	if (info.tokens === undefined) {
		return "";
	}
	return info.size === undefined ? formatTokens(info.tokens) : `${formatTokens(info.tokens)} / ${formatTokens(info.size)}`;
}

function bar(x: number, y: number, width: number, height: number, percent: number): string {
	const track = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK}"/>`;
	if (percent <= 0) {
		return track;
	}
	const filled = Math.max(height, (Math.min(100, percent) / 100) * width);
	return track + `<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${height / 2}" fill="${usageColor(percent)}"/>`;
}

function text(x: number, y: number, size: number, fill: string, content: string, anchor: "start" | "middle" | "end" = "start"): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fill}">${escapeXml(content)}</text>`;
}

function wrap(width: number, height: number, parts: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${BACKGROUND}"/>${parts.join("")}</svg>`;
}

function missingLines(reason: ContextMissing): string[] {
	return reason === "not-set-up" ? ["no data", "set up status line"] : ["no messages", "yet"];
}

/** Renders context window use as an SVG for a 144 x 144 key. */
export function renderContextKey(info: ContextInfo | undefined, reason: ContextMissing): string {
	const parts = [text(12, 28, 16, LABEL, "CONTEXT")];

	if (!info) {
		missingLines(reason).forEach((line, i) => parts.push(text(72, 76 + i * 22, i === 0 ? 18 : 14, i === 0 ? WARN : LABEL, line, "middle")));
		return wrap(144, 144, parts);
	}

	parts.push(text(72, 82, 44, VALUE, `${Math.round(info.percent)}%`, "middle"));
	parts.push(bar(14, 94, 116, 10, info.percent));
	const detail = usage(info);
	if (detail) {
		parts.push(text(72, 123, 13, LABEL, detail, "middle"));
	}
	if (info.model) {
		parts.push(text(72, 139, 11, DIM, clipText(info.model, 20), "middle"));
	}
	return wrap(144, 144, parts);
}

/** Renders context window use as an SVG for a 200 x 100 touch strip segment. */
export function renderContextDial(info: ContextInfo | undefined, reason: ContextMissing): string {
	const parts = [text(12, 24, 14, LABEL, "CONTEXT")];

	if (!info) {
		missingLines(reason).forEach((line, i) => parts.push(text(100, 58 + i * 22, i === 0 ? 18 : 14, i === 0 ? WARN : LABEL, line, "middle")));
		return wrap(200, 100, parts);
	}

	if (info.model) {
		parts.push(text(188, 24, 12, DIM, clipText(info.model, 16), "end"));
	}
	parts.push(text(12, 68, 40, VALUE, `${Math.round(info.percent)}%`));
	const detail = usage(info);
	if (detail) {
		parts.push(text(188, 68, 14, LABEL, detail, "end"));
	}
	parts.push(bar(12, 80, 176, 10, info.percent));
	return wrap(200, 100, parts);
}
