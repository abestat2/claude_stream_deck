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

import { Context } from "../../src/actions/context";
import { parseSequence } from "../../src/input/sequence";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, textElements } from "../helpers/svg";

type FakeInstance = {
	id: string;
	isKey: () => boolean;
	isDial: () => boolean;
	setImage: ReturnType<typeof vi.fn>;
	setFeedback: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
};

function instance(kind: "key" | "dial", id: string): FakeInstance {
	return {
		id,
		isKey: () => kind === "key",
		isDial: () => kind === "dial",
		setImage: vi.fn(),
		setFeedback: vi.fn(),
		showAlert: vi.fn().mockResolvedValue(undefined),
	};
}

type Settings = { compact?: boolean };

describe("Context", () => {
	let store: SessionStore;
	let handler: Context;
	let k: FakeInstance;
	let d: FakeInstance;

	const status = (session = "s1", percent = 42) =>
		store.handleStatus({
			session_id: session,
			model: { id: "claude-opus", display_name: "Opus" },
			context_window: { used_percentage: percent, total_input_tokens: 84_000, context_window_size: 200_000 },
		});
	const hook = (name: string, session = "s1") => store.handle({ hook_event_name: name, session_id: session });
	const keyTexts = () => textElements(decodeDataUri(String(k.setImage.mock.calls.at(-1)?.[0])));
	const dialTexts = () => textElements(decodeDataUri(String(d.setFeedback.mock.calls.at(-1)?.[0].canvas)));
	const expectCompact = () => expect(hoisted.send).toHaveBeenCalledWith(parseSequence("/compact", true));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		hoisted.send.mockReset().mockResolvedValue(undefined);
		hoisted.error.mockReset();
		store = new SessionStore();
		k = instance("key", "k1");
		d = instance("dial", "d1");
		hoisted.instances.length = 0;
		hoisted.instances.push(k, d);
		handler = new Context(store);
	});

	afterEach(() => {
		store.stop();
		vi.useRealTimers();
	});

	describe("pressing", () => {
		it("sends /compact followed by Enter when a context reading exists and no session is busy", async () => {
			status();
			await handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
			expect(hoisted.send).toHaveBeenCalledTimes(1);
			expectCompact();
			expect(hoisted.send.mock.calls[0]?.[0].at(-1)).toEqual({ type: "key", vk: 0x0d, extended: false, modifiers: [] });
			expect(k.showAlert).not.toHaveBeenCalled();
		});

		it("sends /compact when sessions are done or idle", async () => {
			status();
			hook("Stop");
			await handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
			expectCompact();
		});

		it("routes a dial press to the same logic", async () => {
			status();
			await handler.onDialDown({ action: d, payload: { settings: {} } } as never);
			expectCompact();
		});

		it("routes a touch tap to the same logic", async () => {
			status();
			await handler.onTouchTap({ action: d, payload: { settings: {} } } as never);
			expectCompact();
		});

		it.each(["key", "dial", "tap"] as const)("refuses a %s press with an alert when there is no context reading", async (via) => {
			const target = via === "key" ? k : d;
			const settings = { settings: {} };
			if (via === "key") await handler.onKeyDown({ action: target, payload: settings } as never);
			else if (via === "dial") await handler.onDialDown({ action: target, payload: settings } as never);
			else await handler.onTouchTap({ action: target, payload: settings } as never);
			expect(target.showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.send).not.toHaveBeenCalled();
		});

		it("refuses when a session with a reading is working", async () => {
			status();
			hook("UserPromptSubmit");
			await handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
			expect(k.showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.send).not.toHaveBeenCalled();
		});

		it("refuses when any other session is working", async () => {
			status("s1");
			hook("UserPromptSubmit", "s2");
			await handler.onDialDown({ action: d, payload: { settings: {} } } as never);
			expect(d.showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.send).not.toHaveBeenCalled();
		});

		it("refuses when a session is waiting on the user", async () => {
			status();
			store.handle({ hook_event_name: "PermissionRequest", session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } });
			await handler.onTouchTap({ action: d, payload: { settings: {} } } as never);
			expect(d.showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.send).not.toHaveBeenCalled();
		});

		it("sends again once the session finishes", async () => {
			status();
			hook("UserPromptSubmit");
			await handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
			hook("Stop");
			await handler.onKeyDown({ action: k, payload: { settings: {} } } as never);
			expect(hoisted.send).toHaveBeenCalledTimes(1);
		});

		it.each(["key", "dial", "tap"] as const)("does nothing for a %s press when compact is false", async (via) => {
			status();
			const target = via === "key" ? k : d;
			const payload = { settings: { compact: false } as Settings };
			if (via === "key") await handler.onKeyDown({ action: target, payload } as never);
			else if (via === "dial") await handler.onDialDown({ action: target, payload } as never);
			else await handler.onTouchTap({ action: target, payload } as never);
			expect(hoisted.send).not.toHaveBeenCalled();
			expect(target.showAlert).not.toHaveBeenCalled();
		});

		it("does nothing when compact is false even without a reading", async () => {
			await handler.onKeyDown({ action: k, payload: { settings: { compact: false } } } as never);
			expect(k.showAlert).not.toHaveBeenCalled();
		});

		it("sends when compact is not set", async () => {
			status();
			await handler.onKeyDown({ action: k, payload: { settings: { compact: undefined } } } as never);
			expectCompact();
		});

		it("logs a keyboard failure and shows an alert", async () => {
			status();
			hoisted.send.mockRejectedValueOnce(new Error("helper missing"));
			await handler.onDialDown({ action: d, payload: { settings: {} } } as never);
			expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining("helper missing"));
			expect(d.showAlert).toHaveBeenCalledTimes(1);
		});
	});

	describe("drawing", () => {
		it("draws a key with setImage and a dial with setFeedback canvas, both as SVG data URIs", () => {
			status();
			handler.onWillAppear({ action: k } as never);
			expect(String(k.setImage.mock.calls.at(-1)?.[0]).startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(String(d.setFeedback.mock.calls.at(-1)?.[0].canvas).startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(k.setFeedback).not.toHaveBeenCalled();
			expect(d.setImage).not.toHaveBeenCalled();
		});

		it("shows the percentage, tokens, and model of the latest reading", () => {
			status();
			handler.onWillAppear({ action: k } as never);
			expect(keyTexts()).toEqual(["CONTEXT", "42%", "84k / 200k", "Opus"]);
			expect(dialTexts()).toContain("42%");
		});

		it("shows set up guidance before any status line update", () => {
			handler.onWillAppear({ action: k } as never);
			expect(keyTexts()).toEqual(["CONTEXT", "no data", "restart Claude", "or run Setup"]);
			expect(dialTexts()).toEqual(["CONTEXT", "no data", "restart Claude or Setup"]);
		});

		it("shows a no messages notice after a status update without a context reading", () => {
			store.handleStatus({ session_id: "s1", model: { id: "m", display_name: "Opus" } });
			handler.onWillAppear({ action: k } as never);
			expect(keyTexts()).toEqual(["CONTEXT", "no messages", "yet"]);
		});

		it("redraws when session details change", () => {
			handler.onWillAppear({ action: k } as never);
			status("s1", 10);
			expect(keyTexts()).toContain("10%");
			status("s1", 55);
			expect(keyTexts()).toContain("55%");
			expect(dialTexts()).toContain("55%");
		});

		it("redraws on settings changes", () => {
			status();
			k.setImage.mockClear();
			handler.onDidReceiveSettings({ action: k, payload: { settings: {} } } as never);
			expect(k.setImage).toHaveBeenCalledTimes(1);
		});

		it("draws instances that have appeared and are still registered", () => {
			status();
			const late = instance("key", "k2");
			hoisted.instances.push(late);
			handler.onWillAppear({ action: late } as never);
			expect(late.setImage).toHaveBeenCalled();
		});
	});
});
