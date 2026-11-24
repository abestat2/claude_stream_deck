import { describe, expect, it } from "vitest";
import { formatAgo, renderConnection, type ConnectionInfo } from "../../src/render/connection";
import { textContent, xmlProblem } from "../helpers/xml";

const OK = "#7fb77e";
const WARN = "#ffb454";
const CRITICAL = "#e5534b";
const LABEL = "#8a8178";
const VALUE = "#f1ece4";

function info(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return { listening: true, serverError: undefined, sinceLastEventMs: 5_000, sessions: 2, usage: "ok", ...overrides };
}

function dot(svg: string): string {
	return /<circle [^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1] ?? "";
}

/** Fill colour of the text element whose content equals `value`. */
function colorOf(svg: string, value: string): string {
	return new RegExp(`fill="(#[0-9a-f]{6})">${value}</text>`).exec(svg)?.[1] ?? "";
}

describe("formatAgo", () => {
	it("formats seconds", () => {
		expect(formatAgo(0)).toBe("0s ago");
		expect(formatAgo(45_000)).toBe("45s ago");
		expect(formatAgo(59_000)).toBe("59s ago");
	});

	it("rounds to the nearest second", () => {
		expect(formatAgo(499)).toBe("0s ago");
		expect(formatAgo(500)).toBe("1s ago");
	});

	it("switches to minutes at 60 seconds", () => {
		expect(formatAgo(60_000)).toBe("1m ago");
		expect(formatAgo(119_000)).toBe("2m ago");
		expect(formatAgo(59_500)).toBe("1m ago");
	});

	it("switches to hours at 60 minutes", () => {
		expect(formatAgo(59 * 60_000)).toBe("59m ago");
		expect(formatAgo(60 * 60_000)).toBe("1h ago");
		expect(formatAgo(3 * 3_600_000)).toBe("3h ago");
		expect(formatAgo(23 * 3_600_000)).toBe("23h ago");
	});

	it("switches to days at 24 hours", () => {
		expect(formatAgo(24 * 3_600_000)).toBe("1d ago");
		expect(formatAgo(5 * 24 * 3_600_000)).toBe("5d ago");
	});

	it("treats negative input as zero", () => {
		expect(formatAgo(-5_000)).toBe("0s ago");
	});
});

describe("renderConnection", () => {
	it("produces well-formed SVG for every hooks state", () => {
		const variants: Partial<ConnectionInfo>[] = [
			{},
			{ serverError: "port in use" },
			{ listening: false },
			{ sinceLastEventMs: undefined },
			{ usage: undefined },
			{ usage: "unauthorized" },
		];
		for (const variant of variants) {
			expect(xmlProblem(renderConnection(info(variant)))).toBe("");
		}
	});

	it("shows a server error as port busy with a red dot", () => {
		const svg = renderConnection(info({ serverError: "port in use", listening: false }));
		expect(textContent(svg)).toContain("port busy");
		expect(colorOf(svg, "port busy")).toBe(CRITICAL);
		expect(dot(svg)).toBe(CRITICAL);
	});

	it("shows port busy even when the server is marked listening", () => {
		const svg = renderConnection(info({ serverError: "x" }));
		expect(textContent(svg)).toContain("port busy");
		expect(dot(svg)).toBe(CRITICAL);
	});

	it("shows a server that is not listening as starting with an amber dot", () => {
		const svg = renderConnection(info({ listening: false }));
		expect(textContent(svg)).toContain("starting");
		expect(colorOf(svg, "starting")).toBe(WARN);
		expect(dot(svg)).toBe(WARN);
	});

	it("shows a listening server without events as none yet with an amber dot", () => {
		const svg = renderConnection(info({ sinceLastEventMs: undefined }));
		expect(textContent(svg)).toContain("none yet");
		expect(colorOf(svg, "none yet")).toBe(WARN);
		expect(dot(svg)).toBe(WARN);
	});

	it("shows the time since the last event with a green dot", () => {
		const svg = renderConnection(info({ sinceLastEventMs: 125_000 }));
		expect(textContent(svg)).toContain("2m ago");
		expect(colorOf(svg, "2m ago")).toBe(VALUE);
		expect(dot(svg)).toBe(OK);
	});

	it("shows the session count", () => {
		const svg = renderConnection(info({ sessions: 7 }));
		expect(textContent(svg)).toContain("SESSIONS7");
		expect(colorOf(svg, "7")).toBe(VALUE);
	});

	it("shows ok usage in green", () => {
		const svg = renderConnection(info({ usage: "ok" }));
		expect(textContent(svg)).toContain("USAGEok");
		expect(colorOf(svg, "ok")).toBe(OK);
	});

	it("shows an error usage status in amber", () => {
		const svg = renderConnection(info({ usage: "unauthorized" }));
		expect(textContent(svg)).toContain("USAGEunauthorized");
		expect(colorOf(svg, "unauthorized")).toBe(WARN);
	});

	it("shows unread usage as off in the label colour", () => {
		const svg = renderConnection(info({ usage: undefined }));
		expect(textContent(svg)).toContain("USAGEoff");
		expect(colorOf(svg, "off")).toBe(LABEL);
	});

	it("labels the key", () => {
		const text = textContent(renderConnection(info()));
		expect(text).toContain("LINK");
		expect(text).toContain("HOOKS");
	});
});
