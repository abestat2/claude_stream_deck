import { describe, expect, it } from "vitest";
import { modeStyle, renderMode } from "../../src/render/mode";
import { xmlProblem } from "../helpers/xml";
import { fillOf, textElements } from "../helpers/svg";

const LABEL = "#8a8178";
const VALUE = "#f1ece4";
const ACCENT = "#d97757";
const OK = "#7fb77e";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

describe("modeStyle", () => {
	it.each([
		["default", "Default", VALUE],
		["acceptEdits", "Accept edits", ACCENT],
		["plan", "Plan", OK],
		["auto", "Auto", WARN],
		["dontAsk", "Don't ask", WARN],
		["bypassPermissions", "Bypass", CRITICAL],
	])("maps %s to %s", (mode, name, color) => {
		expect(modeStyle(mode)).toEqual({ name, color });
	});

	it("shows an unknown mode by its reported name", () => {
		expect(modeStyle("someNewMode")).toEqual({ name: "someNewMode", color: VALUE });
	});

	it("shows dashes in the label colour when the mode is undefined", () => {
		expect(modeStyle(undefined)).toEqual({ name: "--", color: LABEL });
	});

	it("shows dashes in the label colour for an empty mode", () => {
		expect(modeStyle("")).toEqual({ name: "--", color: LABEL });
	});

	it("does not resolve inherited object keys as modes", () => {
		expect(modeStyle("constructor").name).toBe("constructor");
	});
});

describe("renderMode", () => {
	it("labels the key and shows the mode and the project", () => {
		const svg = renderMode("plan", "demo", false);
		expect(textElements(svg)).toEqual(["MODE", "Plan", "demo"]);
		expect(fillOf(svg, "Plan")).toBe(OK);
		expect(fillOf(svg, "demo")).toBe(LABEL);
	});

	it("splits a long multi-word name over two lines", () => {
		expect(textElements(renderMode("acceptEdits", "", false))).toEqual(["MODE", "Accept", "edits"]);
	});

	it("keeps a nine-character multi-word name on one line", () => {
		expect(textElements(renderMode("dontAsk", "", false))).toEqual(["MODE", "Don't ask"]);
	});

	it("places a single line lower than the first of two lines", () => {
		const first = (svg: string) => /<text x="72" y="(\d+)"/.exec(svg)?.[1];
		expect(first(renderMode("plan", "", false))).toBe("82");
		expect(first(renderMode("acceptEdits", "", false))).toBe("70");
	});

	it("uses a smaller font for a name with a line longer than 9 characters", () => {
		expect(renderMode("plan", "", false)).toContain('font-size="28"');
		expect(renderMode("averyLongModeName", "", false)).toContain('font-size="22"');
	});

	it("shows an unreported mode as dashes", () => {
		expect(textElements(renderMode(undefined, "", false))).toEqual(["MODE", "--"]);
	});

	it("replaces the project with the stale caption in amber", () => {
		const svg = renderMode("plan", "demo", true);
		expect(textElements(svg)).toEqual(["MODE", "Plan", "cycled - updates next message"]);
		expect(fillOf(svg, "cycled - updates next message")).toBe(WARN);
		expect(svg).toContain('font-size="11"');
	});

	it("shows the stale caption even without a project", () => {
		expect(textElements(renderMode("plan", "", true))).toContain("cycled - updates next message");
	});

	it("omits the caption when there is no project and the mode is current", () => {
		expect(textElements(renderMode("plan", "", false))).toEqual(["MODE", "Plan"]);
	});

	it("clips a long project to 30 characters", () => {
		const project = "p".repeat(40);
		expect(textElements(renderMode("plan", project, false)).at(-1)).toBe("p".repeat(29) + "…");
	});

	it("escapes special characters in the mode and the project", () => {
		const svg = renderMode("<m>&", `a"b<c>&d`, false);
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain("&lt;m&gt;&amp;");
		expect(svg).toContain("a&quot;b&lt;c&gt;&amp;d");
	});

	it("produces well-formed SVG for every state", () => {
		for (const mode of [undefined, "default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions", "x y z a b c d"]) {
			for (const stale of [false, true]) {
				const svg = renderMode(mode, "project", stale);
				expect(xmlProblem(svg)).toBe("");
				expect(svg).toContain('viewBox="0 0 144 144"');
			}
		}
	});
});
