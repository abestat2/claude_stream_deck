import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, formatReset, renderUsageDial, renderUsageKey, type PaceByWindow, type WindowPair } from "../../src/render/usage";
import type { UsageState } from "../../src/usage/client";
import type { Pace } from "../../src/usage/pace";
import { fillOf, textElements } from "../helpers/svg";
import { textContent, xmlProblem } from "../helpers/xml";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW + minutes * MINUTE);

const CRITICAL = "#e5534b";
const VALUE = "#f1ece4";

const state = (error: UsageState["error"] = undefined): UsageState => ({
	windows: {
		session: { percent: 37.4, resetsAt: at(134) },
		week: { percent: 81, resetsAt: at(3 * 24 * 60 + 4 * 60) },
		sonnet: { percent: 5, resetsAt: at(2 * 24 * 60) },
	},
	fetchedAt: NOW,
	error,
});

const pace = (limitInMs: number | undefined, projectedAtReset: number | undefined = undefined): Pace => ({ ratePerHour: 10, limitInMs, projectedAtReset });

const sessionWeek: WindowPair = ["session", "week"];

/** Positions of the pace markers (2 px wide rects filled with the value colour), in document order. */
function markers(svg: string): { x: number; y: number; height: number }[] {
	return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.-]+)" width="2" height="(\d+)" rx="1" fill="#f1ece4"\/>/g)].map((m) => ({
		x: Number(m[1]),
		y: Number(m[2]),
		height: Number(m[3]),
	}));
}

/** x attribute of every text element whose content equals `content`. */
function textX(svg: string, content: string): number[] {
	return [...svg.matchAll(/<text x="([\d.]+)" [^>]*>([^<]*)<\/text>/g)].filter((m) => m[2] === content).map((m) => Number(m[1]));
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("formatDuration", () => {
	it.each([
		[0, "0m"],
		[-1, "0m"],
		[-3_600_000, "0m"],
		[29_999, "0m"],
		[30_000, "1m"],
		[59_000, "1m"],
		[60_000, "1m"],
		[59 * MINUTE, "59m"],
		[59 * MINUTE + 29_999, "59m"],
		[59 * MINUTE + 30_000, "1h 0m"],
		[60 * MINUTE, "1h 0m"],
		[61 * MINUTE, "1h 1m"],
		[134 * MINUTE, "2h 14m"],
		[23 * 60 * MINUTE + 59 * MINUTE, "23h 59m"],
		[24 * 60 * MINUTE - 20_000, "1d 0h"],
		[24 * 60 * MINUTE, "1d 0h"],
		[24 * 60 * MINUTE + 59 * MINUTE, "1d 0h"],
		[25 * 60 * MINUTE, "1d 1h"],
		[(3 * 24 * 60 + 4 * 60 + 30) * MINUTE, "3d 4h"],
		[30 * 24 * 60 * MINUTE, "30d 0h"],
	])("formats %i ms as %s", (ms, expected) => {
		expect(formatDuration(ms)).toBe(expected);
	});
});

describe("formatReset", () => {
	it("returns the same strings as before for the same inputs", () => {
		expect(formatReset(undefined, NOW)).toBe("");
		expect(formatReset(new Date(Number.NaN), NOW)).toBe("");
		expect(formatReset(at(-30), NOW)).toBe("0m");
		expect(formatReset(at(45), NOW)).toBe("45m");
		expect(formatReset(at(60), NOW)).toBe("1h 0m");
		expect(formatReset(at(134), NOW)).toBe("2h 14m");
		expect(formatReset(at(24 * 60), NOW)).toBe("1d 0h");
		expect(formatReset(at(3 * 24 * 60 + 4 * 60 + 30), NOW)).toBe("3d 4h");
		expect(formatReset(new Date(NOW + 59 * MINUTE + 40_000), NOW)).toBe("1h 0m");
	});

	it("matches formatDuration of the time remaining", () => {
		for (const minutes of [0, 1, 59, 60, 61, 1439, 1440, 5000]) {
			expect(formatReset(at(minutes), NOW)).toBe(formatDuration(minutes * MINUTE));
		}
	});
});

describe("renderUsageKey with pace", () => {
	it("shows the limit text with a right-aligned label and duration in the critical colour", () => {
		const svg = renderUsageKey(sessionWeek, state(), { session: pace(90 * MINUTE) });
		expect(textElements(svg)).toContain("limit in");
		expect(textElements(svg)).toContain("1h 30m");
		expect(fillOf(svg, "1h 30m")).toBe(CRITICAL);
		expect(svg).toContain('<text x="130" y="36" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="400" fill="#8a8178">limit in</text>');
		expect(svg).toContain('<text x="130" y="49" text-anchor="end" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#e5534b">1h 30m</text>');
	});

	it("keeps the reset note beside the title", () => {
		const svg = renderUsageKey(sessionWeek, state(), { session: pace(90 * MINUTE) });
		expect(textElements(svg)).toContain("2h 14m");
		expect(svg).toContain('<text x="130" y="20" text-anchor="end" font-family="Arial, sans-serif" font-size="12" font-weight="400" fill="#6f675f">2h 14m</text>');
	});

	it("places the limit text of the bottom row 72 px lower", () => {
		const svg = renderUsageKey(sessionWeek, state(), { week: pace(45 * MINUTE) });
		expect(svg).toContain('<text x="130" y="108" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="400" fill="#8a8178">limit in</text>');
		expect(svg).toContain('<text x="130" y="121" text-anchor="end" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#e5534b">45m</text>');
	});

	it("shows no limit text without limitInMs", () => {
		const svg = renderUsageKey(sessionWeek, state(), { session: pace(undefined, 60) });
		expect(textElements(svg)).not.toContain("limit in");
		expect(svg).not.toContain(CRITICAL);
	});

	it("shows the same text elements as without pace plus the two limit elements", () => {
		const base = textElements(renderUsageKey(sessionWeek, state()));
		const withPace = textElements(renderUsageKey(sessionWeek, state(), { session: pace(90 * MINUTE) }));
		expect(withPace).toHaveLength(base.length + 2);
		expect(withPace.filter((t) => !base.includes(t)).sort()).toEqual(["1h 30m", "limit in"]);
	});

	describe("marker", () => {
		it.each([
			[0, 13],
			[25, 42],
			[50, 71],
			[75, 100],
			[100, 129],
		])("draws the marker for %d%% at x %d", (projected, x) => {
			const found = markers(renderUsageKey(sessionWeek, state(), { session: pace(undefined, projected) }));
			expect(found).toHaveLength(1);
			expect(found[0]?.x).toBeCloseTo(x, 8);
		});

		it("scales fractional projections along the 116 px bar", () => {
			const found = markers(renderUsageKey(sessionWeek, state(), { session: pace(undefined, 33.3) }));
			expect(found[0]?.x).toBeCloseTo(14 + 0.333 * 116 - 1, 8);
		});

		it("clamps projections above 100 to the end of the bar", () => {
			const found = markers(renderUsageKey(sessionWeek, state(), { session: pace(undefined, 250) }));
			expect(found[0]?.x).toBe(129);
		});

		it("clamps projections below 0 to the start of the bar", () => {
			const found = markers(renderUsageKey(sessionWeek, state(), { session: pace(undefined, -40) }));
			expect(found[0]?.x).toBe(13);
		});

		it("spans the bar height with 2 px of overhang on each side", () => {
			const svg = renderUsageKey(sessionWeek, state(), { session: pace(undefined, 50), week: pace(undefined, 50) });
			expect(markers(svg)).toEqual([
				{ x: 71, y: 53, height: 12 },
				{ x: 71, y: 125, height: 12 },
			]);
		});

		it("draws no marker when projectedAtReset is undefined", () => {
			expect(markers(renderUsageKey(sessionWeek, state(), { session: pace(90 * MINUTE) }))).toEqual([]);
		});

		it("draws a marker next to the limit text only when both are present", () => {
			const svg = renderUsageKey(sessionWeek, state(), { session: { ratePerHour: 1, limitInMs: 1000, projectedAtReset: 50 } });
			expect(markers(svg)).toHaveLength(1);
			expect(textElements(svg)).toContain("limit in");
		});

		it("is drawn after the bar fill so it stays visible", () => {
			const svg = renderUsageKey(sessionWeek, state(), { session: pace(undefined, 20) });
			expect(svg.indexOf('fill="#f1ece4"/>')).toBeGreaterThan(svg.indexOf('fill="#d97757"'));
		});
	});

	describe("row independence", () => {
		it("applies pace of the top window only to the top row", () => {
			const svg = renderUsageKey(sessionWeek, state(), { session: pace(60 * MINUTE, undefined) });
			expect(textElements(svg).filter((t) => t === "limit in")).toHaveLength(1);
			expect(svg).toContain('y="36"');
			expect(svg).not.toContain('y="108"');
		});

		it("applies pace of the bottom window only to the bottom row", () => {
			const svg = renderUsageKey(sessionWeek, state(), { week: pace(undefined, 90) });
			const found = markers(svg);
			expect(found).toHaveLength(1);
			expect(found[0]?.y).toBe(125);
		});

		it("applies pace to the window shown, not to the position", () => {
			const svg = renderUsageKey(["week", "session"], state(), { session: pace(30 * MINUTE) });
			expect(svg).toContain('y="121"');
			expect(svg).not.toContain('y="49"');
		});

		it("ignores pace of a window that is not shown", () => {
			const svg = renderUsageKey(sessionWeek, state(), { sonnet: pace(30 * MINUTE, 50) });
			expect(svg).toBe(renderUsageKey(sessionWeek, state()));
		});
	});

	describe("error state", () => {
		it.each(["no-login", "expired", "rate-limited", "offline", "failed"] as const)("ignores pace while the error is %s", (error) => {
			const full: PaceByWindow = { session: pace(30 * MINUTE, 40), week: pace(undefined, 70) };
			expect(renderUsageKey(sessionWeek, state(error), full)).toBe(renderUsageKey(sessionWeek, state(error)));
		});

		it("shows pace again once the error is cleared", () => {
			const full: PaceByWindow = { session: pace(30 * MINUTE) };
			expect(renderUsageKey(sessionWeek, state(), full)).not.toBe(renderUsageKey(sessionWeek, state()));
		});
	});

	describe("output", () => {
		it("is identical for an empty pace map and an omitted argument", () => {
			expect(renderUsageKey(sessionWeek, state(), {})).toBe(renderUsageKey(sessionWeek, state()));
		});

		it("is identical for pace entries without a limit or projection", () => {
			expect(renderUsageKey(sessionWeek, state(), { session: pace(undefined, undefined) })).toBe(renderUsageKey(sessionWeek, state()));
		});

		it("is well-formed XML with every pace element present", () => {
			const svg = renderUsageKey(sessionWeek, state(), { session: pace(90 * MINUTE, 60), week: pace(undefined, 120) });
			expect(xmlProblem(svg)).toBe("");
			expect(textContent(svg)).toContain("limit in");
		});

		it("never contains tspan", () => {
			for (const p of [{}, { session: pace(90 * MINUTE, 60) }, { week: pace(undefined, 20) }]) {
				expect(renderUsageKey(sessionWeek, state(), p)).not.toContain("tspan");
				expect(renderUsageKey(sessionWeek, state("offline"), p)).not.toContain("tspan");
			}
			expect(renderUsageKey(sessionWeek, { windows: {}, fetchedAt: undefined, error: undefined }, { session: pace(1) })).not.toContain("tspan");
		});

		it("ignores pace when neither window has a reading", () => {
			const empty: UsageState = { windows: {}, fetchedAt: undefined, error: undefined };
			expect(renderUsageKey(sessionWeek, empty, { session: pace(30 * MINUTE, 50) })).toBe(renderUsageKey(sessionWeek, empty));
		});
	});
});

describe("renderUsageDial with pace", () => {
	it("replaces the reset note with the limit note in the critical colour", () => {
		const svg = renderUsageDial(sessionWeek, state(), { session: pace(90 * MINUTE) });
		expect(textElements(svg)).toContain("limit 1h 30m");
		expect(textElements(svg)).not.toContain("2h 14m");
		expect(fillOf(svg, "limit 1h 30m")).toBe(CRITICAL);
		expect(svg).toContain('<text x="64" y="22" text-anchor="start" font-family="Arial, sans-serif" font-size="12" font-weight="400" fill="#e5534b">limit 1h 30m</text>');
	});

	it("keeps the reset note of a row without a limit", () => {
		const svg = renderUsageDial(sessionWeek, state(), { session: pace(90 * MINUTE) });
		expect(textElements(svg)).toContain("3d 4h");
	});

	it("keeps the reset note when only a projection is known", () => {
		const svg = renderUsageDial(sessionWeek, state(), { session: pace(undefined, 70) });
		expect(textElements(svg)).toContain("2h 14m");
		expect(textElements(svg).some((t) => t.startsWith("limit"))).toBe(false);
	});

	it("uses the week offset of 55 and a 50 px row offset", () => {
		const svg = renderUsageDial(sessionWeek, state(), { week: pace(45 * MINUTE) });
		expect(svg).toContain('<text x="55" y="72" text-anchor="start" font-family="Arial, sans-serif" font-size="12" font-weight="400" fill="#e5534b">limit 45m</text>');
	});

	it("uses the sonnet variant with an exclamation mark at offset 92", () => {
		const svg = renderUsageDial(["sonnet", "week"], state(), { sonnet: pace(45 * MINUTE) });
		expect(svg).toContain('<text x="92" y="22" text-anchor="start" font-family="Arial, sans-serif" font-size="12" font-weight="400" fill="#e5534b">! 45m</text>');
		expect(textElements(svg).some((t) => t.startsWith("limit"))).toBe(false);
	});

	it("uses the sonnet variant on the bottom row", () => {
		const svg = renderUsageDial(["session", "sonnet"], state(), { sonnet: pace(3 * 60 * MINUTE) });
		expect(textX(svg, "! 3h 0m")).toEqual([92]);
		expect(svg).toContain('<text x="92" y="72"');
	});

	it("uses the limit wording for session and week", () => {
		const svg = renderUsageDial(sessionWeek, state(), { session: pace(10 * MINUTE), week: pace(20 * MINUTE) });
		expect(textX(svg, "limit 10m")).toEqual([64]);
		expect(textX(svg, "limit 20m")).toEqual([55]);
	});

	it("places the note at the offset of the window shown, not the position", () => {
		const svg = renderUsageDial(["week", "session"], state(), { week: pace(10 * MINUTE), session: pace(20 * MINUTE) });
		expect(textX(svg, "limit 10m")).toEqual([55]);
		expect(textX(svg, "limit 20m")).toEqual([64]);
	});

	it("keeps the title and percentage text", () => {
		const base = textElements(renderUsageDial(sessionWeek, state()));
		const withPace = textElements(renderUsageDial(sessionWeek, state(), { session: pace(90 * MINUTE) }));
		expect(withPace).toHaveLength(base.length);
		expect(withPace.filter((t) => !base.includes(t))).toEqual(["limit 1h 30m"]);
	});

	describe("marker", () => {
		it.each([
			[0, 9],
			[25, 54],
			[50, 99],
			[75, 144],
			[100, 189],
		])("draws the marker for %d%% at x %d", (projected, x) => {
			const found = markers(renderUsageDial(sessionWeek, state(), { session: pace(undefined, projected) }));
			expect(found).toHaveLength(1);
			expect(found[0]?.x).toBeCloseTo(x, 8);
		});

		it("scales fractional projections along the 180 px bar", () => {
			const found = markers(renderUsageDial(sessionWeek, state(), { session: pace(undefined, 33.3) }));
			expect(found[0]?.x).toBeCloseTo(10 + 0.333 * 180 - 1, 8);
		});

		it("clamps projections above 100", () => {
			expect(markers(renderUsageDial(sessionWeek, state(), { session: pace(undefined, 101) }))[0]?.x).toBe(189);
		});

		it("clamps projections below 0", () => {
			expect(markers(renderUsageDial(sessionWeek, state(), { session: pace(undefined, -1) }))[0]?.x).toBe(9);
		});

		it("spans the bar height with 2 px of overhang on each side", () => {
			const svg = renderUsageDial(sessionWeek, state(), { session: pace(undefined, 50), week: pace(undefined, 50) });
			expect(markers(svg)).toEqual([
				{ x: 99, y: 30, height: 13 },
				{ x: 99, y: 80, height: 13 },
			]);
		});

		it("draws no marker when projectedAtReset is undefined", () => {
			expect(markers(renderUsageDial(sessionWeek, state(), { session: pace(90 * MINUTE) }))).toEqual([]);
		});

		it("is drawn together with the limit note when both are present", () => {
			const svg = renderUsageDial(sessionWeek, state(), { session: { ratePerHour: 1, limitInMs: 5 * MINUTE, projectedAtReset: 50 } });
			expect(markers(svg)).toHaveLength(1);
			expect(textElements(svg)).toContain("limit 5m");
		});
	});

	describe("row independence", () => {
		it("applies pace of the top window only to the top row", () => {
			const svg = renderUsageDial(sessionWeek, state(), { session: pace(60 * MINUTE, 50) });
			expect(markers(svg)).toHaveLength(1);
			expect(markers(svg)[0]?.y).toBe(30);
			expect(textElements(svg)).toContain("3d 4h");
		});

		it("applies pace of the bottom window only to the bottom row", () => {
			const svg = renderUsageDial(sessionWeek, state(), { week: pace(60 * MINUTE, 50) });
			expect(markers(svg)).toHaveLength(1);
			expect(markers(svg)[0]?.y).toBe(80);
			expect(textElements(svg)).toContain("2h 14m");
			expect(textElements(svg)).not.toContain("3d 4h");
		});

		it("ignores pace of a window that is not shown", () => {
			expect(renderUsageDial(sessionWeek, state(), { sonnet: pace(30 * MINUTE, 50) })).toBe(renderUsageDial(sessionWeek, state()));
		});
	});

	describe("error state", () => {
		it.each(["no-login", "expired", "rate-limited", "offline", "failed"] as const)("ignores pace while the error is %s", (error) => {
			const full: PaceByWindow = { session: pace(30 * MINUTE, 40), week: pace(undefined, 70) };
			expect(renderUsageDial(sessionWeek, state(error), full)).toBe(renderUsageDial(sessionWeek, state(error)));
		});

		it("shows the error note instead of the limit note", () => {
			const svg = renderUsageDial(sessionWeek, state("offline"), { session: pace(30 * MINUTE) });
			expect(textElements(svg)).toContain("offline");
			expect(textElements(svg).some((t) => t.startsWith("limit"))).toBe(false);
		});
	});

	describe("output", () => {
		it("is identical for an empty pace map and an omitted argument", () => {
			expect(renderUsageDial(sessionWeek, state(), {})).toBe(renderUsageDial(sessionWeek, state()));
		});

		it("is well-formed XML with every pace element present", () => {
			const svg = renderUsageDial(["sonnet", "week"], state(), { sonnet: pace(90 * MINUTE, 60), week: pace(undefined, 120) });
			expect(xmlProblem(svg)).toBe("");
			expect(textContent(svg)).toContain("! 1h 30m");
		});

		it("never contains tspan", () => {
			for (const p of [{}, { session: pace(90 * MINUTE, 60) }, { sonnet: pace(90 * MINUTE) }, { week: pace(undefined, 20) }]) {
				for (const pair of [sessionWeek, ["sonnet", "week"] as WindowPair]) {
					expect(renderUsageDial(pair, state(), p)).not.toContain("tspan");
					expect(renderUsageDial(pair, state("expired"), p)).not.toContain("tspan");
				}
			}
			expect(renderUsageDial(sessionWeek, { windows: {}, fetchedAt: undefined, error: undefined }, { session: pace(1) })).not.toContain("tspan");
		});

		it("ignores pace when neither window has a reading", () => {
			const empty: UsageState = { windows: {}, fetchedAt: undefined, error: undefined };
			expect(renderUsageDial(sessionWeek, empty, { session: pace(30 * MINUTE, 50) })).toBe(renderUsageDial(sessionWeek, empty));
		});
	});
});

describe("marker colour", () => {
	it("uses the value colour on key and dial", () => {
		expect(renderUsageKey(sessionWeek, state(), { session: pace(undefined, 50) })).toContain(`fill="${VALUE}"/>`);
		expect(renderUsageDial(sessionWeek, state(), { session: pace(undefined, 50) })).toContain(`rx="1" fill="${VALUE}"/>`);
	});
});
