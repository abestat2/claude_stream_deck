import { describe, expect, it } from "vitest";
import { detailLine, renderSessions, type SessionView, stateLine } from "../../src/render/sessions";
import { fillOf, textElements } from "../helpers/svg";
import { xmlProblem } from "../helpers/xml";

const ACCENT = "#d97757";
const OK = "#7fb77e";
const WARN = "#ffb454";
const LABEL = "#8a8178";

function view(overrides: Partial<SessionView> = {}): SessionView {
	return {
		project: "deck",
		state: "idle",
		agents: 0,
		turnMs: undefined,
		waitMs: undefined,
		tool: undefined,
		request: undefined,
		model: undefined,
		...overrides,
	};
}

function fontSize(svg: string, content: string): number {
	return Number(new RegExp(`font-size="(\\d+)"[^>]*>${content}</text>`).exec(svg)?.[1]);
}

describe("stateLine", () => {
	it("shows the turn clock while working", () => {
		expect(stateLine(view({ state: "working", turnMs: 134_000 }))).toEqual({ text: "working 2:14", color: ACCENT });
	});

	it("omits the clock while working when the turn start is unknown", () => {
		expect(stateLine(view({ state: "working" })).text).toBe("working");
	});

	it("shows one agent in the singular", () => {
		expect(stateLine(view({ state: "working", turnMs: 5000, agents: 1 })).text).toBe("working 0:05 +1 agent");
	});

	it("shows several agents in the plural", () => {
		expect(stateLine(view({ state: "working", agents: 3 })).text).toBe("working +3 agents");
	});

	it("shows no wait time below 60 seconds", () => {
		expect(stateLine(view({ state: "attention", waitMs: 59_999 }))).toEqual({ text: "needs you", color: WARN });
	});

	it("shows whole minutes from 60 seconds", () => {
		expect(stateLine(view({ state: "attention", waitMs: 60_000 })).text).toBe("needs you 1m");
		expect(stateLine(view({ state: "attention", waitMs: 185_000 })).text).toBe("needs you 3m");
	});

	it("shows no wait time when it is unknown", () => {
		expect(stateLine(view({ state: "attention" })).text).toBe("needs you");
	});

	it("shows done in green, with agents when present", () => {
		expect(stateLine(view({ state: "done" }))).toEqual({ text: "done", color: OK });
		expect(stateLine(view({ state: "done", agents: 2 })).text).toBe("done +2 agents");
	});

	it("shows idle in the label colour, with agents when present", () => {
		expect(stateLine(view())).toEqual({ text: "idle", color: LABEL });
		expect(stateLine(view({ agents: 1 })).text).toBe("idle +1 agent");
	});
});

describe("detailLine", () => {
	it("shows the request while waiting, or nothing", () => {
		expect(detailLine(view({ state: "attention", request: "Bash: ls" }))).toBe("Bash: ls");
		expect(detailLine(view({ state: "attention" }))).toBe("");
	});

	it("shows the tool while working, or thinking", () => {
		expect(detailLine(view({ state: "working", tool: "Edit" }))).toBe("Edit");
		expect(detailLine(view({ state: "working" }))).toBe("thinking");
	});

	it("shows the model otherwise, or nothing", () => {
		expect(detailLine(view({ state: "done", model: "Opus" }))).toBe("Opus");
		expect(detailLine(view({ state: "idle", model: "Sonnet" }))).toBe("Sonnet");
		expect(detailLine(view({ state: "idle" }))).toBe("");
	});

	it("ignores the tool and request outside their states", () => {
		expect(detailLine(view({ state: "done", tool: "Edit", request: "Bash: ls" }))).toBe("");
	});
});

describe("renderSessions", () => {
	it("renders an SVG of 200 x 100", () => {
		expect(renderSessions(view(), 0, 1)).toContain('width="200" height="100" viewBox="0 0 200 100"');
	});

	it("shows guidance when no session is tracked", () => {
		const svg = renderSessions(undefined, 0, 0);
		expect(textElements(svg)).toEqual(["SESSIONS", "no sessions", "start Claude Code"]);
		expect(svg).not.toContain("‹");
	});

	it("shows the position counter, project, state, and detail", () => {
		const svg = renderSessions(view({ project: "deck", state: "working", turnMs: 65_000, tool: "Edit" }), 1, 3);
		expect(textElements(svg)).toEqual(["SESSIONS", "2 / 3", "deck", "working 1:05", "Edit", "‹", "›"]);
	});

	it("shows side arrows only when more than one session exists", () => {
		expect(textElements(renderSessions(view(), 0, 1))).not.toContain("‹");
		expect(textElements(renderSessions(view(), 0, 1))).not.toContain("›");
		expect(textElements(renderSessions(view(), 0, 2))).toEqual(expect.arrayContaining(["‹", "›"]));
	});

	it("colours the state line by state", () => {
		expect(fillOf(renderSessions(view({ state: "working" }), 0, 1), "working")).toBe(ACCENT);
		expect(fillOf(renderSessions(view({ state: "attention" }), 0, 1), "needs you")).toBe(WARN);
		expect(fillOf(renderSessions(view({ state: "done" }), 0, 1), "done")).toBe(OK);
		expect(fillOf(renderSessions(view(), 0, 1), "idle")).toBe(LABEL);
	});

	it("steps the project font size at 8 and 13 characters", () => {
		expect(fontSize(renderSessions(view({ project: "12345678" }), 0, 1), "12345678")).toBe(22);
		expect(fontSize(renderSessions(view({ project: "123456789" }), 0, 1), "123456789")).toBe(18);
		expect(fontSize(renderSessions(view({ project: "1234567890123" }), 0, 1), "1234567890123")).toBe(18);
		expect(fontSize(renderSessions(view({ project: "12345678901234" }), 0, 1), "12345678901234")).toBe(15);
	});

	it("keeps a project of 16 characters whole", () => {
		expect(textElements(renderSessions(view({ project: "1234567890123456" }), 0, 1))).toContain("1234567890123456");
	});

	it("clips a project longer than 16 characters with an ellipsis", () => {
		const texts = textElements(renderSessions(view({ project: "12345678901234567" }), 0, 1));
		expect(texts).toContain("123456789012345…");
		expect(texts).not.toContain("12345678901234567");
	});

	it("shows unnamed for an empty project", () => {
		expect(textElements(renderSessions(view({ project: "" }), 0, 1))).toContain("unnamed");
	});

	it("clips the detail line to 30 characters", () => {
		const exact = "a".repeat(30);
		expect(textElements(renderSessions(view({ model: exact }), 0, 1))).toContain(exact);
		const texts = textElements(renderSessions(view({ model: "a".repeat(31) }), 0, 1));
		expect(texts).toContain(`${"a".repeat(29)}…`);
	});

	it("omits the detail line when it is empty", () => {
		expect(textElements(renderSessions(view(), 0, 1))).toEqual(["SESSIONS", "1 / 1", "deck", "idle"]);
	});

	it("escapes the project, request, and model", () => {
		const project = renderSessions(view({ project: `<p>&"` }), 0, 1);
		expect(xmlProblem(project)).toBe("");
		expect(project).toContain("&lt;p&gt;&amp;&quot;");
		const request = renderSessions(view({ state: "attention", request: `Bash: echo "<x>" && ls` }), 0, 1);
		expect(xmlProblem(request)).toBe("");
		expect(request).toContain("echo &quot;&lt;x&gt;&quot; &amp;&amp; ls");
		const model = renderSessions(view({ model: "<m>&" }), 0, 1);
		expect(xmlProblem(model)).toBe("");
		expect(model).toContain("&lt;m&gt;&amp;");
	});

	it("produces well-formed SVG for every state and for no session", () => {
		const states = ["idle", "working", "attention", "done"] as const;
		for (const state of states) {
			expect(xmlProblem(renderSessions(view({ state, agents: 2, turnMs: 1000, waitMs: 90_000 }), 0, 2))).toBe("");
		}
		expect(xmlProblem(renderSessions(undefined, 0, 0))).toBe("");
	});
});
