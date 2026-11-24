import { describe, expect, it } from "vitest";
import { formatClock, renderCharacter } from "../../src/render/character";
import type { Summary } from "../../src/state/sessions";
import { textContent, xmlProblem } from "../helpers/xml";

function summary(overall: Summary["overall"], agents = 0): Summary {
	return { sessions: 1, working: 0, attention: 0, done: 0, idle: 0, agents, overall };
}

const ORANGE_BANG = 'fill="#ffb454">!</text>';
const RED_BANG = 'fill="#e5534b">!</text>';

describe("formatClock", () => {
	it("formats seconds as m:ss", () => {
		expect(formatClock(0)).toBe("0:00");
		expect(formatClock(5_000)).toBe("0:05");
		expect(formatClock(59_000)).toBe("0:59");
	});

	it("rounds partial seconds down", () => {
		expect(formatClock(59_999)).toBe("0:59");
		expect(formatClock(999)).toBe("0:00");
	});

	it("rolls over to minutes", () => {
		expect(formatClock(60_000)).toBe("1:00");
		expect(formatClock(61_000)).toBe("1:01");
		expect(formatClock(59 * 60_000 + 59_000)).toBe("59:59");
	});

	it("switches to h:mm:ss at one hour", () => {
		expect(formatClock(3_600_000)).toBe("1:00:00");
		expect(formatClock(3_600_000 + 61_000)).toBe("1:01:01");
		expect(formatClock(10 * 3_600_000 + 5 * 60_000 + 9_000)).toBe("10:05:09");
	});

	it("treats negative input as zero", () => {
		expect(formatClock(-1)).toBe("0:00");
		expect(formatClock(-90_000)).toBe("0:00");
	});
});

describe("renderCharacter", () => {
	it("produces well-formed SVG for every state and frame", () => {
		for (const state of ["idle", "working", "attention", "done"] as const) {
			for (let frame = 0; frame < 9; frame++) {
				expect(xmlProblem(renderCharacter(summary(state, 2), frame, { turnMs: 5_000, waitMs: 120_000, escalated: true }))).toBe("");
			}
		}
	});

	it("shows the turn clock only while working", () => {
		expect(textContent(renderCharacter(summary("working"), 0, { turnMs: 75_000 }))).toContain("1:15");
		for (const state of ["idle", "done", "attention"] as const) {
			expect(textContent(renderCharacter(summary(state), 0, { turnMs: 75_000 }))).not.toContain("1:15");
		}
	});

	it("shows no clock while working without turnMs", () => {
		expect(textContent(renderCharacter(summary("working"), 0))).toBe("working");
	});

	it("shows a turn clock of zero", () => {
		expect(textContent(renderCharacter(summary("working"), 0, { turnMs: 0 }))).toContain("0:00");
	});

	it("shows whole minutes of waiting only from 60 seconds", () => {
		expect(textContent(renderCharacter(summary("attention"), 0, { waitMs: 59_999 }))).toBe("!NEEDS YOU");
		expect(textContent(renderCharacter(summary("attention"), 0, { waitMs: 60_000 }))).toBe("!1mNEEDS YOU");
		expect(textContent(renderCharacter(summary("attention"), 0, { waitMs: 179_999 }))).toContain("2m");
		expect(textContent(renderCharacter(summary("attention"), 0, { waitMs: 7 * 60_000 }))).toContain("7m");
	});

	it("shows the wait only while attention", () => {
		for (const state of ["idle", "working", "done"] as const) {
			expect(textContent(renderCharacter(summary(state), 0, { waitMs: 600_000 }))).not.toContain("10m");
		}
	});

	it("does not show the turn clock while attention", () => {
		expect(textContent(renderCharacter(summary("attention"), 0, { turnMs: 90_000 }))).not.toContain("1:30");
	});

	it("uses the orange exclamation mark, label, and pulse by default", () => {
		const svg = renderCharacter(summary("attention"), 1);
		expect(svg).toContain(ORANGE_BANG);
		expect(svg).not.toContain(RED_BANG);
		expect(svg).toContain('fill="#ffb454">NEEDS YOU</text>');
		expect(svg).toContain('<rect width="144" height="144" fill="#3a2a12"/>');
	});

	it("uses red for the exclamation mark, label, and pulse when escalated", () => {
		const svg = renderCharacter(summary("attention"), 1, { escalated: true });
		expect(svg).toContain(RED_BANG);
		expect(svg).not.toContain(ORANGE_BANG);
		expect(svg).toContain('fill="#e5534b">NEEDS YOU</text>');
		expect(svg).toContain('<rect width="144" height="144" fill="#4a1a14"/>');
	});

	it("uses the dark background on even frames while escalated", () => {
		const svg = renderCharacter(summary("attention"), 0, { escalated: true });
		expect(svg).toContain('<rect width="144" height="144" fill="#1f1d1a"/>');
		expect(svg).not.toContain("#4a1a14");
	});

	it("is not affected by escalated for idle, working, or done", () => {
		for (const state of ["idle", "working", "done"] as const) {
			for (const frame of [0, 1]) {
				expect(renderCharacter(summary(state), frame, { escalated: true })).toBe(renderCharacter(summary(state), frame));
			}
		}
	});

	it("is not affected by waitMs for idle, working, or done", () => {
		for (const state of ["idle", "working", "done"] as const) {
			expect(renderCharacter(summary(state), 0, { waitMs: 600_000 })).toBe(renderCharacter(summary(state), 0));
		}
	});

	it("is not affected by turnMs for idle or done", () => {
		for (const state of ["idle", "done"] as const) {
			expect(renderCharacter(summary(state), 0, { turnMs: 600_000 })).toBe(renderCharacter(summary(state), 0));
		}
	});

	it("draws the subagent count alongside the clock", () => {
		const text = textContent(renderCharacter(summary("working", 3), 0, { turnMs: 5_000 }));
		expect(text).toContain("3 agents");
		expect(text).toContain("0:05");
	});

	it("uses the singular for one subagent", () => {
		expect(textContent(renderCharacter(summary("working", 1), 0))).toContain("1 agent");
		expect(textContent(renderCharacter(summary("working", 1), 0))).not.toContain("agents");
	});

	it("draws the label for each state", () => {
		expect(textContent(renderCharacter(summary("idle"), 0))).toBe("idle");
		expect(textContent(renderCharacter(summary("done"), 0))).toBe("done");
		expect(textContent(renderCharacter(summary("working"), 0))).toBe("working");
	});
});
