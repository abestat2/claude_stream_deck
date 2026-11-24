import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	instances: [] as unknown[],
	send: vi.fn(),
	error: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {
		get actions(): unknown[] {
			return hoisted.instances;
		}
	}
	return {
		default: { logger: { error: hoisted.error } },
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

vi.mock("../../src/input/keyboard", () => ({
	keyboard: { send: hoisted.send, start: vi.fn() },
}));

import { Sessions } from "../../src/actions/sessions";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, textElements } from "../helpers/svg";

type FakeInstance = {
	id: string;
	isKey: () => boolean;
	isDial: () => boolean;
	setImage: ReturnType<typeof vi.fn>;
	setFeedback: ReturnType<typeof vi.fn>;
};

function instance(kind: "key" | "dial", id: string): FakeInstance {
	return {
		id,
		isKey: () => kind === "key",
		isDial: () => kind === "dial",
		setImage: vi.fn(),
		setFeedback: vi.fn(),
	};
}

describe("Sessions", () => {
	let store: SessionStore;
	let handler: Sessions;
	let d: FakeInstance;

	const hook = (name: string, session: string, extra: Record<string, unknown> = {}) =>
		store.handle({ hook_event_name: name, session_id: session, ...extra });
	const open = (session: string, project: string) => hook("SessionStart", session, { cwd: `C:\\work\\${project}` });
	const canvas = (target: FakeInstance = d) => decodeDataUri(String(target.setFeedback.mock.calls.at(-1)?.[0].canvas));
	const texts = (target: FakeInstance = d) => textElements(canvas(target));
	const rotate = (ticks: number, target: FakeInstance = d) =>
		handler.onDialRotate({ action: target, payload: { ticks } } as never);
	const project = (target: FakeInstance = d) => texts(target)[2];

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		hoisted.send.mockReset();
		store = new SessionStore();
		d = instance("dial", "d1");
		hoisted.instances.length = 0;
		hoisted.instances.push(d);
		handler = new Sessions(store);
	});

	afterEach(() => {
		handler.onWillDisappear({ action: d } as never);
		store.stop();
		vi.useRealTimers();
	});

	describe("ordering and selection", () => {
		it("lists sessions by project name then id regardless of recent activity", () => {
			open("b", "beta");
			open("a2", "alpha");
			open("a1", "alpha");
			handler.onWillAppear({ action: d } as never);
			expect(texts().slice(1, 3)).toEqual(["1 / 3", "alpha"]);
			hook("UserPromptSubmit", "b");
			expect(texts().slice(1, 3)).toEqual(["1 / 3", "alpha"]);
			rotate(1);
			expect(texts().slice(1, 3)).toEqual(["2 / 3", "alpha"]);
			rotate(1);
			expect(texts().slice(1, 3)).toEqual(["3 / 3", "beta"]);
		});

		it("orders ties on project name by session id", () => {
			open("z", "same");
			open("m", "same");
			hook("PreToolUse", "m", { tool_name: "Read" });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("Read");
			rotate(1);
			expect(texts()).toEqual(["SESSIONS", "2 / 2", "same", "idle", "‹", "›"]);
		});

		it("moves by ticks and wraps around in both directions", () => {
			open("a", "alpha");
			open("b", "beta");
			open("c", "gamma");
			handler.onWillAppear({ action: d } as never);
			rotate(-1);
			expect(project()).toBe("gamma");
			rotate(1);
			expect(project()).toBe("alpha");
			rotate(2);
			expect(project()).toBe("gamma");
			rotate(4);
			expect(project()).toBe("alpha");
			rotate(-5);
			expect(project()).toBe("beta");
		});

		it("does nothing when rotating with no sessions", () => {
			handler.onWillAppear({ action: d } as never);
			d.setFeedback.mockClear();
			rotate(1);
			expect(d.setFeedback).not.toHaveBeenCalled();
		});

		it("shows the no sessions message when there are none", () => {
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toEqual(["SESSIONS", "no sessions", "start Claude Code"]);
		});

		it("remembers the selection by session id when other sessions change", () => {
			open("a", "alpha");
			open("c", "gamma");
			handler.onWillAppear({ action: d } as never);
			rotate(1);
			expect(project()).toBe("gamma");
			open("b", "beta");
			expect(texts().slice(1, 3)).toEqual(["3 / 3", "gamma"]);
			hook("SessionEnd", "a");
			expect(texts().slice(1, 3)).toEqual(["2 / 2", "gamma"]);
		});

		it("keeps a separate selection for each dial instance", () => {
			const e = instance("dial", "d2");
			hoisted.instances.push(e);
			open("a", "alpha");
			open("b", "beta");
			handler.onWillAppear({ action: d } as never);
			handler.onWillAppear({ action: e } as never);
			rotate(1, d);
			expect(project(d)).toBe("beta");
			expect(project(e)).toBe("alpha");
		});

		it("shows the first session when the selected one disappears", () => {
			open("a", "alpha");
			open("b", "beta");
			handler.onWillAppear({ action: d } as never);
			rotate(1);
			expect(project()).toBe("beta");
			hook("SessionEnd", "b");
			expect(texts().slice(1, 3)).toEqual(["1 / 1", "alpha"]);
		});

		it("forgets the selection when the dial disappears", () => {
			open("a", "alpha");
			open("b", "beta");
			handler.onWillAppear({ action: d } as never);
			rotate(1);
			handler.onWillDisappear({ action: d } as never);
			handler.onWillAppear({ action: d } as never);
			expect(project()).toBe("alpha");
		});

		it("does not draw key instances", () => {
			const k = instance("key", "k1");
			hoisted.instances.push(k);
			open("a", "alpha");
			handler.onWillAppear({ action: k } as never);
			expect(k.setFeedback).not.toHaveBeenCalled();
			expect(k.setImage).not.toHaveBeenCalled();
		});
	});

	describe("drawing", () => {
		it("draws through setFeedback with an SVG data URI canvas", () => {
			open("a", "alpha");
			handler.onWillAppear({ action: d } as never);
			expect(Object.keys(d.setFeedback.mock.calls.at(-1)?.[0])).toEqual(["canvas"]);
			expect(String(d.setFeedback.mock.calls.at(-1)?.[0].canvas).startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(d.setImage).not.toHaveBeenCalled();
		});

		it("redraws when session details change", () => {
			open("a", "alpha");
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("idle");
			hook("UserPromptSubmit", "a");
			expect(texts()).toContain("working 0:00");
			hook("PreToolUse", "a", { tool_name: "Grep" });
			expect(texts()).toContain("Grep");
		});

		it("redraws every second while visible and advances the working clock", () => {
			open("a", "alpha");
			hook("UserPromptSubmit", "a");
			handler.onWillAppear({ action: d } as never);
			d.setFeedback.mockClear();
			vi.advanceTimersByTime(1000);
			expect(d.setFeedback).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(64_000);
			expect(d.setFeedback).toHaveBeenCalledTimes(65);
			expect(texts()).toContain("working 1:05");
		});

		it("advances the wait minutes with time", () => {
			open("a", "alpha");
			hook("PermissionRequest", "a", { tool_name: "Bash", tool_input: { command: "ls" } });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("needs you");
			vi.advanceTimersByTime(59_000);
			expect(texts()).toContain("needs you");
			vi.advanceTimersByTime(121_000);
			expect(texts()).toContain("needs you 3m");
		});

		it("stops the timer when the last instance disappears", () => {
			open("a", "alpha");
			handler.onWillAppear({ action: d } as never);
			handler.onWillDisappear({ action: d } as never);
			d.setFeedback.mockClear();
			vi.advanceTimersByTime(5000);
			expect(d.setFeedback).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		});

		it("keeps the timer while another instance is visible", () => {
			const e = instance("dial", "d2");
			hoisted.instances.push(e);
			open("a", "alpha");
			handler.onWillAppear({ action: d } as never);
			handler.onWillAppear({ action: e } as never);
			handler.onWillDisappear({ action: d } as never);
			e.setFeedback.mockClear();
			vi.advanceTimersByTime(1000);
			expect(e.setFeedback).toHaveBeenCalledTimes(1);
			handler.onWillDisappear({ action: e } as never);
			expect(vi.getTimerCount()).toBe(0);
		});

		it("restarts the timer when an instance appears again", () => {
			handler.onWillAppear({ action: d } as never);
			handler.onWillDisappear({ action: d } as never);
			handler.onWillAppear({ action: d } as never);
			d.setFeedback.mockClear();
			vi.advanceTimersByTime(1000);
			expect(d.setFeedback).toHaveBeenCalledTimes(1);
		});
	});

	describe("view fields", () => {
		it("shows the project, tool, and model of a working session", () => {
			open("a", "alpha");
			store.handleStatus({ session_id: "a", model: { id: "claude-opus", display_name: "Opus" } });
			hook("UserPromptSubmit", "a");
			hook("PreToolUse", "a", { tool_name: "Edit" });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toEqual(["SESSIONS", "1 / 1", "alpha", "working 0:00", "Edit"]);
		});

		it("shows the model for a session that is not working", () => {
			open("a", "alpha");
			store.handleStatus({ session_id: "a", model: { id: "claude-opus", display_name: "Opus" } });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toEqual(["SESSIONS", "1 / 1", "alpha", "idle", "Opus"]);
		});

		it("shows the agent count", () => {
			open("a", "alpha");
			hook("UserPromptSubmit", "a");
			hook("SubagentStart", "a", { agent_id: "x" });
			hook("SubagentStart", "a", { agent_id: "y" });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("working 0:00 +2 agents");
		});

		it("shows the request as tool and detail", () => {
			open("a", "alpha");
			hook("PermissionRequest", "a", { tool_name: "Bash", tool_input: { command: "npm test" } });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toEqual(["SESSIONS", "1 / 1", "alpha", "needs you", "Bash: npm test"]);
		});

		it("shows only the tool when the request has no detail", () => {
			open("a", "alpha");
			hook("PermissionRequest", "a", { tool_name: "Bash", tool_input: {} });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("Bash");
		});

		it("shows only the detail when the request has no tool", () => {
			open("a", "alpha");
			hook("Elicitation", "a", { message: "Pick one" });
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("Pick one");
		});

		it("clips a long request on the strip", () => {
			open("a", "alpha");
			hook("PermissionRequest", "a", { tool_name: "Bash", tool_input: { command: "x".repeat(100) } });
			handler.onWillAppear({ action: d } as never);
			const detail = texts().at(-1) ?? "";
			expect(detail).toHaveLength(30);
			expect(detail.endsWith("…")).toBe(true);
		});

		it("shows a done session without agents", () => {
			open("a", "alpha");
			hook("UserPromptSubmit", "a");
			hook("Stop", "a");
			handler.onWillAppear({ action: d } as never);
			expect(texts()).toContain("done");
		});

		it("shows an unnamed project when the working directory is unknown", () => {
			hook("UserPromptSubmit", "a");
			handler.onWillAppear({ action: d } as never);
			expect(project()).toBe("unnamed");
		});
	});
});
