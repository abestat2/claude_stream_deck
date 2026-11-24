import type { Summary } from "../state/sessions";

/** Edge length in pixels of one sprite cell. The key image is 24 x 24 cells. */
const CELL = 6;

const BODY = "#d97757";
const DARK = "#1f1d1a";
const SHADOW = "#34302c";

/** Horizontal body offsets, in cells, for one full walk cycle. */
const WALK_PATH = [0, 1, 2, 1, 0, -1, -2, -1];

const LABEL = {
	idle: { text: "idle", color: "#8a8178" },
	working: { text: "working", color: "#d97757" },
	attention: { text: "NEEDS YOU", color: "#ffb454" },
} as const;

function cell(x: number, y: number, w: number, h: number, fill: string): string {
	return `<rect x="${x * CELL}" y="${y * CELL}" width="${w * CELL}" height="${h * CELL}" fill="${fill}"/>`;
}

/**
 * Number of animation frames before the sequence repeats for a state.
 * An idle character is a single static frame.
 */
export function frameCount(state: Summary["overall"]): number {
	return state === "idle" ? 1 : WALK_PATH.length;
}

/**
 * Renders the status character as an SVG for a 144 x 144 key.
 * - `idle`: standing still.
 * - `working`: walking back and forth, looking in the direction of travel.
 * - `attention`: hopping with wide eyes and an exclamation mark, on a pulsing background.
 * @param summary Aggregate session state to draw.
 * @param frame Animation frame index.
 */
export function renderCharacter(summary: Summary, frame: number): string {
	const state = summary.overall;
	const step = frame % WALK_PATH.length;
	const odd = frame % 2 === 1;

	let shift = 0;
	let look = 0;
	let bob = 0;
	let leftLegUp = false;
	let rightLegUp = false;
	let leftArm = 0;
	let rightArm = 0;
	let eyeHeight = 2;
	let background = DARK;

	if (state === "working") {
		shift = WALK_PATH[step] ?? 0;
		look = Math.sign((WALK_PATH[(step + 1) % WALK_PATH.length] ?? 0) - shift);
		bob = odd ? -1 : 0;
		leftLegUp = !odd;
		rightLegUp = odd;
		leftArm = odd ? 1 : 0;
		rightArm = odd ? 0 : 1;
	} else if (state === "attention") {
		bob = odd ? -2 : 0;
		leftArm = odd ? -2 : 0;
		rightArm = odd ? -2 : 0;
		eyeHeight = 3;
		background = odd ? "#3a2a12" : DARK;
	}

	const x = 5 + shift;
	const y = 6 + bob;
	const parts: string[] = [];

	parts.push(`<rect width="144" height="144" fill="${background}"/>`);
	parts.push(cell(x + 3, 17, 8, 1, SHADOW));
	parts.push(cell(x + 3, y, 2, 2, BODY));
	parts.push(cell(x + 9, y, 2, 2, BODY));
	parts.push(cell(x + 2, y + 2, 10, 7, BODY));
	parts.push(cell(x, y + 4 + leftArm, 2, 2, BODY));
	parts.push(cell(x + 12, y + 4 + rightArm, 2, 2, BODY));
	parts.push(cell(x + 3, y + 9, 2, leftLegUp ? 1 : 2, BODY));
	parts.push(cell(x + 9, y + 9, 2, rightLegUp ? 1 : 2, BODY));
	parts.push(cell(x + 4 + look, y + 4, 1, eyeHeight, DARK));
	parts.push(cell(x + 9 + look, y + 4, 1, eyeHeight, DARK));

	if (state === "attention") {
		parts.push(`<text x="72" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#ffb454">!</text>`);
	}

	if (summary.agents > 0) {
		const noun = summary.agents === 1 ? "agent" : "agents";
		parts.push(
			`<text x="8" y="20" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#cfc7bd">${summary.agents} ${noun}</text>`,
		);
	}

	const label = LABEL[state];
	parts.push(
		`<text x="72" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${label.color}">${label.text}</text>`,
	);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`;
}

/** Encodes an SVG document as a data URI accepted by Stream Deck image commands. */
export function svgDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
