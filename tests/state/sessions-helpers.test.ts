import { describe, expect, it } from "vitest";
import { describeTool, displayTool, projectName } from "../../src/state/sessions";

describe("projectName", () => {
	it("returns the last segment of a Windows path", () => {
		expect(projectName("C:\\Users\\me\\my_project")).toBe("my_project");
	});

	it("returns the last segment of a POSIX path", () => {
		expect(projectName("/home/me/app")).toBe("app");
	});

	it("handles mixed separators and trailing separators", () => {
		expect(projectName("C:\\work/repo\\")).toBe("repo");
		expect(projectName("/a/b//c///")).toBe("c");
	});

	it("returns an empty string for roots, empty strings, and non-strings", () => {
		expect(projectName("/")).toBe("");
		expect(projectName("")).toBe("");
		for (const value of [undefined, null, 5, {}, ["a"]]) {
			expect(projectName(value)).toBe("");
		}
	});
});

describe("displayTool", () => {
	it("returns plain tool names unchanged", () => {
		expect(displayTool("Bash")).toBe("Bash");
	});

	it("rewrites mcp tools as tool (server)", () => {
		expect(displayTool("mcp__github__create_issue")).toBe("create_issue (github)");
	});

	it("keeps double underscores inside the tool part", () => {
		expect(displayTool("mcp__srv__a__b")).toBe("a__b (srv)");
	});

	it("leaves incomplete mcp names unchanged", () => {
		expect(displayTool("mcp__server")).toBe("mcp__server");
		expect(displayTool("mcp")).toBe("mcp");
	});

	it("returns undefined for empty or non-string input", () => {
		for (const value of ["", undefined, null, 3, {}]) {
			expect(displayTool(value)).toBeUndefined();
		}
	});
});

describe("describeTool", () => {
	it("picks each known field", () => {
		for (const key of ["command", "file_path", "path", "url", "pattern", "query", "description", "prompt"]) {
			expect(describeTool({ [key]: "value" })).toBe("value");
		}
	});

	it("prefers fields in priority order", () => {
		expect(describeTool({ prompt: "p", url: "u", file_path: "f", command: "c" })).toBe("c");
		expect(describeTool({ prompt: "p", url: "u", file_path: "f" })).toBe("f");
		expect(describeTool({ prompt: "p", query: "q" })).toBe("q");
	});

	it("skips empty and non-string fields", () => {
		expect(describeTool({ command: "", file_path: 5, path: "/x" })).toBe("/x");
	});

	it("collapses whitespace and trims", () => {
		expect(describeTool({ command: "  echo   a\n\tb  " })).toBe("echo a b");
	});

	it("keeps text of exactly 160 characters", () => {
		const text = "a".repeat(160);
		expect(describeTool({ command: text })).toBe(text);
	});

	it("clips longer text to 160 characters ending with an ellipsis", () => {
		const out = describeTool({ command: "a".repeat(500) });
		expect(out).toHaveLength(160);
		expect(out.endsWith("…")).toBe(true);
		expect(out.slice(0, 159)).toBe("a".repeat(159));
	});

	it("falls back to JSON when no known field is present", () => {
		expect(describeTool({ foo: 1 })).toBe('{"foo":1}');
	});

	it("clips long JSON", () => {
		const out = describeTool({ foo: "x".repeat(400) });
		expect(out).toHaveLength(160);
		expect(out.endsWith("…")).toBe(true);
	});

	it("returns an empty string for an empty object and non-objects", () => {
		expect(describeTool({})).toBe("");
		for (const value of [undefined, null, "text", 5, true]) {
			expect(describeTool(value)).toBe("");
		}
	});

	it("does not throw on circular objects", () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(describeTool(loop)).toBe("");
	});

	it("does not throw on values JSON cannot serialize", () => {
		expect(describeTool({ n: 10n })).toBe("");
	});
});
