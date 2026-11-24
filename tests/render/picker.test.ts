import { describe, expect, it } from "vitest";
import { renderPicker } from "../../src/render/picker";
import { xmlProblem } from "../helpers/xml";
import { fillOf, textElements } from "../helpers/svg";

const OK = "#7fb77e";
const LABEL = "#8a8178";
const ACCENT = "#d97757";
const DIM = "#6f675f";

const MODELS = ["opus", "sonnet", "haiku"];

describe("renderPicker header", () => {
	it("centres the title when no current model is given", () => {
		const svg = renderPicker(MODELS, 0, false);
		expect(svg).toContain('<text x="100" y="20" text-anchor="middle"');
		expect(textElements(svg)).toContain("MODEL");
	});

	it("matches the output of the call without the optional parameters", () => {
		expect(renderPicker(MODELS, 1, true, undefined, false)).toBe(renderPicker(MODELS, 1, true));
	});

	it("left-aligns the title and shows the current model at the right edge", () => {
		const svg = renderPicker(MODELS, 0, false, "Opus 4");
		expect(svg).toContain('<text x="10" y="20"');
		expect(svg).toContain('<text x="190" y="20" text-anchor="end"');
		expect(textElements(svg).slice(0, 2)).toEqual(["MODEL", "Opus 4"]);
		expect(fillOf(svg, "Opus 4")).toBe(DIM);
	});

	it("clips a long current model name to 18 characters", () => {
		const svg = renderPicker(MODELS, 0, false, "Claude Opus 4.1 with extras");
		expect(textElements(svg)).toContain("Claude Opus 4.1 w…");
	});

	it("escapes the current model name", () => {
		const svg = renderPicker(MODELS, 0, false, `<x>&"y"`);
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain("&lt;x&gt;&amp;&quot;y&quot;");
	});
});

describe("renderPicker caption", () => {
	it("shows press to send by default in the accent colour", () => {
		expect(fillOf(renderPicker(MODELS, 0, false), "press to send")).toBe(ACCENT);
	});

	it("shows sent in the label colour", () => {
		expect(fillOf(renderPicker(MODELS, 0, true), "sent")).toBe(LABEL);
	});

	it("shows active in green", () => {
		expect(fillOf(renderPicker(MODELS, 0, false, "Opus", true), "active")).toBe(OK);
	});

	it("prefers active over sent", () => {
		const text = textElements(renderPicker(MODELS, 0, true, "Opus", true));
		expect(text).toContain("active");
		expect(text).not.toContain("sent");
	});

	it("prefers sent over press to send", () => {
		const text = textElements(renderPicker(MODELS, 0, true, "Opus", false));
		expect(text).toContain("sent");
		expect(text).not.toContain("press to send");
	});

	it("shows active when no current model name is given", () => {
		expect(textElements(renderPicker(MODELS, 0, false, undefined, true))).toContain("active");
	});

	it("produces well-formed SVG for every combination", () => {
		for (const current of [undefined, "Opus"]) {
			for (const sent of [false, true]) {
				for (const active of [false, true]) {
					expect(xmlProblem(renderPicker(MODELS, 2, sent, current, active))).toBe("");
				}
			}
		}
	});
});
