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

import { PermissionMode } from "../../src/actions/permission-mode";
import { parseSequence } from "../../src/input/sequence";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, textElements } from "../helpers/svg";

type FakeKey = {
	id: string;
	isKey: () => boolean;
	setImage: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
};

function key(id = "k1"): FakeKey {
	return { id, isKey: () => true, setImage: vi.fn(), showAlert: vi.fn().mockResolvedValue(undefined) };
}

describe("PermissionMode", () => {
	let store: SessionStore;
	let handler: PermissionMode;
	let k: FakeKey;

	const event = (session: string, mode?: string, cwd = "C:\\code\\demo", name = "UserPromptSubmit") =>
		store.handle({ hook_event_name: name, session_id: session, permission_mode: mode, cwd });
	const press = () => handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
	const texts = () => textElements(decodeDataUri(String(k.setImage.mock.calls.at(-1)?.[0])));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		hoisted.send.mockReset().mockResolvedValue(undefined);
		hoisted.error.mockReset();
		store = new SessionStore();
		k = key();
		hoisted.instances.length = 0;
		hoisted.instances.push(k);
		handler = new PermissionMode(store);
	});

	afterEach(() => {
		store.stop();
		vi.useRealTimers();
	});

	it("draws dashes when no session has reported a mode", () => {
		handler.onWillAppear({ action: k } as never);
		expect(texts()).toEqual(["MODE", "--"]);
	});

	it("draws the mode and project of the most recently active session that reported a mode", () => {
		event("a", "plan", "C:\\code\\alpha");
		vi.advanceTimersByTime(10);
		event("b", "acceptEdits", "C:\\code\\beta");
		vi.advanceTimersByTime(10);
		event("c", undefined, "C:\\code\\gamma");
		handler.onWillAppear({ action: k } as never);
		expect(texts()).toEqual(["MODE", "Accept", "edits", "beta"]);
	});

	it("follows the session that was active last", () => {
		event("a", "plan", "C:\\code\\alpha");
		vi.advanceTimersByTime(10);
		event("b", "auto", "C:\\code\\beta");
		vi.advanceTimersByTime(10);
		event("a", "plan", "C:\\code\\alpha");
		handler.onWillAppear({ action: k } as never);
		expect(texts()).toEqual(["MODE", "Plan", "alpha"]);
	});

	it("redraws when a hook event changes the mode", () => {
		handler.onWillAppear({ action: k } as never);
		event("a", "plan");
		expect(texts()).toEqual(["MODE", "Plan", "demo"]);
		event("a", "bypassPermissions");
		expect(texts()).toEqual(["MODE", "Bypass", "demo"]);
	});

	it("draws with setImage and an SVG data URI", () => {
		handler.onWillAppear({ action: k } as never);
		expect(String(k.setImage.mock.calls.at(-1)?.[0]).startsWith("data:image/svg+xml;base64,")).toBe(true);
	});

	it("sends Shift+Tab without Enter", async () => {
		await press();
		expect(hoisted.send).toHaveBeenCalledTimes(1);
		expect(hoisted.send).toHaveBeenCalledWith(parseSequence("{Shift+Tab}", false));
		expect(hoisted.send).toHaveBeenCalledWith([{ type: "key", vk: 0x09, extended: false, modifiers: [0x10] }]);
		expect(k.showAlert).not.toHaveBeenCalled();
	});

	it("marks the display stale after a press", async () => {
		event("a", "plan");
		handler.onWillAppear({ action: k } as never);
		vi.advanceTimersByTime(10);
		await press();
		expect(texts()).toEqual(["MODE", "Plan", "updates next msg"]);
	});

	it("marks the display stale when no hook event has ever arrived", async () => {
		await press();
		expect(texts()).toContain("updates next msg");
	});

	it("keeps the stale mark through status line updates, which are not hook events", async () => {
		event("a", "plan");
		handler.onWillAppear({ action: k } as never);
		vi.advanceTimersByTime(10);
		await press();
		vi.advanceTimersByTime(10);
		store.handleStatus({ session_id: "a", model: { id: "m", display_name: "Opus" } });
		expect(texts()).toContain("updates next msg");
	});

	it("clears the stale mark when a newer hook event arrives", async () => {
		event("a", "plan");
		handler.onWillAppear({ action: k } as never);
		vi.advanceTimersByTime(10);
		await press();
		vi.advanceTimersByTime(10);
		event("a", "acceptEdits");
		expect(texts()).toEqual(["MODE", "Accept", "edits", "demo"]);
	});

	it("clears the stale mark for a hook event in the same millisecond as the press", async () => {
		event("a", "plan");
		handler.onWillAppear({ action: k } as never);
		await press();
		event("a", "acceptEdits");
		expect(texts()).toEqual(["MODE", "Accept", "edits", "demo"]);
	});

	it("logs a keyboard failure, shows an alert, and does not mark the display stale", async () => {
		event("a", "plan");
		handler.onWillAppear({ action: k } as never);
		hoisted.send.mockRejectedValueOnce(new Error("no helper"));
		await press();
		expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining("no helper"));
		expect(k.showAlert).toHaveBeenCalledTimes(1);
		expect(texts()).toEqual(["MODE", "Plan", "demo"]);
	});

	it("does not draw instances that are not keys", () => {
		const dial = { ...key("d1"), isKey: () => false };
		hoisted.instances.push(dial);
		handler.onWillAppear({ action: dial } as never);
		expect(dial.setImage).not.toHaveBeenCalled();
	});
});
