import { formatClock } from "./character";
import { clipText, escapeXml } from "./text";

const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const DIM = "#6f675f";
const VALUE = "#f1ece4";
const ACCENT = "#d97757";
const OK = "#7fb77e";
const WARN = "#ffb454";

/** One session as shown on the dial. */
export type SessionView = {
	project: string;
	state: "idle" | "working" | "attention" | "done";
	/** Subagents running in the session. */
	agents: number;
	/** Milliseconds the current turn has run, while working. */
	turnMs: number | undefined;
	/** Milliseconds the session has waited on the user, while waiting. */
	waitMs: number | undefined;
	/** Tool the session used most recently. */
	tool: string | undefined;
	/** Description of what the session is waiting for. */
	request: string | undefined;
	model: string | undefined;
};

function text(
	x: number,
	y: number,
	size: number,
	fill: string,
	content: string,
	anchor: "start" | "middle" | "end" = "middle",
	weight = 700,
): string {
	return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(content)}</text>`;
}

/** Returns the state line and its colour for a session, for example `working 2:14` or `needs you 3m`. */
export function stateLine(view: SessionView): { text: string; color: string } {
	const agents = view.agents > 0 ? ` +${view.agents} ${view.agents === 1 ? "agent" : "agents"}` : "";
	switch (view.state) {
		case "working":
			return { text: `working${view.turnMs !== undefined ? ` ${formatClock(view.turnMs)}` : ""}${agents}`, color: ACCENT };
		case "attention": {
			const minutes = view.waitMs !== undefined && view.waitMs >= 60_000 ? ` ${Math.floor(view.waitMs / 60_000)}m` : "";
			return { text: `needs you${minutes}`, color: WARN };
		}
		case "done":
			return { text: `done${agents}`, color: OK };
		default:
			return { text: `idle${agents}`, color: LABEL };
	}
}

/** Returns the detail line for a session: what it waits for, the tool it is using, or its model. */
export function detailLine(view: SessionView): string {
	if (view.state === "attention") {
		return view.request ?? "";
	}
	if (view.state === "working") {
		return view.tool ?? "thinking";
	}
	return view.model ?? "";
}

/**
 * Renders one session as an SVG for a 200 x 100 touch strip segment: its project, state with timer,
 * and a detail line.
 * @param view The session to show, or undefined when no session is tracked.
 * @param index Position of the session in the list, starting at zero.
 * @param total Number of sessions in the list.
 */
export function renderSessions(view: SessionView | undefined, index: number, total: number): string {
	const parts = [`<rect width="200" height="100" fill="${BACKGROUND}"/>`, text(10, 20, 13, LABEL, "SESSIONS", "start")];

	if (!view) {
		parts.push(text(100, 56, 18, LABEL, "no sessions"));
		parts.push(text(100, 78, 13, DIM, "start Claude Code", "middle", 400));
	} else {
		parts.push(text(190, 20, 13, DIM, `${index + 1} / ${total}`, "end"));
		const name = clipText(view.project || "unnamed", 16);
		parts.push(text(100, 50, name.length <= 8 ? 22 : name.length <= 13 ? 18 : 15, VALUE, name));
		const state = stateLine(view);
		parts.push(text(100, 72, 15, state.color, state.text));
		const detail = detailLine(view);
		if (detail) {
			parts.push(text(100, 91, 12, DIM, clipText(detail, 30), "middle", 400));
		}
		if (total > 1) {
			parts.push(text(8, 54, 24, DIM, "‹", "start", 400));
			parts.push(text(192, 54, 24, DIM, "›", "end", 400));
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`;
}
