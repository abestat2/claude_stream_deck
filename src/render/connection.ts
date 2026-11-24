const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const VALUE = "#f1ece4";
const OK = "#7fb77e";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

/** Connection details to display. */
export type ConnectionInfo = {
	/** True while the hook receiver is accepting connections. */
	listening: boolean;
	/** Receiver error, such as the port being in use. */
	serverError: string | undefined;
	/** Milliseconds since the last hook event, or undefined when none has arrived. */
	sinceLastEventMs: number | undefined;
	/** Milliseconds since the last status line update, or undefined when none has arrived. */
	sinceLastStatusMs?: number | undefined;
	sessions: number;
	/** Usage reading status: `ok`, an error name, or undefined when usage is not being read. */
	usage: string | undefined;
};

/** Formats an elapsed time as seconds, minutes, hours, or days, for example `45s ago` or `3h ago`. */
export function formatAgo(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function row(y: number, label: string, value: string, color: string): string {
	return (
		`<text x="12" y="${y}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${LABEL}">${label}</text>` +
		`<text x="132" y="${y}" text-anchor="end" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${color}">${value}</text>`
	);
}

/**
 * Renders the connection health as an SVG for a 144 x 144 key: whether hook events are arriving,
 * how many sessions are tracked, and whether usage can be read.
 */
export function renderConnection(info: ConnectionInfo): string {
	let hooks: { text: string; color: string };
	if (info.serverError) {
		hooks = { text: "port busy", color: CRITICAL };
	} else if (!info.listening) {
		hooks = { text: "starting", color: WARN };
	} else if (info.sinceLastEventMs === undefined) {
		hooks = { text: "none yet", color: WARN };
	} else {
		hooks = { text: formatAgo(info.sinceLastEventMs), color: VALUE };
	}

	const healthy = info.listening && !info.serverError && info.sinceLastEventMs !== undefined;
	const usageColor = info.usage === "ok" ? OK : info.usage === undefined ? LABEL : WARN;

	const parts = [
		`<rect width="144" height="144" fill="${BACKGROUND}"/>`,
		`<text x="12" y="28" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="${LABEL}">LINK</text>`,
		`<circle cx="124" cy="22" r="8" fill="${info.serverError ? CRITICAL : healthy ? OK : WARN}"/>`,
		row(58, "HOOKS", hooks.text, hooks.color),
		row(82, "STATUS", info.sinceLastStatusMs === undefined ? "none yet" : formatAgo(info.sinceLastStatusMs), info.sinceLastStatusMs === undefined ? WARN : VALUE),
		row(106, "SESSIONS", String(info.sessions), VALUE),
		row(130, "USAGE", info.usage ?? "off", usageColor),
	];

	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
}
