import { describe, expect, it, vi } from "vitest";

vi.mock("@elgato/streamdeck", () => ({
	action: () => (target: unknown) => target,
	SingletonAction: class {},
}));

import { toPair } from "../../src/actions/usage";

describe("toPair", () => {
	it("defaults to the session and week windows", () => {
		expect(toPair({})).toEqual(["session", "week"]);
	});

	it("uses the configured windows", () => {
		expect(toPair({ first: "week", second: "sonnet" })).toEqual(["week", "sonnet"]);
		expect(toPair({ first: "sonnet", second: "session" })).toEqual(["sonnet", "session"]);
	});

	it("falls back to the defaults for unknown values", () => {
		expect(toPair({ first: "month", second: "year" })).toEqual(["session", "week"]);
		expect(toPair({ first: "", second: "" })).toEqual(["session", "week"]);
	});

	it("falls back to the defaults for values that are not strings", () => {
		expect(toPair({ first: 3 as unknown as string, second: null as unknown as string })).toEqual(["session", "week"]);
	});

	it("is case-sensitive", () => {
		expect(toPair({ first: "Week" })).toEqual(["session", "week"]);
	});

	it("shows the next window on the bottom bar when both bars match", () => {
		expect(toPair({ first: "session", second: "session" })).toEqual(["session", "week"]);
		expect(toPair({ first: "week", second: "week" })).toEqual(["week", "sonnet"]);
	});

	it("wraps to the first window after the last one when both bars match", () => {
		expect(toPair({ first: "sonnet", second: "sonnet" })).toEqual(["sonnet", "session"]);
	});

	it("moves the default bottom bar when the top bar is set to week", () => {
		expect(toPair({ first: "week" })).toEqual(["week", "sonnet"]);
	});

	it("never returns the same window twice", () => {
		const ids = ["session", "week", "sonnet", undefined, "bad"];
		for (const first of ids) {
			for (const second of ids) {
				const [a, b] = toPair({ first, second });
				expect(a).not.toBe(b);
			}
		}
	});
});
