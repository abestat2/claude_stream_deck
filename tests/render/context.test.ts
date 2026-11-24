import { describe, expect, it } from "vitest";
import { type ContextInfo, formatTokens, renderContextDial, renderContextKey } from "../../src/render/context";
import { xmlProblem } from "../helpers/xml";
import { textElements } from "../helpers/svg";

const ACCENT = "#d97757";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";

function info(overrides: Partial<ContextInfo> = {}): ContextInfo {
	return { percent: 42, tokens: 84_000, size: 200_000, model: "Opus", ...overrides };
}

function rects(svg: string): { width: number; fill: string }[] {
	return [...svg.matchAll(/<rect [^>]*?width="([\d.]+)"[^>]*?fill="(#[0-9a-f]{6})"/g)].map((m) => ({ width: Number(m[1]), fill: m[2] as string }));
}

/** Fill colour of the filled bar, which is the last rect drawn. */
function barFill(svg: string): string {
	return rects(svg).at(-1)?.fill ?? "";
}

describe("formatTokens", () => {
	it.each([
		[0, "0"],
		[999, "999"],
		[1000, "1k"],
		[1499, "1k"],
		[1500, "2k"],
		[112_000, "112k"],
		[999_499, "999k"],
		[1_000_000, "1M"],
		[1_500_000, "1.5M"],
		[2_000_000, "2M"],
	])("formats %d as %s", (tokens, expected) => {
		expect(formatTokens(tokens)).toBe(expected);
	});

	it("rounds a count just under one million to thousands", () => {
		expect(formatTokens(999_999)).toBe("1000k");
	});
});

describe.each([
	["renderContextKey", renderContextKey, 144, 144],
	["renderContextDial", renderContextDial, 200, 100],
] as const)("%s", (_name, render, width, height) => {
	it("renders an SVG of the expected size", () => {
		const svg = render(info(), "no-messages");
		expect(svg).toContain(`width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`);
	});

	it("shows the rounded percentage, the tokens, and the model", () => {
		const text = textElements(render(info({ percent: 41.6 }), "no-messages"));
		expect(text).toContain("CONTEXT");
		expect(text).toContain("42%");
		expect(text).toContain("84k / 200k");
		expect(text).toContain("Opus");
	});

	it("shows only the token count when the size is unknown", () => {
		expect(textElements(render(info({ size: undefined }), "no-messages"))).toContain("84k");
	});

	it("omits the token line when tokens are unknown", () => {
		const text = textElements(render(info({ tokens: undefined }), "no-messages")).join("|");
		expect(text).not.toContain("200k");
		expect(text).not.toContain("84k");
	});

	it("omits the model when it is unknown", () => {
		const text = textElements(render(info({ model: undefined }), "no-messages"));
		expect(text).not.toContain("Opus");
		expect(text).toContain("42%");
	});

	it("clips a long model name", () => {
		const text = textElements(render(info({ model: "A very long model display name here" }), "no-messages")).join("|");
		expect(text).not.toContain("A very long model display name here");
		expect(text).toContain("…");
	});

	it("escapes the model name", () => {
		const svg = render(info({ model: `<m>&"x` }), "no-messages");
		expect(xmlProblem(svg)).toBe("");
		expect(svg).toContain("&lt;m&gt;&amp;&quot;x");
	});

	it("shows set up guidance when the status line is not set up", () => {
		expect(textElements(render(undefined, "not-set-up"))).toEqual(
			render === renderContextKey
				? ["CONTEXT", "no data", "restart Claude", "or run Setup"]
				: ["CONTEXT", "no data", "restart Claude or Setup"],
		);
	});

	it("shows a no messages notice when no reading has arrived yet", () => {
		expect(textElements(render(undefined, "no-messages"))).toEqual(["CONTEXT", "no messages", "yet"]);
	});

	it("uses the accent colour below 70 percent", () => {
		expect(barFill(render(info({ percent: 69.9 }), "no-messages"))).toBe(ACCENT);
	});

	it("uses amber from 70 percent", () => {
		expect(barFill(render(info({ percent: 70 }), "no-messages"))).toBe(WARN);
		expect(barFill(render(info({ percent: 89.9 }), "no-messages"))).toBe(WARN);
	});

	it("uses red from 90 percent", () => {
		expect(barFill(render(info({ percent: 90 }), "no-messages"))).toBe(CRITICAL);
		expect(barFill(render(info({ percent: 100 }), "no-messages"))).toBe(CRITICAL);
	});

	it("draws only the track at zero percent", () => {
		const svg = render(info({ percent: 0 }), "no-messages");
		expect(svg.match(/rx=/g)).toHaveLength(1);
	});

	it("caps the filled bar at the track width", () => {
		const over = rects(render(info({ percent: 250 }), "no-messages"));
		const full = rects(render(info({ percent: 100 }), "no-messages"));
		expect(over.at(-1)?.width).toBe(full.at(-1)?.width);
	});

	it("produces well-formed SVG for every reading and missing reason", () => {
		const variants: (ContextInfo | undefined)[] = [
			info(),
			info({ percent: 0 }),
			info({ percent: 100 }),
			info({ tokens: undefined, size: undefined, model: undefined }),
			undefined,
		];
		for (const variant of variants) {
			for (const reason of ["not-set-up", "no-messages"] as const) {
				expect(xmlProblem(render(variant, reason))).toBe("");
			}
		}
	});
});
