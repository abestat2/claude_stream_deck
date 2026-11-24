import { clipText, escapeXml } from "./text";

const BACKGROUND = "#1f1d1a";
const LABEL = "#8a8178";
const VALUE = "#f1ece4";
const ACCENT = "#d97757";
const OK = "#7fb77e";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

type ModeStyle = { name: string; color: string };

const MODES: Record<string, ModeStyle> = {
	default: { name: "Default", color: VALUE },
	acceptEdits: { name: "Accept edits", color: ACCENT },
	plan: { name: "Plan", color: OK },
	auto: { name: "Auto", color: WARN },
	dontAsk: { name: "Don't ask", color: WARN },
	bypassPermissions: { name: "Bypass", color: CRITICAL },
};

/** Display name and colour for a permission mode. Unknown modes are shown by their reported name. */
export function modeStyle(mode: string | undefined): ModeStyle {
	if (!mode) {
		return { name: "--", color: LABEL };
	}
	return MODES[mode] ?? { name: mode, color: VALUE };
}

function lines(name: string): string[] {
	const words = name.split(" ");
	return words.length > 1 && name.length > 9 ? [words[0] ?? "", words.slice(1).join(" ")] : [name];
}

/**
 * Renders the current permission mode as an SVG for a 144 x 144 key.
 * @param mode Permission mode reported by the most recently active session.
 * @param project Project of that session.
 * @param stale True after the key was pressed and before a newer event confirms the mode.
 */
export function renderMode(mode: string | undefined, project: string, stale: boolean): string {
	const style = modeStyle(mode);
	const nameLines = lines(style.name);
	const size = nameLines.some((line) => line.length > 9) ? 22 : 28;

	const parts = [
		`<rect width="144" height="144" fill="${BACKGROUND}"/>`,
		`<text x="12" y="28" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="${LABEL}">MODE</text>`,
	];

	nameLines.forEach((line, i) => {
		const y = (nameLines.length === 1 ? 82 : 70) + i * 30;
		parts.push(
			`<text x="72" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="${style.color}">${escapeXml(line)}</text>`,
		);
	});

	const caption = stale ? "cycled - updates next message" : project;
	if (caption) {
		parts.push(
			`<text x="72" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-size="${stale ? 11 : 13}" font-weight="700" fill="${stale ? WARN : LABEL}">${escapeXml(clipText(caption, 30))}</text>`,
		);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
}
