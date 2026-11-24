import { describe, expect, it } from "vitest";
import { formatReset, renderUsageDial, renderUsageKey, usageColor, type WindowPair } from "../../src/render/usage";
import type { UsageError, UsageState } from "../../src/usage/client";
import { textContent, xmlProblem } from "../helpers/xml";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000);

describe("formatReset", () => {
	it("returns an empty string without a reset time", () => {
		expect(formatReset(undefined, NOW)).toBe("");
	});

	it("shows a reset time in the past as 0m", () => {
		expect(formatReset(at(-30), NOW)).toBe("0m");
	});

	it("shows the current instant as 0m", () => {
		expect(formatReset(at(0), NOW)).toBe("0m");
	});

	it("shows minutes under an hour", () => {
		expect(formatReset(at(1), NOW)).toBe("1m");
		expect(formatReset(at(45), NOW)).toBe("45m");
		expect(formatReset(at(59), NOW)).toBe("59m");
	});

	it("rounds to the nearest minute", () => {
		expect(formatReset(new Date(NOW + 29_000), NOW)).toBe("0m");
		expect(formatReset(new Date(NOW + 30_000), NOW)).toBe("1m");
		expect(formatReset(new Date(NOW + 89_000), NOW)).toBe("1m");
	});

	it("switches to hours at exactly one hour", () => {
		expect(formatReset(at(60), NOW)).toBe("1h 0m");
	});

	it("shows hours and minutes under a day", () => {
		expect(formatReset(at(134), NOW)).toBe("2h 14m");
		expect(formatReset(at(24 * 60 - 1), NOW)).toBe("23h 59m");
	});

	it("switches to days at exactly 24 hours", () => {
		expect(formatReset(at(24 * 60), NOW)).toBe("1d 0h");
	});

	it("shows days and hours, dropping minutes", () => {
		expect(formatReset(at(3 * 24 * 60 + 4 * 60 + 30), NOW)).toBe("3d 4h");
		expect(formatReset(at(7 * 24 * 60), NOW)).toBe("7d 0h");
	});

	it("rolls a rounded-up minute into the next hour", () => {
		expect(formatReset(new Date(NOW + 59 * 60_000 + 40_000), NOW)).toBe("1h 0m");
	});

	it("uses the current time when none is given", () => {
		expect(formatReset(new Date(Date.now() + 10 * 60_000))).toBe("10m");
	});

	it("returns an empty string for an invalid date", () => {
		expect(formatReset(new Date("garbage"), NOW)).toBe("");
	});
});

describe("usageColor", () => {
	const ACCENT = "#d97757";
	const WARN = "#ffb454";
	const CRITICAL = "#e5534b";

	it("uses the accent colour below 70", () => {
		expect(usageColor(0)).toBe(ACCENT);
		expect(usageColor(69)).toBe(ACCENT);
		expect(usageColor(69.99)).toBe(ACCENT);
	});

	it("uses the warning colour from 70 up to 90", () => {
		expect(usageColor(70)).toBe(WARN);
		expect(usageColor(89.99)).toBe(WARN);
	});

	it("uses the critical colour from 90", () => {
		expect(usageColor(90)).toBe(CRITICAL);
		expect(usageColor(100)).toBe(CRITICAL);
		expect(usageColor(250)).toBe(CRITICAL);
	});

	it("uses the accent colour for negative values", () => {
		expect(usageColor(-5)).toBe(ACCENT);
	});
});

const state = (windows: UsageState["windows"], error?: UsageError): UsageState => ({ windows, fetchedAt: NOW, error });
const PAIR: WindowPair = ["session", "week"];
const full = state({
	session: { percent: 42.4, resetsAt: new Date(Date.now() + 134 * 60_000 + 20_000) },
	week: { percent: 91, resetsAt: new Date(Date.now() + (3 * 24 + 4) * 3_600_000 + 30_000) },
	sonnet: { percent: 75, resetsAt: undefined },
});

const renderers = [
	["renderUsageKey", renderUsageKey, 144, 144],
	["renderUsageDial", renderUsageDial, 200, 100],
] as const;

describe.each(renderers)("%s", (_name, render, width, height) => {
	it("produces a well-formed SVG of the expected size", () => {
		const svg = render(PAIR, full);
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain(`width="${width}"`);
		expect(svg).toContain(`height="${height}"`);
		expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
	});

	it("shows titles and rounded percentages for both windows", () => {
		const text = textContent(render(PAIR, full));
		expect(text).toContain("5-HOUR");
		expect(text).toContain("WEEK");
		expect(text).toContain("42%");
		expect(text).toContain("91%");
	});

	it("shows the time until each reset", () => {
		const text = textContent(render(PAIR, full));
		expect(text).toContain("2h 14m");
		expect(text).toContain("3d 4h");
	});

	it("uses the sonnet title for the sonnet window", () => {
		expect(textContent(render(["sonnet", "session"], full))).toContain("SONNET WK");
	});

	it("omits the reset note for a window without a reset time", () => {
		const svg = render(["sonnet", "sonnet"], full);
		expect(textContent(svg)).toContain("75%");
		expect(xmlProblem(svg)).toBe("");
	});

	it("colours each bar by its own percentage", () => {
		const svg = render(PAIR, full);
		expect(svg).toContain(usageColor(42.4));
		expect(svg).toContain(usageColor(91));
	});

	it("shows -- and an empty bar for a window with no reading when the other has one", () => {
		const svg = render(["session", "sonnet"], state({ session: { percent: 10, resetsAt: undefined } }));
		expect(textContent(svg)).toContain("10%");
		expect(textContent(svg)).toContain("--");
		expect(xmlProblem(svg)).toBe("");
	});

	it("draws no fill for zero percent", () => {
		const svg = render(["session", "week"], state({ session: { percent: 0, resetsAt: undefined }, week: { percent: 50, resetsAt: undefined } }));
		expect(svg.match(/<rect/g)?.length).toBe(1 + 2 + 1);
	});

	it("caps an over-100 percentage fill at the track width", () => {
		const svg = render(["session", "week"], state({ session: { percent: 180, resetsAt: undefined }, week: { percent: 100, resetsAt: undefined } }));
		const widths = [...svg.matchAll(/<rect x="\d+" y="\d+" width="([\d.]+)"/g)].map((m) => Number(m[1]));
		const track = Math.max(...widths);
		expect(widths.filter((w) => w === track).length).toBe(4);
		expect(textContent(svg)).toContain("180%");
	});

	it("shows a loading message when there is no reading and no error", () => {
		const svg = render(PAIR, state({}));
		expect(textContent(svg)).toBe("loading");
		expect(xmlProblem(svg)).toBe("");
	});

	it.each([
		["no-login", ["not signed in"]],
		["expired", ["login expired", "use Claude"]],
		["rate-limited", ["rate limited"]],
		["offline", ["offline"]],
		["failed", ["no data"]],
	] as const)("shows the %s message when there is no reading", (error, lines) => {
		const svg = render(PAIR, state({}, error));
		expect(textContent(svg)).toBe(lines.join(""));
		expect(xmlProblem(svg)).toBe("");
	});

	it("shows the loading message when the selected windows have no reading even if another window does", () => {
		const svg = render(["session", "week"], state({ sonnet: { percent: 5, resetsAt: undefined } }));
		expect(textContent(svg)).toBe("loading");
	});

	it("keeps the last values and replaces reset notes with a warning after a failure", () => {
		const text = textContent(render(PAIR, { ...full, error: "offline" }));
		expect(text).toContain("42%");
		expect(text).toContain("91%");
		expect(text).toContain("offline");
		expect(text).not.toContain("2h 14m");
		expect(text).not.toContain("3d 4h");
	});

	it("uses only the first line of a multi-line error as the warning beside the values", () => {
		const text = textContent(render(PAIR, { ...full, error: "expired" }));
		expect(text).toContain("login expired");
		expect(text).not.toContain("use Claude");
	});
});
