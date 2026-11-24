import { describe, expect, it } from "vitest";
import { frameCount, renderCharacter, svgDataUri } from "../../src/render/character";
import { renderOverview } from "../../src/render/overview";
import { renderPicker } from "../../src/render/picker";
import type { Summary } from "../../src/state/sessions";
import { textContent, xmlProblem } from "../helpers/xml";

const summary = (overall: Summary["overall"], extra: Partial<Summary> = {}): Summary => ({
	sessions: 0,
	working: 0,
	attention: 0,
	done: 0,
	idle: 0,
	agents: 0,
	overall,
	...extra,
});

describe("renderCharacter", () => {
	it.each(["idle", "working", "attention", "done"] as const)("renders a well-formed 144 x 144 SVG for %s", (state) => {
		for (let frame = 0; frame < 10; frame++) {
			const svg = renderCharacter(summary(state), frame);
			expect(xmlProblem(svg)).toBe("");
			expect(svg).toContain('viewBox="0 0 144 144"');
		}
	});

	it("labels each state", () => {
		expect(textContent(renderCharacter(summary("idle"), 0))).toBe("idle");
		expect(textContent(renderCharacter(summary("working"), 0))).toBe("working");
		expect(textContent(renderCharacter(summary("attention"), 0))).toContain("NEEDS YOU");
		expect(textContent(renderCharacter(summary("done"), 0))).toBe("done");
	});

	it("draws different frames while working and identical frames while idle", () => {
		expect(renderCharacter(summary("working"), 0)).not.toBe(renderCharacter(summary("working"), 1));
		expect(renderCharacter(summary("idle"), 0)).toBe(renderCharacter(summary("idle"), 0));
	});

	it("repeats the working animation after frameCount frames", () => {
		const n = frameCount("working");
		expect(renderCharacter(summary("working"), 0)).toBe(renderCharacter(summary("working"), n));
	});
});

describe("frameCount", () => {
	it("is one for static states and more for animated ones", () => {
		expect(frameCount("idle")).toBe(1);
		expect(frameCount("done")).toBe(1);
		expect(frameCount("working")).toBeGreaterThan(1);
		expect(frameCount("attention")).toBeGreaterThan(1);
	});
});

describe("svgDataUri", () => {
	it("encodes the SVG as base64 that decodes to the original text", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg">é日本</svg>';
		const uri = svgDataUri(svg);
		expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
		expect(Buffer.from(uri.split(",")[1] as string, "base64").toString("utf8")).toBe(svg);
	});
});

describe("renderOverview", () => {
	it("shows the session, agent and waiting counts", () => {
		const svg = renderOverview(summary("attention", { sessions: 4, agents: 2, attention: 1, working: 1 }));
		expect(xmlProblem(svg)).toBe("");
		expect(textContent(svg)).toBe("SESSIONS4AGENTS2WAITING1");
	});

	it("shows zeros for an empty summary", () => {
		expect(textContent(renderOverview(summary("idle")))).toBe("SESSIONS0AGENTS0WAITING0");
	});
});

describe("renderPicker", () => {
	it("shows the highlighted model and its caption", () => {
		const svg = renderPicker(["opus", "sonnet"], 1, false);
		expect(xmlProblem(svg)).toBe("");
		expect(textContent(svg)).toContain("sonnet");
		expect(textContent(svg)).toContain("press to send");
		expect(textContent(renderPicker(["opus"], 0, true))).toContain("sent");
	});

	it("escapes markup characters in model names", () => {
		const svg = renderPicker(['<x>&"y"'], 0, false);
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain("&lt;x&gt;&amp;&quot;y&quot;");
	});

	it("draws one position dot per model up to twelve, and none for a single model", () => {
		expect(renderPicker(["a"], 0, false)).not.toContain("<circle");
		expect(renderPicker(["a", "b", "c"], 0, false).match(/<circle/g)).toHaveLength(3);
		const many = Array.from({ length: 20 }, (_, i) => `m${i}`);
		expect(renderPicker(many, 15, false).match(/<circle/g)).toHaveLength(12);
	});

	it("renders an empty name when the index is out of range", () => {
		expect(xmlProblem(renderPicker(["a"], 5, false))).toBe("");
	});
});
