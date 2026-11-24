import { describe, expect, it } from "vitest";
import { renderPrompts, wrapLabel } from "../../src/render/prompts";
import { textContent, xmlProblem } from "../helpers/xml";

describe("wrapLabel", () => {
	it("returns no lines for an empty or blank label", () => {
		expect(wrapLabel("")).toEqual([]);
		expect(wrapLabel("   \t\n ")).toEqual([]);
	});

	it("keeps a short label on one line", () => {
		expect(wrapLabel("yes")).toEqual(["yes"]);
	});

	it("keeps a label of exactly 14 characters on one line", () => {
		expect(wrapLabel("abcdefghijklmn")).toEqual(["abcdefghijklmn"]);
		expect(wrapLabel("aaaaaa bbbbbbb")).toEqual(["aaaaaa bbbbbbb"]);
	});

	it("wraps at the word boundary when the next word does not fit", () => {
		expect(wrapLabel("please commit now")).toEqual(["please commit", "now"]);
	});

	it("collapses runs of whitespace between words", () => {
		expect(wrapLabel("  a   b \n c ")).toEqual(["a b c"]);
	});

	it("breaks a word longer than the line into pieces", () => {
		expect(wrapLabel("aaaaaaaaaaaaaaa")).toEqual(["aaaaaaaaaaaaaa", "a"]);
	});

	it("fits a word of exactly two lines without truncation", () => {
		expect(wrapLabel("a".repeat(28))).toEqual(["a".repeat(14), "a".repeat(14)]);
	});

	it("starts an overlong word on a new line after earlier words", () => {
		expect(wrapLabel("ab " + "c".repeat(20))).toEqual(["ab", "c".repeat(13) + "…"]);
	});

	it("truncates a label of more than two lines with an ellipsis", () => {
		const lines = wrapLabel("one two three four five six seven eight nine");
		expect(lines).toEqual(["one two three", "four five six…"]);
	});

	it("truncates a very long word to two lines ending with an ellipsis", () => {
		const lines = wrapLabel("x".repeat(100));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe("x".repeat(14));
		expect(lines[1]).toBe("x".repeat(13) + "…");
	});

	it("never returns a line longer than 14 characters", () => {
		for (const label of ["a b c d e f g h i j k l m n o p", "x".repeat(60), "word ".repeat(30), "ab ".repeat(2) + "z".repeat(40)]) {
			for (const line of wrapLabel(label)) {
				expect(line.length).toBeLessThanOrEqual(14);
			}
		}
	});

	it("never returns more than two lines", () => {
		expect(wrapLabel("word ".repeat(50)).length).toBe(2);
	});

	it("does not append an ellipsis when the label fits", () => {
		expect(wrapLabel("one two three four").join("")).not.toContain("…");
	});

	it("keeps non-ASCII text intact", () => {
		expect(wrapLabel("héllo wörld")).toEqual(["héllo wörld"]);
	});
});

describe("renderPrompts", () => {
	const prompts = [
		{ label: "yes", text: "yes" },
		{ label: "please commit", text: "please commit" },
		{ label: "/graphify", text: "/graphify" },
	];

	it("produces a well-formed 200 x 100 SVG", () => {
		const svg = renderPrompts(prompts, 0, false);
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain('width="200"');
		expect(svg).toContain('viewBox="0 0 200 100"');
	});

	it("shows the highlighted label and its position", () => {
		const text = textContent(renderPrompts(prompts, 1, false));
		expect(text).toContain("PROMPT");
		expect(text).toContain("please commit");
		expect(text).toContain("2 / 3");
	});

	it("shows press to send before sending and sent afterwards", () => {
		expect(textContent(renderPrompts(prompts, 0, false))).toContain("press to send");
		const sent = textContent(renderPrompts(prompts, 0, true));
		expect(sent).toContain("sent");
		expect(sent).not.toContain("press to send");
	});

	it("shows navigation arrows only when there is more than one prompt", () => {
		expect(renderPrompts(prompts, 0, false)).toContain("&#8249;");
		expect(renderPrompts(prompts, 0, false)).toContain("&#8250;");
		expect(renderPrompts(prompts.slice(0, 1), 0, false)).not.toContain("&#8249;");
	});

	it("positions two label lines one below the other, above the caption", () => {
		const labelYs = (svg: string) => [...svg.matchAll(/y="(\d+)" text-anchor="middle" font-family="Arial, sans-serif" font-size="20"/g)].map((m) => Number(m[1]));
		const one = labelYs(renderPrompts(prompts, 0, false));
		const two = labelYs(renderPrompts([{ label: "please commit now", text: "x" }], 0, false));
		expect(one).toHaveLength(1);
		expect(two).toHaveLength(2);
		expect(two[0]).toBeLessThan(two[1] as number);
		expect(two[1]).toBeLessThan(94);
	});

	it("escapes markup characters in labels", () => {
		const svg = renderPrompts([{ label: `<b>&"x"</b>`, text: "t" }], 0, false);
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
		expect(svg).not.toContain("<b>");
	});

	it("escapes an ampersand that would otherwise form an entity", () => {
		const svg = renderPrompts([{ label: "&lt;", text: "t" }], 0, false);
		expect(svg).toContain("&amp;lt;");
		expect(xmlProblem(svg)).toBe("");
	});

	it("escapes labels that wrap onto two lines", () => {
		const svg = renderPrompts([{ label: "<<<<<< >>>>>> &&&&&& ''''''", text: "t" }], 0, false);
		expect(xmlProblem(svg)).toBe("");
	});

	it("renders without a label when the index is out of range", () => {
		const svg = renderPrompts(prompts, 9, false);
		expect(xmlProblem(svg)).toBe("");
		expect(textContent(svg)).toContain("10 / 3");
	});
});
