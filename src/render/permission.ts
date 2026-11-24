import { clipText, escapeXml, wrapText } from "./text";

const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const DIM = "#6f675f";
const VALUE = "#f1ece4";
const DETAIL = "#cfc7bd";
const ACCENT = "#d97757";
const OK = "#7fb77e";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

/** How a permission key answers a request. */
export type PermissionResponseKind = "allow" | "always" | "deny";

const HEADERS: Record<PermissionResponseKind, { text: string; color: string }> = {
	allow: { text: "ALLOW", color: OK },
	always: { text: "ALWAYS", color: ACCENT },
	deny: { text: "DENY", color: CRITICAL },
};

/** A pending permission request to display. */
export type PermissionInfo = {
	tool: string;
	detail: string;
	project: string;
	/** Number of other sessions that are also waiting. */
	others: number;
};

function text(x: number, y: number, size: number, fill: string, content: string, anchor: "start" | "middle" | "end" = "start"): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fill}">${escapeXml(content)}</text>`;
}

/**
 * Renders a permission response key as an SVG for a 144 x 144 key.
 * With a pending request it shows the tool, a short description of the request, and the project it
 * came from. Without one it shows that there is nothing to answer.
 * @param kind The answer this key gives.
 * @param info The pending request, or undefined when none is waiting.
 * @param sent True just after the key was pressed.
 */
export function renderPermission(kind: PermissionResponseKind, info: PermissionInfo | undefined, sent: boolean): string {
	const header = HEADERS[kind];
	const parts = [`<rect width="144" height="144" fill="${BACKGROUND}"/>`];

	if (!info) {
		parts.push(text(12, 28, 17, DIM, header.text));
		parts.push(text(72, 82, 17, LABEL, "no request", "middle"));
		return wrap(parts);
	}

	parts.push(text(12, 28, 17, header.color, header.text));
	if (info.others > 0) {
		parts.push(text(132, 28, 15, WARN, `+${info.others}`, "end"));
	}

	parts.push(text(12, 54, 16, VALUE, clipText(info.tool || "request", 13)));
	wrapText(info.detail, 17, 3).forEach((line, i) => parts.push(text(12, 76 + i * 16, 13, DETAIL, line)));

	if (sent) {
		parts.push(text(72, 134, 14, header.color, "sent", "middle"));
	} else if (info.project) {
		parts.push(text(72, 134, 13, LABEL, clipText(info.project, 18), "middle"));
	}

	return wrap(parts);
}

function wrap(parts: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
}
