import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertConfig } from "../../src/alerts/config";
import { AlertManager, type Alert } from "../../src/alerts/manager";
import { SessionStore, type HookEvent } from "../../src/state/sessions";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

let store: SessionStore;
let config: AlertConfig;
let alerts: Alert[];
let manager: AlertManager;

function fire(name: string, session = "s1", extra: Partial<HookEvent> = {}): void {
	store.handle({ hook_event_name: name, session_id: session, ...extra });
}

function advance(ms: number): number {
	vi.setSystemTime(Date.now() + ms);
	return Date.now();
}

function waitForPermission(session = "s1", cwd = "/work/demo"): void {
	fire("PermissionRequest", session, { tool_name: "Bash", tool_input: { command: "npm test" }, cwd });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	store = new SessionStore();
	config = new AlertConfig();
	alerts = [];
	manager = new AlertManager(store, config, (alert) => alerts.push(alert));
});

afterEach(() => {
	manager.stop();
	store.stop();
	vi.useRealTimers();
});

describe("alert when a session starts waiting", () => {
	it("raises one alert with sound and toast flags", () => {
		waitForPermission();
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ title: "Claude needs you", sound: true, toast: true });
	});

	it("describes a permission wait with project, tool, and detail", () => {
		waitForPermission();
		expect(alerts[0]?.body).toBe("demo - Bash: npm test");
	});

	it("omits the detail when the request has none", () => {
		fire("PermissionRequest", "s1", { tool_name: "Bash", cwd: "/w/p" });
		expect(alerts[0]?.body).toBe("p - Bash");
	});

	it("uses only the project when a permission request has no tool or detail", () => {
		fire("PermissionRequest", "s1", { cwd: "/w/p" });
		expect(alerts[0]?.body).toBe("p");
	});

	it("uses the message detail for a notification without a tool", () => {
		fire("Notification", "s1", { notification_type: "permission_prompt", message: "Needs approval", cwd: "/w/p" });
		expect(alerts[0]?.body).toBe("p - Needs approval");
	});

	it("includes the question text for a Stop with a question", () => {
		fire("Stop", "s1", { last_assistant_message: "Work done.\n\nShall I deploy?", cwd: "/w/p" });
		expect(alerts[0]?.body).toBe("p - Shall I deploy?");
	});

	it("includes the question text for an Elicitation", () => {
		fire("Elicitation", "s1", { message: "Choose a branch", cwd: "/w/p" });
		expect(alerts[0]?.body).toBe("p - Choose a branch");
	});

	it("uses a generic name when the project is unknown", () => {
		fire("Elicitation", "s1", { message: "Hi" });
		expect(alerts[0]?.body).toBe("a session - Hi");
		alerts.length = 0;
		fire("Elicitation", "s2", {});
		expect(alerts[0]?.body).toBe("a session");
	});

	it("does not alert for working or idle sessions", () => {
		fire("UserPromptSubmit");
		fire("PreToolUse", "s1", { tool_name: "Bash" });
		fire("SessionStart", "s2");
		expect(alerts).toHaveLength(0);
	});
});

describe("repeat alerts", () => {
	it("does not repeat before the escalation interval", () => {
		waitForPermission();
		manager.check(advance(3 * MINUTE - 1));
		expect(alerts).toHaveLength(1);
	});

	it("does not repeat on unrelated session detail events", () => {
		waitForPermission();
		advance(MINUTE);
		fire("PreToolUse", "s2", { tool_name: "Read" });
		expect(alerts).toHaveLength(1);
	});

	it("repeats exactly when the interval elapses", () => {
		waitForPermission();
		manager.check(advance(3 * MINUTE));
		expect(alerts).toHaveLength(2);
		expect(alerts[1]?.title).toBe("Claude is still waiting (3m)");
		expect(alerts[1]?.body).toBe("demo - Bash: npm test");
	});

	it("repeats again after another full interval and not before", () => {
		waitForPermission();
		manager.check(advance(3 * MINUTE));
		manager.check(advance(3 * MINUTE - 1));
		expect(alerts).toHaveLength(2);
		manager.check(advance(1));
		expect(alerts).toHaveLength(3);
		expect(alerts[2]?.title).toBe("Claude is still waiting (6m)");
	});

	it("shows the minutes waited, rounded, in the title", () => {
		config.set({ escalateMinutes: 1 });
		waitForPermission();
		manager.check(advance(90 * SECOND));
		expect(alerts[1]?.title).toBe("Claude is still waiting (2m)");
	});

	it("honours a changed escalation interval", () => {
		waitForPermission();
		config.set({ escalateMinutes: 10 });
		manager.check(advance(5 * MINUTE));
		expect(alerts).toHaveLength(1);
		manager.check(advance(5 * MINUTE));
		expect(alerts).toHaveLength(2);
	});

	it("never repeats when escalateMinutes is 0", () => {
		config.set({ escalateMinutes: 0 });
		waitForPermission();
		manager.check(advance(100 * MINUTE));
		manager.check(advance(100 * MINUTE));
		expect(alerts).toHaveLength(1);
	});

	it("alerts again when the session leaves attention and waits again", () => {
		waitForPermission();
		fire("PostToolUse");
		advance(SECOND);
		waitForPermission();
		expect(alerts).toHaveLength(2);
		expect(alerts[1]?.title).toBe("Claude needs you");
	});

	it("restarts the interval for a new wait", () => {
		waitForPermission();
		advance(2 * MINUTE);
		fire("PostToolUse");
		advance(SECOND);
		waitForPermission();
		manager.check(advance(2 * MINUTE));
		expect(alerts).toHaveLength(2);
		manager.check(advance(MINUTE));
		expect(alerts).toHaveLength(3);
		expect(alerts[2]?.title).toContain("still waiting");
	});
});

describe("finished alert", () => {
	it("is not raised by default", () => {
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(alerts).toHaveLength(0);
	});

	it("is raised on a working to done transition when onDone is true", () => {
		config.set({ alertOnDone: true });
		fire("UserPromptSubmit", "s1", { cwd: "/w/p" });
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ title: "Claude finished", body: "p", sound: true, toast: true });
	});

	it("uses a generic name without a project", () => {
		config.set({ alertOnDone: true });
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(alerts[0]?.body).toBe("a session");
	});

	it("is not raised again while the session stays done", () => {
		config.set({ alertOnDone: true });
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Done." });
		manager.check(advance(MINUTE));
		manager.check(advance(MINUTE));
		expect(alerts).toHaveLength(1);
	});

	it("is not raised when the session was not working before", () => {
		config.set({ alertOnDone: true });
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(alerts).toHaveLength(0);
	});

	it("is not raised for a Stop that asks a question", () => {
		config.set({ alertOnDone: true });
		fire("UserPromptSubmit");
		fire("Stop", "s1", { last_assistant_message: "Proceed?" });
		expect(alerts.map((a) => a.title)).toEqual(["Claude needs you"]);
	});

	it("is raised on each new working to done transition", () => {
		config.set({ alertOnDone: true });
		for (let i = 0; i < 2; i++) {
			fire("UserPromptSubmit");
			fire("Stop", "s1", { last_assistant_message: "Done." });
		}
		expect(alerts.filter((a) => a.title === "Claude finished")).toHaveLength(2);
	});
});

describe("sound and toast flags", () => {
	it("passes the configured flags", () => {
		config.set({ alertSound: false });
		waitForPermission();
		expect(alerts[0]).toMatchObject({ sound: false, toast: true });
	});

	it("raises nothing when both are disabled", () => {
		config.set({ alertSound: false, alertToast: false, alertOnDone: true });
		waitForPermission("a");
		fire("UserPromptSubmit", "b");
		fire("Stop", "b", { last_assistant_message: "Done." });
		manager.check(advance(10 * MINUTE));
		expect(alerts).toHaveLength(0);
	});

	it("keeps tracking the wait while disabled, so enabling later does not raise an initial alert", () => {
		config.set({ alertSound: false, alertToast: false });
		waitForPermission();
		config.set({});
		manager.check(advance(MINUTE));
		expect(alerts).toHaveLength(0);
		manager.check(advance(2 * MINUTE));
		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.title).toContain("still waiting");
	});
});

describe("multiple sessions", () => {
	it("alerts once per waiting session", () => {
		waitForPermission("a", "/w/one");
		waitForPermission("b", "/w/two");
		expect(alerts.map((a) => a.body)).toEqual(["one - Bash: npm test", "two - Bash: npm test"]);
	});

	it("escalates each session on its own schedule", () => {
		waitForPermission("a", "/w/one");
		advance(2 * MINUTE);
		waitForPermission("b", "/w/two");
		manager.check(advance(MINUTE));
		expect(alerts).toHaveLength(3);
		expect(alerts[2]?.body).toContain("one");
		manager.check(advance(2 * MINUTE));
		expect(alerts).toHaveLength(4);
		expect(alerts[3]?.body).toContain("two");
	});

	it("keeps waiting state for one session when another leaves attention", () => {
		waitForPermission("a");
		waitForPermission("b");
		fire("PostToolUse", "b");
		manager.check(advance(3 * MINUTE));
		expect(alerts.filter((a) => a.title.includes("still waiting"))).toHaveLength(1);
	});
});

describe("sessions that disappear", () => {
	it("forgets a waiting session that ended so a new session with the same id alerts again", () => {
		waitForPermission();
		fire("SessionEnd");
		waitForPermission();
		expect(alerts).toHaveLength(2);
		expect(alerts[1]?.title).toBe("Claude needs you");
	});

	it("forgets the previous state of a removed session", () => {
		config.set({ alertOnDone: true });
		fire("UserPromptSubmit");
		fire("SessionEnd");
		fire("Stop", "s1", { last_assistant_message: "Done." });
		expect(alerts).toHaveLength(0);
	});

	it("forgets a session that expired", () => {
		store.start();
		manager.start();
		waitForPermission();
		vi.advanceTimersByTime(121 * MINUTE);
		expect(alerts.filter((a) => a.title === "Claude needs you")).toHaveLength(1);
		alerts.length = 0;
		waitForPermission();
		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.title).toBe("Claude needs you");
	});
});

describe("start and stop", () => {
	it("checks for escalation every 15 seconds while started", () => {
		manager.start();
		waitForPermission();
		vi.advanceTimersByTime(3 * MINUTE - SECOND);
		expect(alerts).toHaveLength(1);
		vi.advanceTimersByTime(15 * SECOND);
		expect(alerts).toHaveLength(2);
		expect(alerts[1]?.title).toContain("still waiting");
	});

	it("does not check on a timer before start", () => {
		waitForPermission();
		vi.advanceTimersByTime(10 * MINUTE);
		expect(alerts).toHaveLength(1);
	});

	it("stops checking after stop", () => {
		manager.start();
		waitForPermission();
		manager.stop();
		vi.advanceTimersByTime(10 * MINUTE);
		expect(alerts).toHaveLength(1);
	});

	it("does not run duplicate timers when started twice", () => {
		manager.start();
		manager.start();
		waitForPermission();
		vi.advanceTimersByTime(3 * MINUTE);
		expect(alerts).toHaveLength(2);
	});

	it("can be restarted after stop", () => {
		manager.start();
		manager.stop();
		manager.start();
		waitForPermission();
		vi.advanceTimersByTime(3 * MINUTE);
		expect(alerts).toHaveLength(2);
	});
});
