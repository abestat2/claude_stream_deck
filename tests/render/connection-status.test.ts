import { describe, expect, it } from "vitest";
import { type ConnectionInfo, renderConnection } from "../../src/render/connection";
import { xmlProblem } from "../helpers/xml";
import { fillOf, textElements } from "../helpers/svg";

const ACCENT = "#d97757";
const VALUE = "#f1ece4";

function info(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return { listening: true, serverError: undefined, sinceLastEventMs: 5_000, sessions: 2, usage: "ok", ...overrides };
}

/** Value text shown after the given row label. */
function valueAfter(svg: string, label: string): string | undefined {
	const texts = textElements(svg);
	return texts[texts.indexOf(label) + 1];
}

describe("renderConnection status row", () => {
	it("labels the row", () => {
		expect(textElements(renderConnection(info()))).toContain("STATUS");
	});

	it("shows none yet in amber when no status line update has arrived", () => {
		const svg = renderConnection(info({ sinceLastStatusMs: undefined }));
		expect(valueAfter(svg, "STATUS")).toBe("none yet");
		expect(fillOf(svg, "none yet")).toBe(ACCENT);
	});

	it("shows none yet when the field is omitted", () => {
		expect(valueAfter(renderConnection(info()), "STATUS")).toBe("none yet");
	});

	it("shows the time since the last update in the normal colour", () => {
		const svg = renderConnection(info({ sinceLastStatusMs: 125_000 }));
		expect(valueAfter(svg, "STATUS")).toBe("2m ago");
		expect(fillOf(svg, "2m ago")).toBe(VALUE);
	});

	it("shows an update that just arrived as 0s ago", () => {
		expect(valueAfter(renderConnection(info({ sinceLastStatusMs: 0 })), "STATUS")).toBe("0s ago");
	});

	it("keeps the hooks row independent of the status row", () => {
		const svg = renderConnection(info({ sinceLastEventMs: 5_000, sinceLastStatusMs: 3_600_000 }));
		expect(valueAfter(svg, "HOOKS")).toBe("5s ago");
		expect(valueAfter(svg, "STATUS")).toBe("1h ago");
	});

	it("produces well-formed SVG", () => {
		expect(xmlProblem(renderConnection(info({ sinceLastStatusMs: 9_000 })))).toBe("");
		expect(xmlProblem(renderConnection(info({ sinceLastStatusMs: undefined })))).toBe("");
	});
});
