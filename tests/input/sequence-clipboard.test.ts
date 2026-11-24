import { describe, expect, it } from "vitest";
import { parseSequence } from "../../src/input/sequence";

const CLIPBOARD = { type: "clipboard" };
const ENTER = { type: "key", vk: 0x0d, extended: false, modifiers: [] };

describe("parseSequence clipboard token", () => {
	it("parses {Clipboard} as one clipboard step", () => {
		expect(parseSequence("{Clipboard}", false)).toEqual([CLIPBOARD]);
	});

	it("matches the name case-insensitively", () => {
		expect(parseSequence("{CLIPBOARD}{clipboard}{ClipBoard}", false)).toEqual([CLIPBOARD, CLIPBOARD, CLIPBOARD]);
	});

	it("ignores spaces inside the braces", () => {
		expect(parseSequence("{ clipboard }", false)).toEqual([CLIPBOARD]);
	});

	it("combines with surrounding text", () => {
		expect(parseSequence("explain: {Clipboard}", false)).toEqual([{ type: "text", value: "explain: " }, CLIPBOARD]);
		expect(parseSequence("{Clipboard} please", false)).toEqual([CLIPBOARD, { type: "text", value: " please" }]);
	});

	it("combines with keys", () => {
		expect(parseSequence("{Esc}{Clipboard}{Enter}", false)).toEqual([
			{ type: "key", vk: 0x1b, extended: false, modifiers: [] },
			CLIPBOARD,
			ENTER,
		]);
	});

	it("appends Enter after the clipboard step when submit is true", () => {
		expect(parseSequence("explain: {Clipboard}", true)).toEqual([{ type: "text", value: "explain: " }, CLIPBOARD, ENTER]);
	});

	it("appends Enter to a sequence made only of a clipboard step", () => {
		expect(parseSequence("{Clipboard}", true)).toEqual([CLIPBOARD, ENTER]);
	});

	it("treats {{Clipboard}} as literal text", () => {
		expect(parseSequence("{{Clipboard}}", false)).toEqual([{ type: "text", value: "{Clipboard}" }]);
	});

	it("rejects a name that only starts with clipboard", () => {
		expect(() => parseSequence("{Clipboards}", false)).toThrow(/Unknown key/);
	});
});
