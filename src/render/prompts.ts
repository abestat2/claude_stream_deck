import { wrapText } from "./text";

const LABEL = "#8a8178";
const DIM = "#6f675f";
const VALUE = "#f1ece4";
const ACCENT = "#d97757";

/** Longest line, in characters, that fits between the arrows at the 20 px font size. */
const MAX_LINE_CHARS = 14;
const MAX_LINES = 2;

/** A saved prompt: the name shown on the strip and the text that is sent. */
export type Prompt = { label: string; text: string };

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Splits a label into at most two lines of whole words, breaking overlong words and
 * ending with an ellipsis when the label does not fit.
 */
export function wrapLabel(label: string): string[] {
	return wrapText(label, MAX_LINE_CHARS, MAX_LINES);
}

/**
 * Renders the saved prompt picker as an SVG for a 200 x 100 touch strip segment.
 * @param prompts All selectable prompts.
 * @param index Index of the highlighted prompt.
 * @param sent True when the highlighted prompt is the one most recently sent.
 */
export function renderPrompts(prompts: Prompt[], index: number, sent: boolean): string {
	const lines = wrapLabel(prompts[index]?.label ?? "");
	const font = (size: number, weight: number, fill: string): string =>
		`font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}"`;

	const parts = [
		`<rect width="200" height="100" fill="#1f1d1a"/>`,
		`<text x="10" y="20" ${font(13, 700, LABEL)}>PROMPT</text>`,
		`<text x="190" y="20" text-anchor="end" ${font(13, 700, DIM)}>${index + 1} / ${prompts.length}</text>`,
	];

	lines.forEach((line, i) => {
		const y = lines.length === 1 ? 60 : 47 + i * 23;
		parts.push(`<text x="100" y="${y}" text-anchor="middle" ${font(20, 700, VALUE)}>${escapeXml(line)}</text>`);
	});

	if (prompts.length > 1) {
		parts.push(`<text x="8" y="62" ${font(24, 400, DIM)}>&#8249;</text>`);
		parts.push(`<text x="192" y="62" text-anchor="end" ${font(24, 400, DIM)}>&#8250;</text>`);
	}

	parts.push(`<text x="100" y="94" text-anchor="middle" ${font(13, 700, sent ? LABEL : ACCENT)}>${sent ? "sent" : "press to send"}</text>`);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`;
}
