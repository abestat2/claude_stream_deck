import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endsWithQuestion, SessionStore, type HookEvent, type Summary } from "../../src/state/sessions";

const MINUTE = 60_000;
const WORKING_STALE = 10 * MINUTE;
const EXPIRY = 120 * MINUTE;

let store: SessionStore;
let changes: Summary[];

function fire(name: string, session = "s1", extra: Partial<HookEvent> = {}): void {
	store.handle({ hook_event_name: name, session_id: session, ...extra });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	store = new SessionStore();
	changes = [];
	store.on("change", (summary: Summary) => changes.push(summary));
});

afterEach(() => {
	store.stop();
	vi.useRealTimers();
});

describe("endsWithQuestion", () => {
	it("is true for a message that ends with a question", () => {
		expect(endsWithQuestion("Want me to continue?")).toBe(true);
	});

	it("is false for a statement", () => {
		expect(endsWithQuestion("All done.")).toBe(false);
	});

	it("looks only at the final paragraph", () => {
		expect(endsWithQuestion("Should I?\n\nI did it anyway.")).toBe(false);
		expect(endsWithQuestion("Finished.\n\nShall I commit?")).toBe(true);
	});

	it("detects a question mark anywhere in the final paragraph", () => {
		expect(endsWithQuestion("Is this right? I will proceed.")).toBe(true);
	});

	it("separates paragraphs on blank lines that contain whitespace", () => {
		expect(endsWithQuestion("Why?\n   \nBecause.")).toBe(false);
	});

	it("does not split on a single newline", () => {
		expect(endsWithQuestion("Why?\nBecause.")).toBe(true);
	});

	it("ignores trailing whitespace and newlines", () => {
		expect(endsWithQuestion("Ready?\n\n\n  ")).toBe(true);
		expect(endsWithQuestion("Done.\n\n  \n")).toBe(false);
	});

	it("handles CRLF paragraph breaks", () => {
		expect(endsWithQuestion("Why?\r\n\r\nBecause.")).toBe(false);
		expect(endsWithQuestion("Because.\r\n\r\nWhy?")).toBe(true);
	});

	it("is false for an empty or whitespace-only string", () => {
		expect(endsWithQuestion("")).toBe(false);
		expect(endsWithQuestion("   \n ")).toBe(false);
	});

	it("is false for values that are not strings", () => {
		for (const value of [undefined, null, 5, {}, ["a?"], true]) {
			expect(endsWithQuestion(value)).toBe(false);
		}
	});

	it("counts a question mark inside a code span as a question", () => {
		expect(endsWithQuestion("Use `a ? b : c` here.")).toBe(true);
	});
});

describe("SessionStore state transitions", () => {
	it("reports an empty idle summary with no sessions", () => {
		expect(store.summary()).toEqual({ sessions: 0, working: 0, attention: 0, done: 0, idle: 0, agents: 0, overall: "idle" });
	});

	it("starts a session as idle on SessionStart", () => {
		fire("SessionStart");
		expect(store.summary()).toMatchObject({ sessions: 1, idle: 1, overall: "idle" });
	});

	it.each(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionDenied"])(
		"marks the session working on %s",
		(name) => {
			fire(name);
			expect(store.summary()).toMatchObject({ working: 1, overall: "working" });
		},
	);

	it.each(["PermissionRequest", "Elicitation"])("marks the session as needing attention on %s", (name) => {
		fire(name);
		expect(store.summary()).toMatchObject({ attention: 1, overall: "attention" });
	});

	it.each(["permission_prompt", "elicitation_dialog"])("marks attention for a %s notification", (type) => {
		fire("UserPromptSubmit");
		fire("Notification", "s1", { notification_type: type });
		expect(store.summary().overall).toBe("attention");
	});

	it("keeps the current state for other notification types", () => {
		fire("UserPromptSubmit");
		fire("Notification", "s1", { notification_type: "idle_prompt" });
		expect(store.summary().overall).toBe("working");
	});

	it("keeps the current state for a notification without a type", () => {
		fire("UserPromptSubmit");
		fire("Notification");
		fire("Notification", "s1", { notification_type: 7 });
		expect(store.summary().overall).toBe("working");
	});

	it("reports done after a stop without a question", () => {
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Finished the change." });
		expect(store.summary()).toMatchObject({ done: 1, overall: "done" });
	});

	it("reports attention after a stop that ends with a question", () => {
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Should I keep going?" });
		expect(store.summary()).toMatchObject({ attention: 1, overall: "attention" });
	});

	it("reports done after a stop with no message", () => {
		fire("Stop");
		expect(store.summary().overall).toBe("done");
	});

	it("reports done after a stop whose message is not a string", () => {
		fire("Stop", "s1", { last_assistant_message: 42 });
		expect(store.summary().overall).toBe("done");
	});

	it("resets to idle on StopFailure", () => {
		fire("UserPromptSubmit");
		fire("StopFailure");
		expect(store.summary().overall).toBe("idle");
	});

	it("resets a done session to idle on SessionStart", () => {
		fire("Stop");
		fire("SessionStart");
		expect(store.summary().overall).toBe("idle");
	});

	it("moves from attention back to working when a tool runs", () => {
		fire("PermissionRequest");
		fire("PostToolUse");
		expect(store.summary().overall).toBe("working");
	});

	it("removes the session on SessionEnd", () => {
		fire("UserPromptSubmit");
		fire("SessionEnd");
		expect(store.summary()).toMatchObject({ sessions: 0, overall: "idle" });
	});

	it("allows a session id to start again after SessionEnd", () => {
		fire("UserPromptSubmit");
		fire("SessionEnd");
		fire("SessionStart");
		expect(store.summary()).toMatchObject({ sessions: 1, idle: 1 });
	});

	it("creates an idle session for an unrecognised event name", () => {
		fire("SomethingNew");
		expect(store.summary()).toMatchObject({ sessions: 1, idle: 1 });
	});
});

describe("SessionStore done state", () => {
	it("keeps done until the next prompt is submitted", () => {
		fire("Stop");
		vi.advanceTimersByTime(EXPIRY - MINUTE);
		expect(store.summary().overall).toBe("done");
	});

	it("leaves done on a non-working notification", () => {
		fire("Stop");
		fire("Notification", "s1", { notification_type: "idle_prompt" });
		expect(store.summary().overall).toBe("done");
	});

	it("clears done when the next prompt is submitted", () => {
		fire("Stop");
		fire("UserPromptSubmit");
		expect(store.summary()).toMatchObject({ done: 0, working: 1, overall: "working" });
	});

	it("ranks done above idle and below working", () => {
		fire("Stop", "a");
		fire("SessionStart", "b");
		expect(store.summary()).toMatchObject({ done: 1, idle: 1, overall: "done" });
		fire("UserPromptSubmit", "b");
		expect(store.summary().overall).toBe("working");
	});
});

describe("SessionStore aggregation", () => {
	it("ranks attention above working, working above done", () => {
		fire("Stop", "a");
		fire("UserPromptSubmit", "b");
		expect(store.summary().overall).toBe("working");
		fire("PermissionRequest", "c");
		expect(store.summary()).toMatchObject({ sessions: 3, done: 1, working: 1, attention: 1, overall: "attention" });
	});

	it("tracks sessions independently", () => {
		fire("UserPromptSubmit", "a");
		fire("UserPromptSubmit", "b");
		fire("Stop", "a");
		expect(store.summary()).toMatchObject({ sessions: 2, working: 1, done: 1 });
	});

	it("only removes the session named by SessionEnd", () => {
		fire("UserPromptSubmit", "a");
		fire("UserPromptSubmit", "b");
		fire("SessionEnd", "a");
		expect(store.summary()).toMatchObject({ sessions: 1, working: 1 });
	});
});

describe("SessionStore subagents", () => {
	it("counts running subagents", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("SubagentStart", "s1", { agent_id: "a2" });
		expect(store.summary().agents).toBe(2);
	});

	it("moves an idle session to working when a subagent starts", () => {
		fire("SessionStart");
		fire("SubagentStart", "s1", { agent_id: "a1" });
		expect(store.summary().overall).toBe("working");
	});

	it("does not change an attention session when a subagent starts", () => {
		fire("PermissionRequest");
		fire("SubagentStart", "s1", { agent_id: "a1" });
		expect(store.summary()).toMatchObject({ attention: 1, agents: 1, overall: "attention" });
	});

	it("does not count the same subagent id twice", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("SubagentStart", "s1", { agent_id: "a1" });
		expect(store.summary().agents).toBe(1);
	});

	it("removes a subagent on SubagentStop", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("SubagentStop", "s1", { agent_id: "a1" });
		expect(store.summary().agents).toBe(0);
	});

	it("ignores SubagentStop for an unknown agent", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("SubagentStop", "s1", { agent_id: "other" });
		expect(store.summary().agents).toBe(1);
	});

	it("ignores subagent events without a string agent id", () => {
		fire("SubagentStart", "s1", { agent_id: 3 });
		fire("SubagentStart", "s1");
		expect(store.summary().agents).toBe(0);
	});

	it("counts a session with running subagents as working after Stop leaves it done", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("Stop");
		expect(store.summary()).toMatchObject({ working: 1, done: 0, agents: 1 });
	});

	it("returns a done session to done once its last subagent stops", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("Stop");
		fire("SubagentStop", "s1", { agent_id: "a1" });
		expect(store.summary()).toMatchObject({ done: 1, agents: 0, overall: "done" });
	});

	it("sums subagents across sessions", () => {
		fire("SubagentStart", "a", { agent_id: "x" });
		fire("SubagentStart", "b", { agent_id: "y" });
		expect(store.summary().agents).toBe(2);
	});

	it("drops subagents when the session ends", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		fire("SessionEnd");
		expect(store.summary().agents).toBe(0);
	});
});

describe("SessionStore staleness and expiry", () => {
	it("reports working until the stale limit is exceeded", () => {
		fire("UserPromptSubmit");
		vi.advanceTimersByTime(WORKING_STALE);
		expect(store.summary().overall).toBe("working");
	});

	it("reports a working session as idle after ten quiet minutes", () => {
		fire("UserPromptSubmit");
		vi.advanceTimersByTime(WORKING_STALE + 1);
		expect(store.summary()).toMatchObject({ working: 0, idle: 1, sessions: 1, overall: "idle" });
	});

	it("returns a stale session to working on its next event", () => {
		fire("UserPromptSubmit");
		vi.advanceTimersByTime(WORKING_STALE + 1);
		fire("PreToolUse");
		expect(store.summary().overall).toBe("working");
	});

	it("applies the stale limit to sessions that only have running subagents", () => {
		fire("SubagentStart", "s1", { agent_id: "a1" });
		vi.advanceTimersByTime(WORKING_STALE + 1);
		expect(store.summary()).toMatchObject({ working: 0, idle: 1, agents: 1 });
	});

	it("never marks an attention session stale", () => {
		fire("PermissionRequest");
		vi.advanceTimersByTime(EXPIRY - 1);
		expect(store.summary().overall).toBe("attention");
	});

	it("keeps an idle session until the expiry limit", () => {
		fire("SessionStart");
		vi.advanceTimersByTime(EXPIRY);
		expect(store.summary().sessions).toBe(1);
	});

	it("removes a session after two quiet hours", () => {
		fire("SessionStart");
		vi.advanceTimersByTime(EXPIRY + 1);
		expect(store.summary()).toMatchObject({ sessions: 0, overall: "idle" });
	});

	it("removes expired sessions in every state", () => {
		fire("Stop", "done");
		fire("PermissionRequest", "attn");
		fire("UserPromptSubmit", "work");
		vi.advanceTimersByTime(EXPIRY + 1);
		expect(store.summary().sessions).toBe(0);
	});

	it("expires only the quiet session when another is active", () => {
		fire("SessionStart", "old");
		vi.advanceTimersByTime(EXPIRY);
		fire("UserPromptSubmit", "new");
		vi.advanceTimersByTime(1);
		expect(store.summary()).toMatchObject({ sessions: 1, working: 1 });
	});

	it("refreshes the quiet timer on every event", () => {
		fire("UserPromptSubmit");
		vi.advanceTimersByTime(WORKING_STALE - 1);
		fire("PostToolUse");
		vi.advanceTimersByTime(WORKING_STALE - 1);
		expect(store.summary().overall).toBe("working");
	});

	it("emits a change from the periodic sweep when a session goes stale", () => {
		store.start();
		fire("UserPromptSubmit");
		expect(changes).toHaveLength(1);
		vi.advanceTimersByTime(WORKING_STALE + 30_000);
		expect(changes).toHaveLength(2);
		expect(changes[1]).toMatchObject({ working: 0, idle: 1 });
	});

	it("emits a change from the periodic sweep when a session expires", () => {
		store.start();
		fire("SessionStart");
		vi.advanceTimersByTime(EXPIRY + 30_000);
		expect(changes.at(-1)).toMatchObject({ sessions: 0 });
	});

	it("emits nothing from the sweep while the view is unchanged", () => {
		store.start();
		fire("UserPromptSubmit");
		vi.advanceTimersByTime(5 * MINUTE);
		expect(changes).toHaveLength(1);
	});

	it("does not sweep after stop", () => {
		store.start();
		fire("UserPromptSubmit");
		store.stop();
		vi.advanceTimersByTime(WORKING_STALE + 60_000);
		expect(changes).toHaveLength(1);
	});

	it("starts only one sweep timer when start is called twice", () => {
		store.start();
		store.start();
		expect(vi.getTimerCount()).toBe(1);
	});
});

describe("SessionStore ignored events", () => {
	const garbage: unknown[] = [
		{},
		{ hook_event_name: "Stop" },
		{ session_id: "s1" },
		{ hook_event_name: "", session_id: "s1" },
		{ hook_event_name: "Stop", session_id: "" },
		{ hook_event_name: 5, session_id: "s1" },
		{ hook_event_name: "Stop", session_id: 5 },
		{ hook_event_name: null, session_id: null },
		{ hook_event_name: ["Stop"], session_id: ["s1"] },
	];

	it.each(garbage.map((event, i) => [i, event] as const))("ignores malformed event %i", (_i, event) => {
		store.handle(event as HookEvent);
		expect(store.summary().sessions).toBe(0);
		expect(changes).toHaveLength(0);
	});

	it("ignores unrelated fields on a valid event", () => {
		store.handle({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: "C:\\x", extra: { a: 1 } } as HookEvent);
		expect(store.summary().working).toBe(1);
	});
});

describe("SessionStore change events", () => {
	it("emits the new summary when the view changes", () => {
		fire("UserPromptSubmit");
		expect(changes).toEqual([{ sessions: 1, working: 1, attention: 0, done: 0, idle: 0, agents: 0, overall: "working" }]);
	});

	it("does not emit when an event leaves the view unchanged", () => {
		fire("UserPromptSubmit");
		fire("PreToolUse");
		fire("PostToolUse");
		expect(changes).toHaveLength(1);
	});

	it("emits again when the state changes", () => {
		fire("UserPromptSubmit");
		fire("Stop");
		expect(changes.map((c) => c.overall)).toEqual(["working", "done"]);
	});

	it("emits when only the subagent count changes", () => {
		fire("UserPromptSubmit");
		fire("SubagentStart", "s1", { agent_id: "a1" });
		expect(changes).toHaveLength(2);
		expect(changes[1]?.agents).toBe(1);
	});

	it("emits when a session ends", () => {
		fire("UserPromptSubmit");
		fire("SessionEnd");
		expect(changes.at(-1)).toMatchObject({ sessions: 0 });
	});

	it("does not emit when a notification of an ignored type arrives for a known state", () => {
		fire("UserPromptSubmit");
		fire("Notification", "s1", { notification_type: "idle_prompt" });
		expect(changes).toHaveLength(1);
	});

	it("emits the empty summary for the first event when it removes nothing", () => {
		fire("SessionEnd", "unknown");
		expect(changes).toEqual([{ sessions: 0, working: 0, attention: 0, done: 0, idle: 0, agents: 0, overall: "idle" }]);
	});
});
