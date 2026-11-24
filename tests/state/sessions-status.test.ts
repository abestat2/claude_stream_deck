import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type HookEvent } from "../../src/state/sessions";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const WORKING_STALE = 10 * MINUTE;

let store: SessionStore;
let details: number;
let changes: number;
let statuses: unknown[];

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

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		session_id: "s1",
		model: { id: "claude-opus-4", display_name: "Opus 4" },
		context_window: { used_percentage: 42.4, total_input_tokens: 84_800, context_window_size: 200_000 },
		effort: { level: "high" },
		workspace: { current_dir: "C:\\code\\demo" },
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	store = new SessionStore();
	details = 0;
	changes = 0;
	statuses = [];
	store.on("detail", () => details++);
	store.on("change", () => changes++);
	store.on("status", (data: unknown) => statuses.push(data));
});

afterEach(() => {
	store.stop();
	vi.useRealTimers();
});

describe("SessionStore.handleStatus", () => {
	it("records the model, context window use, effort, and project", () => {
		store.handleStatus(payload());
		expect(info()).toMatchObject({
			project: "demo",
			model: { id: "claude-opus-4", name: "Opus 4" },
			contextPercent: 42.4,
			contextTokens: 84_800,
			contextSize: 200_000,
			effort: "high",
		});
	});

	it("creates an idle session for an unknown id", () => {
		store.handleStatus(payload({ session_id: "new" }));
		expect(info("new").state).toBe("idle");
		expect(store.summary()).toMatchObject({ sessions: 1, idle: 1, overall: "idle" });
	});

	it("uses an empty model id when the payload has none", () => {
		store.handleStatus(payload({ model: { display_name: "Opus 4" } }));
		expect(info().model).toEqual({ id: "", name: "Opus 4" });
	});

	it("ignores a model without a display name and keeps the earlier one", () => {
		store.handleStatus(payload());
		store.handleStatus(payload({ model: { id: "claude-sonnet" } }));
		expect(info().model).toEqual({ id: "claude-opus-4", name: "Opus 4" });
		store.handleStatus(payload({ model: { id: "x", display_name: "" } }));
		expect(info().model?.name).toBe("Opus 4");
	});

	it("replaces the model when a new display name arrives", () => {
		store.handleStatus(payload());
		store.handleStatus(payload({ model: { id: "claude-sonnet", display_name: "Sonnet 4" } }));
		expect(info().model).toEqual({ id: "claude-sonnet", name: "Sonnet 4" });
	});

	it("leaves tokens and size undefined when only the percentage is reported", () => {
		store.handleStatus(payload({ context_window: { used_percentage: 10 } }));
		expect(info()).toMatchObject({ contextPercent: 10, contextTokens: undefined, contextSize: undefined });
	});

	it("keeps a zero percentage", () => {
		store.handleStatus(payload({ context_window: { used_percentage: 0 } }));
		expect(info().contextPercent).toBe(0);
	});

	it("keeps the earlier context reading when the payload has no numeric percentage", () => {
		store.handleStatus(payload());
		store.handleStatus(payload({ context_window: { used_percentage: null } }));
		expect(info().contextPercent).toBe(42.4);
		store.handleStatus(payload({ context_window: undefined }));
		expect(info().contextPercent).toBe(42.4);
	});

	it("ignores non-numeric token fields", () => {
		store.handleStatus(payload({ context_window: { used_percentage: 5, total_input_tokens: "9", context_window_size: null } }));
		expect(info()).toMatchObject({ contextPercent: 5, contextTokens: undefined, contextSize: undefined });
	});

	it("sets the effort level and clears it when it disappears", () => {
		store.handleStatus(payload());
		expect(info().effort).toBe("high");
		store.handleStatus(payload({ effort: undefined }));
		expect(info().effort).toBeUndefined();
	});

	it("clears the effort when the level is not a string", () => {
		store.handleStatus(payload());
		store.handleStatus(payload({ effort: { level: 3 } }));
		expect(info().effort).toBeUndefined();
	});

	it("takes the project from workspace.current_dir", () => {
		store.handleStatus(payload({ workspace: { current_dir: "/home/me/proj" } }));
		expect(info().project).toBe("proj");
	});

	it("takes the project from cwd when there is no workspace directory", () => {
		store.handleStatus(payload({ workspace: undefined, cwd: "C:\\code\\fallback" }));
		expect(info().project).toBe("fallback");
	});

	it("prefers the workspace directory over cwd", () => {
		store.handleStatus(payload({ cwd: "C:\\code\\other" }));
		expect(info().project).toBe("demo");
	});

	it("leaves the project empty when no directory is reported", () => {
		store.handleStatus(payload({ workspace: undefined }));
		expect(info().project).toBe("");
	});

	it("does not overwrite a project that is already known", () => {
		fire("SessionStart", "s1", { cwd: "C:\\code\\fromhook" });
		store.handleStatus(payload());
		expect(info().project).toBe("fromhook");
	});

	it.each([undefined, null, 5, "text", true, []])("ignores a non-object payload %j", (value) => {
		store.handleStatus(value);
		expect(store.sessions()).toEqual([]);
		expect(statuses).toEqual([]);
		expect(store.lastStatus()).toBeUndefined();
	});

	it.each([undefined, null, 7, ["s1"], ""])("ignores a payload whose session_id is %j", (id) => {
		store.handleStatus(payload({ session_id: id }));
		expect(store.sessions()).toEqual([]);
		expect(statuses).toEqual([]);
		expect(store.lastStatus()).toBeUndefined();
	});

	it("emits status with the raw payload", () => {
		const data = payload({ rate_limits: { five_hour: { used_percentage: 3 } } });
		store.handleStatus(data);
		expect(statuses).toHaveLength(1);
		expect(statuses[0]).toBe(data);
	});

	it("emits status on every update, even when nothing displayed changes", () => {
		store.handleStatus(payload());
		store.handleStatus(payload());
		expect(statuses).toHaveLength(2);
	});

	it("does not update lastEvent", () => {
		store.handleStatus(payload());
		expect(store.lastEvent()).toBeUndefined();
	});

	it("handles a payload with unusual field types without throwing", () => {
		expect(() => store.handleStatus({ session_id: "s1", model: "Opus", context_window: 5, effort: "high", workspace: "x" })).not.toThrow();
		expect(info()).toMatchObject({ model: undefined, contextPercent: undefined, effort: undefined, project: "" });
	});
});

describe("SessionStore.handleStatus staleness", () => {
	it("does not refresh lastSeen of an existing session", () => {
		fire("SessionStart");
		const seen = info().lastSeen;
		advance(MINUTE);
		store.handleStatus(payload());
		expect(info().lastSeen).toBe(seen);
	});

	it("does not keep a working session from going stale", () => {
		fire("UserPromptSubmit");
		for (let i = 0; i < 12; i++) {
			advance(MINUTE);
			store.handleStatus(payload());
		}
		expect(Date.now() - info().lastSeen).toBeGreaterThan(WORKING_STALE);
		expect(info().state).toBe("idle");
	});

	it("keeps a working session working until the stale limit", () => {
		fire("UserPromptSubmit");
		advance(WORKING_STALE);
		store.handleStatus(payload());
		expect(info().state).toBe("working");
		advance(1);
		expect(info().state).toBe("idle");
	});

	it("does not change the state of a session", () => {
		fire("UserPromptSubmit");
		store.handleStatus(payload());
		expect(info().state).toBe("working");
		fire("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
		store.handleStatus(payload());
		expect(info()).toMatchObject({ state: "attention", pending: { kind: "permission", tool: "Bash" } });
	});

	it("does not reorder sessions by recent activity", () => {
		fire("SessionStart", "a");
		advance(SECOND);
		fire("SessionStart", "b");
		advance(SECOND);
		store.handleStatus(payload({ session_id: "a" }));
		expect(store.sessions().map((s) => s.id)).toEqual(["b", "a"]);
	});

	it("gives a session created by a status update the time of the update", () => {
		advance(5 * SECOND);
		store.handleStatus(payload());
		expect(info().lastSeen).toBe(Date.now());
	});
});

describe("SessionStore.handleStatus detail events", () => {
	it("emits detail when the model first appears", () => {
		fire("SessionStart");
		details = 0;
		store.handleStatus(payload({ context_window: undefined, effort: undefined }));
		expect(details).toBe(1);
	});

	it("emits detail when the model changes", () => {
		store.handleStatus(payload());
		details = 0;
		store.handleStatus(payload({ model: { id: "x", display_name: "Sonnet 4" } }));
		expect(details).toBe(1);
	});

	it("emits detail when the effort changes or disappears", () => {
		store.handleStatus(payload());
		details = 0;
		store.handleStatus(payload({ effort: { level: "low" } }));
		expect(details).toBe(1);
		store.handleStatus(payload({ effort: undefined }));
		expect(details).toBe(2);
	});

	it("emits detail when the rounded context percentage changes", () => {
		store.handleStatus(payload({ context_window: { used_percentage: 42.4 } }));
		details = 0;
		store.handleStatus(payload({ context_window: { used_percentage: 43.2 } }));
		expect(details).toBe(1);
	});

	it("does not emit detail when the context percentage changes within the same rounded value", () => {
		store.handleStatus(payload({ context_window: { used_percentage: 42.1 } }));
		details = 0;
		store.handleStatus(payload({ context_window: { used_percentage: 42.4 } }));
		expect(details).toBe(0);
	});

	it("does not emit detail when tokens change but the rounded percentage does not", () => {
		store.handleStatus(payload());
		details = 0;
		store.handleStatus(payload({ context_window: { used_percentage: 42.4, total_input_tokens: 85_000, context_window_size: 200_000 } }));
		expect(details).toBe(0);
	});

	it("does not emit detail for an identical update", () => {
		store.handleStatus(payload());
		details = 0;
		store.handleStatus(payload());
		expect(details).toBe(0);
	});

	it("does not emit change for an update that leaves the summary unchanged", () => {
		store.handleStatus(payload());
		changes = 0;
		store.handleStatus(payload({ model: { id: "x", display_name: "Sonnet 4" } }));
		expect(changes).toBe(0);
	});

	it("emits change when an update creates a session", () => {
		store.handleStatus(payload());
		expect(changes).toBe(1);
	});
});

describe("SessionStore.latestContext", () => {
	it("returns undefined when no session has reported context use", () => {
		expect(store.latestContext()).toBeUndefined();
		fire("SessionStart");
		store.handleStatus(payload({ context_window: undefined }));
		expect(store.latestContext()).toBeUndefined();
	});

	it("returns the session that reported context use", () => {
		store.handleStatus(payload());
		expect(store.latestContext()?.id).toBe("s1");
	});

	it("returns the most recently active session that has a reading", () => {
		store.handleStatus(payload({ session_id: "a" }));
		advance(SECOND);
		store.handleStatus(payload({ session_id: "b" }));
		advance(SECOND);
		fire("UserPromptSubmit", "c");
		expect(store.latestContext()?.id).toBe("b");
		advance(SECOND);
		fire("UserPromptSubmit", "a");
		expect(store.latestContext()?.id).toBe("a");
	});

	it("accepts a reading of zero percent", () => {
		store.handleStatus(payload({ context_window: { used_percentage: 0 } }));
		expect(store.latestContext()?.contextPercent).toBe(0);
	});

	it("stops returning a session that has ended", () => {
		store.handleStatus(payload());
		fire("SessionEnd");
		expect(store.latestContext()).toBeUndefined();
	});
});

describe("SessionStore.lastStatus", () => {
	it("is undefined before any status update", () => {
		expect(store.lastStatus()).toBeUndefined();
		fire("SessionStart");
		expect(store.lastStatus()).toBeUndefined();
	});

	it("is the time of the latest accepted update", () => {
		store.handleStatus(payload());
		expect(store.lastStatus()).toBe(Date.now());
		advance(5 * SECOND);
		store.handleStatus(payload());
		expect(store.lastStatus()).toBe(Date.now());
	});

	it("is not changed by hook events", () => {
		store.handleStatus(payload());
		const at = store.lastStatus();
		advance(SECOND);
		fire("UserPromptSubmit");
		expect(store.lastStatus()).toBe(at);
	});

	it("is not changed by rejected payloads", () => {
		store.handleStatus(payload());
		const at = store.lastStatus();
		advance(SECOND);
		store.handleStatus({ nothing: true });
		expect(store.lastStatus()).toBe(at);
	});
});

describe("SessionStore.handle with status data", () => {
	it("keeps status data across hook events", () => {
		store.handleStatus(payload());
		fire("UserPromptSubmit");
		fire("Stop");
		expect(info()).toMatchObject({ model: { name: "Opus 4" }, contextPercent: 42.4, effort: "high" });
	});

	it("drops status data when the session ends", () => {
		store.handleStatus(payload());
		fire("SessionEnd");
		expect(store.sessions()).toEqual([]);
	});

	it("reports undefined status fields for a session that never had a status update", () => {
		fire("SessionStart");
		expect(info()).toMatchObject({ model: undefined, contextPercent: undefined, contextTokens: undefined, contextSize: undefined, effort: undefined });
	});
});
