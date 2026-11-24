import { clipText, escapeXml } from "./text";

import { ACCENT, BACKGROUND, CRITICAL, LABEL, VALUE } from "./palette";

type ModeStyle = { name: string; color: string };

const MODES: Record<string, ModeStyle> = {
	default: { name: "Default", color: VALUE },
	acceptEdits: { name: "Accept edits", color: ACCENT },
	plan: { name: "Plan", color: ACCENT },
	auto: { name: "Auto", color: ACCENT },
	dontAsk: { name: "Don't ask", color: ACCENT },
	bypassPermissions: { name: "Bypass", color: CRITICAL },
};

/** Display name and colour for a permission mode. Unknown modes are shown by their reported name. */
export function modeStyle(mode: string | undefined): ModeStyle {
	if (!mode) {
		return { name: "--", color: LABEL };
	}
	return Object.hasOwn(MODES, mode) ? (MODES[mode] as ModeStyle) : { name: mode, color: VALUE };
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
 * @param predicted True when `mode` is the expected result of cycling, not a reported mode.
 */
export function renderMode(mode: string | undefined, project: string, stale: boolean, predicted = false): string {
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

	const caption = stale ? (predicted ? "predicted" : "updates next msg") : project;
	if (caption) {
		parts.push(
			`<text x="72" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-size="${stale ? 11 : 13}" font-weight="700" fill="${stale ? ACCENT : LABEL}">${escapeXml(clipText(caption, stale ? 24 : 18))}</text>`,
		);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
}
