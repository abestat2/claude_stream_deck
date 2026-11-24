import { describe, expect, it } from "vitest";
import { parseSequence } from "../../src/input/sequence";

const key = (vk: number, extended = false, modifiers: number[] = []) => ({ type: "key", vk, extended, modifiers });
const ENTER = key(0x0d);

describe("parseSequence text", () => {
	it("returns no steps for an empty string", () => {
		expect(parseSequence("", false)).toEqual([]);
	});

	it("does not append Enter to an empty sequence when submit is true", () => {
		expect(parseSequence("", true)).toEqual([]);
	});

	it("types plain text as a single text step", () => {
		expect(parseSequence("yes", false)).toEqual([{ type: "text", value: "yes" }]);
	});

	it("appends Enter after the sequence when submit is true", () => {
		expect(parseSequence("yes", true)).toEqual([{ type: "text", value: "yes" }, ENTER]);
	});

	it("preserves spaces, punctuation and non-ASCII characters", () => {
		expect(parseSequence("  a, b! é 日本 ", false)).toEqual([{ type: "text", value: "  a, b! é 日本 " }]);
	});

	it("treats doubled braces as literal braces within text", () => {
		expect(parseSequence("a{{b}}c", false)).toEqual([{ type: "text", value: "a{b}c" }]);
	});

	it("treats a lone closing brace as text", () => {
		expect(parseSequence("a}b", false)).toEqual([{ type: "text", value: "a}b" }]);
	});

	it("keeps text on both sides of a key token as separate steps", () => {
		expect(parseSequence("ab{Enter}cd", false)).toEqual([
			{ type: "text", value: "ab" },
			ENTER,
			{ type: "text", value: "cd" },
		]);
	});

	it("emits adjacent key tokens without text steps between them", () => {
		expect(parseSequence("{Esc}{Esc}", false)).toEqual([key(0x1b), key(0x1b)]);
	});

	it("appends Enter after a trailing key token", () => {
		expect(parseSequence("{Esc}", true)).toEqual([key(0x1b), ENTER]);
	});
});

describe("parseSequence keys", () => {
	it("resolves names case-insensitively", () => {
		expect(parseSequence("{ENTER}{enter}{Enter}", false)).toEqual([ENTER, ENTER, ENTER]);
	});

	it("resolves aliases to the same key", () => {
		expect(parseSequence("{Return}", false)).toEqual(parseSequence("{Enter}", false));
		expect(parseSequence("{Escape}", false)).toEqual(parseSequence("{Esc}", false));
		expect(parseSequence("{Bksp}", false)).toEqual(parseSequence("{Backspace}", false));
		expect(parseSequence("{PgUp}", false)).toEqual(parseSequence("{PageUp}", false));
		expect(parseSequence("{PgDn}", false)).toEqual(parseSequence("{PageDown}", false));
		expect(parseSequence("{Del}", false)).toEqual(parseSequence("{Delete}", false));
		expect(parseSequence("{Ins}", false)).toEqual(parseSequence("{Insert}", false));
	});

	it("marks navigation keys as extended", () => {
		for (const name of ["Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Delete", "Insert"]) {
			expect(parseSequence(`{${name}}`, false)[0]).toMatchObject({ extended: true });
		}
	});

	it("does not mark ordinary keys as extended", () => {
		for (const name of ["Enter", "Esc", "Tab", "Space", "Backspace", "F5", "a", "7"]) {
			expect(parseSequence(`{${name}}`, false)[0]).toMatchObject({ extended: false });
		}
	});

	it("maps function keys F1 to F12 to consecutive virtual keys", () => {
		expect(parseSequence("{F1}", false)).toEqual([key(0x70)]);
		expect(parseSequence("{F12}", false)).toEqual([key(0x7b)]);
	});

	it("rejects F0 and F13", () => {
		expect(() => parseSequence("{F0}", false)).toThrow(/Unknown key/);
		expect(() => parseSequence("{F13}", false)).toThrow(/Unknown key/);
	});

	it("maps letters to upper-case virtual-key codes", () => {
		expect(parseSequence("{a}", false)).toEqual([key(0x41)]);
		expect(parseSequence("{Z}", false)).toEqual([key(0x5a)]);
	});

	it("maps digits to their character codes", () => {
		expect(parseSequence("{0}", false)).toEqual([key(0x30)]);
		expect(parseSequence("{9}", false)).toEqual([key(0x39)]);
	});

	it("resolves Tab and Space", () => {
		expect(parseSequence("{Tab}{Space}", false)).toEqual([key(0x09), key(0x20)]);
	});
});

describe("parseSequence modifiers", () => {
	it("attaches a single modifier to a key", () => {
		expect(parseSequence("{Shift+Tab}", false)).toEqual([key(0x09, false, [0x10])]);
	});

	it("keeps modifiers in the order written", () => {
		expect(parseSequence("{Ctrl+Shift+Alt+Win+A}", false)).toEqual([key(0x41, false, [0x11, 0x10, 0x12, 0x5b])]);
	});

	it("treats Control as an alias for Ctrl", () => {
		expect(parseSequence("{Control+C}", false)).toEqual(parseSequence("{Ctrl+C}", false));
	});

	it("ignores whitespace around modifier and key names", () => {
		expect(parseSequence("{ Ctrl + C }", false)).toEqual(parseSequence("{Ctrl+C}", false));
	});

	it("accepts modifier names in any case", () => {
		expect(parseSequence("{CTRL+c}", false)).toEqual(parseSequence("{ctrl+C}", false));
	});

	it("rejects an unknown modifier and names it in the message", () => {
		expect(() => parseSequence("{Hyper+A}", false)).toThrow(/Unknown modifier "Hyper"/);
	});

	it("rejects a modifier used as the key", () => {
		expect(() => parseSequence("{Ctrl}", false)).toThrow(/Unknown key/);
	});

	it("rejects a trailing plus", () => {
		expect(() => parseSequence("{Ctrl+}", false)).toThrow(/Unknown key/);
	});
});

describe("parseSequence errors", () => {
	it("rejects an unknown key and names it in the message", () => {
		expect(() => parseSequence("{Bogus}", false)).toThrow('Unknown key "{Bogus}"');
	});

	it("rejects an empty token", () => {
		expect(() => parseSequence("{}", false)).toThrow(/Unknown key/);
	});

	it("rejects multi-character names that are not keys", () => {
		expect(() => parseSequence("{ab}", false)).toThrow(/Unknown key/);
	});

	it("rejects an unclosed brace", () => {
		expect(() => parseSequence("abc{Enter", false)).toThrow(/Unclosed/);
		expect(() => parseSequence("{", false)).toThrow(/Unclosed/);
	});

	it("rejects an unclosed brace that follows a literal brace pair", () => {
		expect(() => parseSequence("{{x}} {Enter", false)).toThrow(/Unclosed/);
	});

	it("throws instead of returning partial steps when a later token is invalid", () => {
		expect(() => parseSequence("hello{Enter}{Nope}", true)).toThrow(/Unknown key/);
	});
});
