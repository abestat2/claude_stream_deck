import { describe, expect, it } from "vitest";
import { clipText, escapeXml, wrapText } from "../../src/render/text";

describe("escapeXml", () => {
	it("escapes ampersands, angle brackets, and double quotes", () => {
		expect(escapeXml(`a & b < c > d "e"`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
	});

	it("escapes an ampersand before the entities it introduces", () => {
		expect(escapeXml("&lt;")).toBe("&amp;lt;");
	});

	it("leaves text without special characters unchanged", () => {
		expect(escapeXml("plain text 123")).toBe("plain text 123");
		expect(escapeXml("")).toBe("");
	});

	it("leaves single quotes unchanged", () => {
		expect(escapeXml("it's")).toBe("it's");
	});

	it("escapes every occurrence", () => {
		expect(escapeXml('<<>>&&""')).toBe("&lt;&lt;&gt;&gt;&amp;&amp;&quot;&quot;");
	});
});

describe("wrapText", () => {
	it("returns no lines for empty or whitespace-only input", () => {
		expect(wrapText("", 10, 3)).toEqual([]);
		expect(wrapText("   \n\t ", 10, 3)).toEqual([]);
	});

	it("keeps short text on one line", () => {
		expect(wrapText("hello world", 20, 3)).toEqual(["hello world"]);
	});

	it("collapses runs of whitespace into single spaces", () => {
		expect(wrapText("a   b\n\nc\td", 20, 3)).toEqual(["a b c d"]);
	});

	it("breaks between words when the next word does not fit", () => {
		expect(wrapText("one two three four", 9, 5)).toEqual(["one two", "three", "four"]);
	});

	it("fits a line of exactly maxChars characters", () => {
		expect(wrapText("abc def", 7, 3)).toEqual(["abc def"]);
	});

	it("wraps when a line would be one character over maxChars", () => {
		expect(wrapText("abc def", 6, 3)).toEqual(["abc", "def"]);
	});

	it("keeps a word of exactly maxChars characters whole", () => {
		expect(wrapText("abcdef", 6, 3)).toEqual(["abcdef"]);
	});

	it("splits a word longer than a line", () => {
		expect(wrapText("abcdefghij", 4, 5)).toEqual(["abcd", "efgh", "ij"]);
	});

	it("splits a word that is an exact multiple of maxChars", () => {
		expect(wrapText("abcdef", 3, 5)).toEqual(["abc", "def"]);
	});

	it("flushes the current line before an overlong word", () => {
		expect(wrapText("hi abcdefgh", 4, 5)).toEqual(["hi", "abcd", "efgh"]);
	});

	it("joins the remainder of a split word with following words when they fit", () => {
		expect(wrapText("abcdef g", 4, 5)).toEqual(["abcd", "ef g"]);
	});

	it("never produces a line longer than maxChars", () => {
		const text = "the quick brown fox jumps over the extraordinarily lazy dog near supercalifragilistic";
		for (const line of wrapText(text, 8, 20)) {
			expect(line.length).toBeLessThanOrEqual(8);
		}
	});

	it("returns exactly maxLines lines without an ellipsis when the text ends on the last line", () => {
		expect(wrapText("aa bb", 2, 2)).toEqual(["aa", "bb"]);
	});

	it("ends the last line with an ellipsis when text is left over", () => {
		const lines = wrapText("aaaa bbbb cccc dddd", 4, 2);
		expect(lines).toEqual(["aaaa", "bbb…"]);
	});

	it("keeps the truncated last line within maxChars", () => {
		const lines = wrapText("one two three four five six seven", 7, 2);
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(7);
		}
		expect(lines[1]?.endsWith("…")).toBe(true);
	});

	it("drops trailing whitespace before the ellipsis", () => {
		expect(wrapText("aa bbbb cccc", 4, 1)).toEqual(["aa…"]);
	});

	it("adds no ellipsis when everything fits", () => {
		expect(wrapText("one two", 10, 1).join("")).not.toContain("…");
	});

	it("returns no lines when maxLines is zero", () => {
		expect(wrapText("anything", 5, 0)).toEqual([]);
	});

	it("truncates an overlong word that exceeds the line budget", () => {
		expect(wrapText("abcdefghijkl", 4, 2)).toEqual(["abcd", "efg…"]);
	});
});

describe("clipText", () => {
	it("returns text that fits unchanged", () => {
		expect(clipText("abc", 3)).toBe("abc");
		expect(clipText("", 3)).toBe("");
	});

	it("cuts text one character over the limit and appends an ellipsis", () => {
		expect(clipText("abcd", 3)).toBe("ab…");
	});

	it("keeps the result within the limit", () => {
		expect(clipText("abcdefghij", 5)).toHaveLength(5);
	});

	it("trims whitespace before the ellipsis", () => {
		expect(clipText("ab  cdef", 5)).toBe("ab…");
	});
});
