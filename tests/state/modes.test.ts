import { describe, expect, it } from "vitest";
import { nextMode } from "../../src/state/modes";
import { SessionStore } from "../../src/state/sessions";

const none = new Set<string>();

describe("nextMode", () => {
	it("moves from default to accept edits and from accept edits to plan", () => {
		expect(nextMode("default", none)).toBe("acceptEdits");
		expect(nextMode("acceptEdits", none)).toBe("plan");
	});

	it("returns to default from plan when neither bypass nor auto has been reported", () => {
		expect(nextMode("plan", none)).toBe("default");
		expect(nextMode("plan", new Set(["default", "plan"]))).toBe("default");
	});

	it("moves from plan to auto once auto has been reported", () => {
		expect(nextMode("plan", new Set(["auto"]))).toBe("auto");
	});

	it("moves from plan to bypass once bypass has been reported, ahead of auto", () => {
		expect(nextMode("plan", new Set(["bypassPermissions"]))).toBe("bypassPermissions");
		expect(nextMode("plan", new Set(["bypassPermissions", "auto"]))).toBe("bypassPermissions");
	});

	it("moves from bypass to auto when auto has been reported, otherwise to default", () => {
		expect(nextMode("bypassPermissions", new Set(["auto"]))).toBe("auto");
		expect(nextMode("bypassPermissions", none)).toBe("default");
	});

	it.each([["auto"], ["dontAsk"], ["someNewMode"], [""]])("returns to default from %j", (mode) => {
		expect(nextMode(mode, new Set(["auto", "bypassPermissions"]))).toBe("default");
	});

	it("does not modify the set of seen modes", () => {
		const seen = new Set(["auto"]);
		nextMode("plan", seen);
		expect([...seen]).toEqual(["auto"]);
	});
});

describe("SessionStore.seenModes", () => {
	const event = (session: string, mode?: unknown) =>
		({ hook_event_name: "UserPromptSubmit", session_id: session, permission_mode: mode }) as never;

	it("starts empty", () => {
		expect(new SessionStore().seenModes().size).toBe(0);
	});

	it("records each reported mode once, across sessions", () => {
		const store = new SessionStore();
		store.handle(event("a", "plan"));
		store.handle(event("b", "auto"));
		store.handle(event("a", "plan"));
		expect([...store.seenModes()].sort()).toEqual(["auto", "plan"]);
	});

	it("ignores events without a usable mode", () => {
		const store = new SessionStore();
		store.handle(event("a"));
		store.handle(event("a", ""));
		store.handle(event("a", 7));
		expect(store.seenModes().size).toBe(0);
	});

	it("keeps a mode after its session ends", () => {
		const store = new SessionStore();
		store.handle(event("a", "auto"));
		store.handle({ hook_event_name: "SessionEnd", session_id: "a" } as never);
		expect(store.seenModes().has("auto")).toBe(true);
	});
});
