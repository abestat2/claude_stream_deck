const DIM = "#6f675f";
const LABEL = "#8a8178";
const NAME = "#f1ece4";
const ACCENT = "#d97757";

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Font size that keeps a name within the 200 px wide strip segment. */
function nameFontSize(name: string): number {
	if (name.length <= 8) return 34;
	if (name.length <= 12) return 26;
	return 18;
}

/**
 * Renders the model picker as an SVG for a 200 x 100 touch strip segment.
 * @param models All selectable model names.
 * @param index Index of the highlighted model.
 * @param sent True when the highlighted model is the one most recently sent to the terminal.
 */
export function renderPicker(models: string[], index: number, sent: boolean): string {
	const name = models[index] ?? "";
	const parts = [
		`<rect width="200" height="100" fill="#1f1d1a"/>`,
		`<text x="100" y="20" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${LABEL}">MODEL</text>`,
		`<text x="100" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-size="${nameFontSize(name)}" font-weight="700" fill="${NAME}">${escapeXml(name)}</text>`,
	];

	if (models.length > 1) {
		parts.push(`<text x="10" y="58" font-family="Arial, sans-serif" font-size="22" fill="${DIM}">&#8249;</text>`);
		parts.push(`<text x="190" y="58" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="${DIM}">&#8250;</text>`);
	}

	const caption = sent ? "sent" : "press to send";
	parts.push(
		`<text x="100" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${sent ? LABEL : ACCENT}">${caption}</text>`,
	);

	const dots = Math.min(models.length, 12);
	if (models.length > 1) {
		const gap = 10;
		const start = 100 - ((dots - 1) * gap) / 2;
		for (let i = 0; i < dots; i++) {
			parts.push(`<circle cx="${start + i * gap}" cy="76" r="2.5" fill="${i === index % dots ? ACCENT : DIM}"/>`);
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`;
}
