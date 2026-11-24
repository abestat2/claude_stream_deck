import type { Summary } from "../state/sessions";
import { ACCENT, BACKGROUND, LABEL, VALUE } from "./palette";

/** Font size that keeps the longest label within its column. */
const LABEL_SIZE = 11;

function column(centerX: number, label: string, value: number, color: string): string {
	return (
		`<text x="${centerX}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="${LABEL_SIZE}" font-weight="700" fill="${LABEL}">${label}</text>` +
		`<text x="${centerX}" y="76" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="${color}">${value}</text>`
	);
}

/**
 * Renders the session overview as an SVG for a 200 x 100 touch strip segment:
 * session count, running subagent count, and the number of sessions waiting on the user.
 */
export function renderOverview(summary: Summary): string {
	const parts = [
		`<rect width="200" height="100" fill="${BACKGROUND}"/>`,
		column(34, "SESSIONS", summary.sessions, summary.working > 0 ? ACCENT : VALUE),
		column(100, "AGENTS", summary.agents, summary.agents > 0 ? ACCENT : VALUE),
		column(166, "WAITING", summary.attention, summary.attention > 0 ? ACCENT : VALUE),
	];

	return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`;
}
