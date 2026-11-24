import type { Summary } from "../state/sessions";

const LABEL_COLOR = "#8a8178";
const VALUE_COLOR = "#f1ece4";
const ATTENTION_COLOR = "#ffb454";
const WORKING_COLOR = "#d97757";

function column(centerX: number, label: string, value: number, color: string): string {
	return (
		`<text x="${centerX}" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="${LABEL_COLOR}">${label}</text>` +
		`<text x="${centerX}" y="76" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="${color}">${value}</text>`
	);
}

/**
 * Renders the session overview as an SVG for a 200 x 100 touch strip segment:
 * session count, running subagent count, and the number of sessions waiting on the user.
 */
export function renderOverview(summary: Summary): string {
	const parts = [
		`<rect width="200" height="100" fill="#1f1d1a"/>`,
		column(34, "SESSIONS", summary.sessions, summary.working > 0 ? WORKING_COLOR : VALUE_COLOR),
		column(100, "AGENTS", summary.agents, summary.agents > 0 ? WORKING_COLOR : VALUE_COLOR),
		column(166, "WAITING", summary.attention, summary.attention > 0 ? ATTENTION_COLOR : VALUE_COLOR),
	];

	return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`;
}
