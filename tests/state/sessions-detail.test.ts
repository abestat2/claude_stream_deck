import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type HookEvent, type Summary } from "../../src/state/sessions";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const EXPIRY = 120 * MINUTE;

let store: SessionStore;
let changes: Summary[];
let details: number;

function fire(name: string, session = "s1", extra: Partial<HookEvent> = {}): void {
	store.handle({ hook_event_name: name, session_id: session, ...extra });
}

function info(session = "s1") {
	const found = store.sessions().find((s) => s.id === session);
	if (!found) throw new Error(`no session ${session}`);
	return found;
}

function advance(ms: number): void {
	vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	store = new SessionStore();
	changes = [];
	details = 0;
	store.on("change", (summary: Summary) => changes.push(summary));
	store.on("detail", () => details++);
});

afterEach(() => {
	store.stop();
	vi.useRealTimers();
});

describe("SessionStore.sessions", () => {
	it("returns an empty list when nothing is tracked", () => {
		expect(store.sessions()).toEqual([]);
	});

	it("reports every field of a new session", () => {
		fire("SessionStart", "s1", { cwd: "C:\\code\\demo", permission_mode: "plan" });
		expect(info()).toEqual({
			id: "s1",
			project: "demo",
			state: "idle",
			agents: 0,
			turnStartedAt: undefined,
			attentionSince: undefined,
			pending: undefined,
			currentTool: undefined,
			permissionMode: "plan",
			lastSeen: Date.now(),
		});
	});

	it("sorts sessions with the most recent event first", () => {
		fire("SessionStart", "a");
		advance(SECOND);
		fire("SessionStart", "b");
		advance(SECOND);
		fire("SessionStart", "c");
		expect(store.sessions().map((s) => s.id)).toEqual(["c", "b", "a"]);
		advance(SECOND);
		fire("UserPromptSubmit", "a");
		expect(store.sessions().map((s) => s.id)).toEqual(["a", "c", "b"]);
	});

	it("removes sessions after the expiry period and keeps them at the boundary", () => {
		fire("SessionStart", "s1");
		advance(EXPIRY);
		expect(store.sessions()).toHaveLength(1);
		advance(1);
		expect(store.sessions()).toHaveLength(0);
	});

	it("counts subagents per session", () => {
		fire("SubagentStart", "s1", { agent_id: "x" });
		fire("SubagentStart", "s1", { agent_id: "y" });
		expect(info().agents).toBe(2);
	});

	it("keeps the last known project when a later event has no cwd", () => {
		fire("SessionStart", "s1", { cwd: "/a/first" });
		fire("UserPromptSubmit", "s1");
		expect(info().project).toBe("first");
		fire("UserPromptSubmit", "s1", { cwd: "/a/second" });
		expect(info().project).toBe("second");
	});

	it("ignores an empty or non-string permission mode and cwd", () => {
		fire("SessionStart", "s1", { cwd: "/a/proj", permission_mode: "default" });
		fire("UserPromptSubmit", "s1", { cwd: 5, permission_mode: "" });
		expect(info().project).toBe("proj");
		expect(info().permissionMode).toBe("default");
		fire("UserPromptSubmit", "s1", { permission_mode: 3 });
		expect(info().permissionMode).toBe("default");
	});

	it("updates the permission mode on later events", () => {
		fire("UserPromptSubmit", "s1", { permission_mode: "default" });
		fire("PreToolUse", "s1", { tool_name: "Bash", permission_mode: "acceptEdits" });
		expect(info().permissionMode).toBe("acceptEdits");
	});

	it("records the current tool and keeps it when a later tool event has no name", () => {
		fire("PreToolUse", "s1", { tool_name: "mcp__fs__read" });
		expect(info().currentTool).toBe("read (fs)");
		fire("PreToolUse", "s1", {});
		expect(info().currentTool).toBe("read (fs)");
	});
});

describe("turnStartedAt", () => {
	it("is set on UserPromptSubmit and not changed by later tool events", () => {
		fire("UserPromptSubmit");
		const start = Date.now();
		expect(info().turnStartedAt).toBe(start);
		advance(5 * SECOND);
		fire("PreToolUse", "s1", { tool_name: "Bash" });
		fire("PostToolUse");
		expect(info().turnStartedAt).toBe(start);
	});

	it("restarts on a new prompt", () => {
		fire("UserPromptSubmit");
		advance(10 * SECOND);
		fire("UserPromptSubmit");
		expect(info().turnStartedAt).toBe(Date.now());
	});

	it.each(["Stop", "StopFailure", "SessionStart"])("is cleared by %s", (name) => {
		fire("UserPromptSubmit");
		fire(name);
		expect(info().turnStartedAt).toBeUndefined();
	});

	it("is cleared by a Stop that ends with a question", () => {
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Ok?" });
		expect(info().state).toBe("attention");
		expect(info().turnStartedAt).toBeUndefined();
	});

	it("is not set by a permission request alone", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
		expect(info().turnStartedAt).toBeUndefined();
	});
});

describe("attentionSince", () => {
	it("is set when a permission request starts a wait", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash" });
		expect(info().attentionSince).toBe(Date.now());
	});

	it("is reset by each new permission request", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash" });
		advance(MINUTE);
		fire("PermissionRequest", "s1", { tool_name: "Edit" });
		expect(info().attentionSince).toBe(Date.now());
		expect(info().pending?.tool).toBe("Edit");
	});

	it("is set by Elicitation and by a Stop with a question", () => {
		fire("Elicitation", "a", { message: "Pick one" });
		fire("Stop", "b", { last_assistant_message: "Which?" });
		expect(info("a").attentionSince).toBe(Date.now());
		expect(info("b").attentionSince).toBe(Date.now());
	});

	it("is set by an attention notification only when the wait starts", () => {
		fire("Notification", "s1", { notification_type: "permission_prompt", message: "m" });
		const start = Date.now();
		expect(info().attentionSince).toBe(start);
		advance(MINUTE);
		fire("Notification", "s1", { notification_type: "permission_prompt", message: "m" });
		expect(info().attentionSince).toBe(start);
	});

	it("is not changed by a notification after a permission request", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash" });
		const start = Date.now();
		advance(MINUTE);
		fire("Notification", "s1", { notification_type: "permission_prompt" });
		expect(info().attentionSince).toBe(start);
	});

	it.each(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionDenied", "StopFailure", "SessionStart"])(
		"is cleared along with pending when %s ends the wait",
		(name) => {
			fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
			fire(name);
			expect(info().attentionSince).toBeUndefined();
			expect(info().pending).toBeUndefined();
		},
	);

	it("is cleared by a Stop without a question", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash" });
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(info().state).toBe("done");
		expect(info().attentionSince).toBeUndefined();
	});

	it("is not set by notification types that are not waits", () => {
		fire("Notification", "s1", { notification_type: "idle_prompt" });
		expect(info().attentionSince).toBeUndefined();
		expect(info().state).toBe("idle");
	});
});

describe("pending request", () => {
	it("is a permission with tool and command detail for PermissionRequest", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "npm   test" } });
		expect(info().pending).toEqual({ kind: "permission", tool: "Bash", detail: "npm test" });
	});

	it("uses the display name for mcp tools", () => {
		fire("PermissionRequest", "s1", { tool_name: "mcp__db__query", tool_input: { query: "select 1" } });
		expect(info().pending).toEqual({ kind: "permission", tool: "query (db)", detail: "select 1" });
	});

	it("is a question with the message for Elicitation", () => {
		fire("Elicitation", "s1", { message: "Enter  a\nname" });
		expect(info().pending).toEqual({ kind: "question", tool: undefined, detail: "Enter a name" });
	});

	it("uses an empty detail for Elicitation without a message", () => {
		fire("Elicitation", "s1", {});
		expect(info().pending).toEqual({ kind: "question", tool: undefined, detail: "" });
	});

	it("is a permission for a permission_prompt notification", () => {
		fire("Notification", "s1", { notification_type: "permission_prompt", message: "Claude needs permission" });
		expect(info().state).toBe("attention");
		expect(info().pending).toEqual({ kind: "permission", tool: undefined, detail: "Claude needs permission" });
	});

	it("is a question for an elicitation_dialog notification", () => {
		fire("Notification", "s1", { notification_type: "elicitation_dialog", message: "Answer me" });
		expect(info().pending).toEqual({ kind: "question", tool: undefined, detail: "Answer me" });
	});

	it("is not overwritten by a later notification when a permission request set it", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "rm x" } });
		fire("Notification", "s1", { notification_type: "permission_prompt", message: "Claude needs permission" });
		expect(info().pending).toEqual({ kind: "permission", tool: "Bash", detail: "rm x" });
	});

	it("uses the last paragraph of the message for a Stop with a question", () => {
		fire("Stop", "s1", { last_assistant_message: "Did a lot.\n\nFirst part.\n\nShall I\ncommit  now?\n\n" });
		expect(info().state).toBe("attention");
		expect(info().pending).toEqual({ kind: "question", tool: undefined, detail: "Shall I commit now?" });
	});

	it("clips a long question detail", () => {
		fire("Stop", "s1", { last_assistant_message: "q".repeat(300) + "?" });
		const detail = info().pending?.detail ?? "";
		expect(detail).toHaveLength(160);
		expect(detail.endsWith("…")).toBe(true);
	});

	it("is cleared once the session leaves attention", () => {
		fire("Elicitation", "s1", { message: "x" });
		fire("PostToolUse");
		expect(info().pending).toBeUndefined();
	});

	it("keeps the attention state when a subagent starts", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash" });
		fire("SubagentStart", "s1", { agent_id: "x" });
		expect(info().state).toBe("attention");
	});
});

describe("SessionStore.pendingPermission", () => {
	it("is undefined with no sessions", () => {
		expect(store.pendingPermission()).toBeUndefined();
	});

	it("is undefined when no session is waiting", () => {
		fire("UserPromptSubmit");
		expect(store.pendingPermission()).toBeUndefined();
	});

	it("returns the session, request, and zero others for a single permission wait", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
		const result = store.pendingPermission();
		expect(result?.session.id).toBe("s1");
		expect(result?.request).toEqual({ kind: "permission", tool: "Bash", detail: "ls" });
		expect(result?.others).toBe(0);
	});

	it("ignores question-type waits", () => {
		fire("Elicitation", "s1", { message: "Pick" });
		fire("Stop", "s2", { last_assistant_message: "Ok?" });
		expect(store.pendingPermission()).toBeUndefined();
	});

	it("picks the permission request that started waiting most recently", () => {
		fire("PermissionRequest", "a", { tool_name: "Bash" });
		advance(SECOND);
		fire("PermissionRequest", "b", { tool_name: "Edit" });
		advance(SECOND);
		fire("PermissionRequest", "c", { tool_name: "Write" });
		advance(SECOND);
		fire("PostToolUse", "c");
		const result = store.pendingPermission();
		expect(result?.session.id).toBe("b");
		expect(result?.others).toBe(1);
	});

	it("counts waiting question sessions as others", () => {
		fire("Elicitation", "q", { message: "Pick" });
		advance(SECOND);
		fire("PermissionRequest", "p", { tool_name: "Bash" });
		const result = store.pendingPermission();
		expect(result?.session.id).toBe("p");
		expect(result?.others).toBe(1);
	});

	it("does not count working or idle sessions as others", () => {
		fire("UserPromptSubmit", "w");
		fire("SessionStart", "i");
		fire("PermissionRequest", "p", { tool_name: "Bash" });
		expect(store.pendingPermission()?.others).toBe(0);
	});

	it("prefers the newest wait even when an older session had later activity", () => {
		fire("PermissionRequest", "old", { tool_name: "Bash" });
		advance(SECOND);
		fire("PermissionRequest", "new", { tool_name: "Edit" });
		advance(SECOND);
		fire("Notification", "old", { notification_type: "permission_prompt" });
		expect(store.pendingPermission()?.session.id).toBe("new");
	});
});

describe("SessionStore.lastEvent", () => {
	it("is undefined before any event", () => {
		expect(store.lastEvent()).toBeUndefined();
	});

	it("tracks the time of the most recent event", () => {
		fire("SessionStart");
		expect(store.lastEvent()).toBe(Date.now());
		advance(7 * SECOND);
		fire("UserPromptSubmit");
		expect(store.lastEvent()).toBe(Date.now());
	});

	it("is updated by SessionEnd", () => {
		fire("SessionStart");
		advance(SECOND);
		fire("SessionEnd");
		expect(store.lastEvent()).toBe(Date.now());
	});

	it("is not updated by events without a session id or name", () => {
		store.handle({ hook_event_name: "Stop" });
		store.handle({ session_id: "s1" });
		expect(store.lastEvent()).toBeUndefined();
	});
});

describe("detail event", () => {
	it("fires when a session first appears", () => {
		fire("SessionStart");
		expect(details).toBe(1);
	});

	it("does not fire for an event that changes nothing shown", () => {
		fire("UserPromptSubmit");
		const before = details;
		fire("UserPromptSubmit");
		fire("PostToolUse");
		expect(details).toBe(before);
	});

	it("fires when the current tool changes", () => {
		fire("PreToolUse", "s1", { tool_name: "Bash" });
		const before = details;
		fire("PreToolUse", "s1", { tool_name: "Read" });
		expect(details).toBe(before + 1);
	});

	it("does not fire when the same tool is reported again", () => {
		fire("PreToolUse", "s1", { tool_name: "Bash" });
		const before = details;
		fire("PreToolUse", "s1", { tool_name: "Bash" });
		expect(details).toBe(before);
	});

	it("fires when the permission mode changes", () => {
		fire("UserPromptSubmit", "s1", { permission_mode: "default" });
		const before = details;
		fire("UserPromptSubmit", "s1", { permission_mode: "plan" });
		expect(details).toBe(before + 1);
	});

	it("fires when the project changes", () => {
		fire("SessionStart", "s1", { cwd: "/a/one" });
		const before = details;
		fire("SessionStart", "s1", { cwd: "/a/two" });
		expect(details).toBe(before + 1);
	});

	it("fires when the pending request appears and when it clears", () => {
		fire("UserPromptSubmit");
		const before = details;
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
		expect(details).toBe(before + 1);
		fire("PostToolUse");
		expect(details).toBe(before + 2);
	});

	it("fires when the pending detail changes within the same state", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
		const before = details;
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "pwd" } });
		expect(details).toBe(before + 1);
	});

	it("fires when a session ends", () => {
		fire("SessionStart");
		const before = details;
		fire("SessionEnd");
		expect(details).toBe(before + 1);
	});

	it("fires when the sweep expires a session", () => {
		store.start();
		fire("SessionStart");
		const before = details;
		vi.advanceTimersByTime(EXPIRY + MINUTE);
		expect(details).toBeGreaterThan(before);
		expect(store.sessions()).toEqual([]);
	});

	it("does not fire change when only per-session details change", () => {
		fire("UserPromptSubmit", "s1", { permission_mode: "default" });
		const changeCount = changes.length;
		const detailCount = details;
		fire("PreToolUse", "s1", { tool_name: "Bash", permission_mode: "plan" });
		fire("PreToolUse", "s1", { tool_name: "Read" });
		expect(changes).toHaveLength(changeCount);
		expect(details).toBe(detailCount + 2);
	});

	it("still fires change when the summary changes", () => {
		fire("UserPromptSubmit");
		const changeCount = changes.length;
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(changes).toHaveLength(changeCount + 1);
		expect(changes[changes.length - 1]?.overall).toBe("done");
	});
});
