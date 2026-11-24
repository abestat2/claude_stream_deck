import { describe, expect, it } from "vitest";
import { hookServerStatus } from "../../src/server/hook-server";

describe("hookServerStatus", () => {
	it("starts as not listening with no error", () => {
		expect(hookServerStatus).toEqual({ listening: false, error: undefined });
	});
});
