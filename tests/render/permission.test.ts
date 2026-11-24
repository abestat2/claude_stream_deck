import { describe, expect, it } from "vitest";
import { type PermissionInfo, type PermissionResponseKind, renderPermission } from "../../src/render/permission";
import { textContent, xmlProblem } from "../helpers/xml";
import { fillOf, textElements } from "../helpers/svg";

const OK = "#7fb77e";
const ACCENT = "#d97757";
const CRITICAL = "#e5534b";
const WARN = "#ffb454";
const DIM = "#6f675f";
const LABEL = "#8a8178";

function info(overrides: Partial<PermissionInfo> = {}): PermissionInfo {
	return { tool: "Bash", detail: "npm test", project: "demo", others: 0, ...overrides };
}

describe("renderPermission headers", () => {
	it.each([
		["allow", "ALLOW", OK],
		["always", "ALWAYS", ACCENT],
		["deny", "DENY", CRITICAL],
	] as const)("shows %s as %s in its colour when a request is pending", (kind, header, color) => {
		const svg = renderPermission(kind, info(), false);
		expect(textElements(svg)[0]).toBe(header);
		expect(fillOf(svg, header)).toBe(color);
	});

	it.each([
		["allow", "ALLOW"],
		["always", "ALWAYS"],
		["deny", "DENY"],
	] as const)("shows the %s header dimmed with no request", (kind, header) => {
		const svg = renderPermission(kind, undefined, false);
		expect(textElements(svg)[0]).toBe(header);
		expect(fillOf(svg, header)).toBe(DIM);
	});

	it("shows only the header and a no request notice when nothing is pending", () => {
		const svg = renderPermission("allow", undefined, false);
		expect(textElements(svg)).toEqual(["ALLOW", "no request"]);
		expect(fillOf(svg, "no request")).toBe(LABEL);
	});

	it("ignores the sent flag when nothing is pending", () => {
		expect(renderPermission("deny", undefined, true)).toBe(renderPermission("deny", undefined, false));
	});

	it("renders a 144 x 144 SVG", () => {
		const svg = renderPermission("allow", info(), false);
		expect(svg).toContain('width="144" height="144" viewBox="0 0 144 144"');
	});
});

describe("renderPermission request", () => {
	it("shows the tool, the detail, and the project", () => {
		expect(textElements(renderPermission("allow", info(), false))).toEqual(["ALLOW", "Bash", "npm test", "demo"]);
	});

	it("shows request when the tool name is empty", () => {
		expect(textElements(renderPermission("allow", info({ tool: "" }), false))).toContain("request");
	});

	it("clips a long tool name to 13 characters", () => {
		const svg = renderPermission("allow", info({ tool: "mcp_tool_name_that_is_long" }), false);
		expect(textElements(svg)).toContain("mcp_tool_nam…");
	});

	it("keeps a tool name of exactly 13 characters", () => {
		expect(textElements(renderPermission("allow", info({ tool: "1234567890123" }), false))).toContain("1234567890123");
	});

	it("wraps the detail onto at most three lines of 17 characters", () => {
		const detail = "git commit --message initial --amend --no-verify --signoff --all extra";
		const lines = textElements(renderPermission("allow", info({ detail }), false)).slice(2, -1);
		expect(lines).toHaveLength(3);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(17);
		}
		expect(lines[2]?.endsWith("…")).toBe(true);
	});

	it("shows no detail lines for an empty detail", () => {
		expect(textElements(renderPermission("allow", info({ detail: "" }), false))).toEqual(["ALLOW", "Bash", "demo"]);
	});

	it("clips a long project to 18 characters", () => {
		const svg = renderPermission("allow", info({ project: "a-very-long-project-name" }), false);
		expect(textElements(svg).at(-1)).toBe("a-very-long-proje…");
	});

	it("shows no project line when the project is empty", () => {
		expect(textElements(renderPermission("allow", info({ project: "" }), false))).toEqual(["ALLOW", "Bash", "npm test"]);
	});

	it("shows no badge when no other session is waiting", () => {
		expect(textContent(renderPermission("allow", info({ others: 0 }), false))).not.toContain("+");
	});

	it("shows the count of other waiting sessions in amber", () => {
		const svg = renderPermission("allow", info({ others: 3 }), false);
		expect(textElements(svg)).toContain("+3");
		expect(fillOf(svg, "+3")).toBe(WARN);
	});

	it("shows sent in the header colour in place of the project", () => {
		const svg = renderPermission("always", info(), true);
		expect(textElements(svg).at(-1)).toBe("sent");
		expect(fillOf(svg, "sent")).toBe(ACCENT);
		expect(textElements(svg)).not.toContain("demo");
	});

	it("shows sent even when there is no project", () => {
		expect(textElements(renderPermission("deny", info({ project: "" }), true)).at(-1)).toBe("sent");
	});
});

describe("renderPermission escaping", () => {
	const special = `<b>&"'x`;

	it.each(["allow", "always", "deny"] as PermissionResponseKind[])("produces well-formed SVG with special characters for %s", (kind) => {
		const svg = renderPermission(kind, info({ tool: special, detail: `echo ${special} > file`, project: special, others: 1 }), false);
		expect(xmlProblem(svg)).toBe("");
	});

	it("escapes the tool, the detail, and the project", () => {
		const svg = renderPermission("allow", info({ tool: "a<b", detail: "x & y", project: 'p"q' }), false);
		expect(svg).toContain(">a&lt;b<");
		expect(svg).toContain(">x &amp; y<");
		expect(svg).toContain(">p&quot;q<");
	});

	it("produces well-formed SVG for an overlong unbroken detail", () => {
		expect(xmlProblem(renderPermission("allow", info({ detail: "<".repeat(200) }), false))).toBe("");
	});

	it("produces well-formed SVG without a request", () => {
		expect(xmlProblem(renderPermission("deny", undefined, false))).toBe("");
	});
});
