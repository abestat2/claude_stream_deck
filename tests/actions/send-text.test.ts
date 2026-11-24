import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	send: vi.fn(),
	error: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {}
	return {
		default: { logger: { error: hoisted.error } },
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

vi.mock("../../src/input/keyboard", () => ({
	keyboard: { send: hoisted.send, start: vi.fn() },
}));

import { SendText } from "../../src/actions/send-text";
import { parseSequence } from "../../src/input/sequence";

describe("SendText", () => {
	let handler: SendText;
	let showAlert: ReturnType<typeof vi.fn>;

	const press = (settings: Record<string, unknown>) =>
		handler.onKeyDown({ action: { showAlert }, payload: { settings } } as never);

	beforeEach(() => {
		hoisted.send.mockReset().mockResolvedValue(undefined);
		hoisted.error.mockReset();
		showAlert = vi.fn().mockResolvedValue(undefined);
		handler = new SendText();
	});

	describe("sending", () => {
		it("sends plain text followed by Enter by default", async () => {
			await press({ text: "hello" });
			expect(hoisted.send).toHaveBeenCalledTimes(1);
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("hello", true));
			expect(hoisted.send.mock.calls[0]?.[0]).toEqual([
				{ type: "text", value: "hello" },
				{ type: "key", vk: 0x0d, extended: false, modifiers: [] },
			]);
		});

		it("omits Enter only when submit is explicitly false", async () => {
			await press({ text: "hello", submit: false });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("hello", false));
			expect(hoisted.send.mock.calls[0]?.[0]).toEqual([{ type: "text", value: "hello" }]);
		});

		it.each([true, undefined, null, 0, "", "false", 1])("keeps Enter when submit is %j", async (submit) => {
			await press({ text: "x", submit });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("x", true));
		});

		it("sends named keys with modifiers", async () => {
			await press({ text: "{Esc}{Shift+Tab}", submit: false });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("{Esc}{Shift+Tab}", false));
			expect(hoisted.send.mock.calls[0]?.[0]).toEqual([
				{ type: "key", vk: 0x1b, extended: false, modifiers: [] },
				{ type: "key", vk: 0x09, extended: false, modifiers: [0x10] },
			]);
		});

		it("sends doubled braces as literal braces", async () => {
			await press({ text: "{{x}}", submit: false });
			expect(hoisted.send.mock.calls[0]?.[0]).toEqual([{ type: "text", value: "{x}" }]);
		});

		it("sends a clipboard step", async () => {
			await press({ text: "a{Clipboard}b" });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("a{Clipboard}b", true));
			expect(hoisted.send.mock.calls[0]?.[0]).toContainEqual({ type: "clipboard" });
		});

		it("does not show an alert after a successful press", async () => {
			await press({ text: "hello" });
			expect(showAlert).not.toHaveBeenCalled();
			expect(hoisted.error).not.toHaveBeenCalled();
		});

		it("sends whitespace-only text as typed text", async () => {
			await press({ text: "   ", submit: false });
			expect(hoisted.send).toHaveBeenCalledWith([{ type: "text", value: "   " }]);
			expect(showAlert).not.toHaveBeenCalled();
		});
	});

	describe("empty input", () => {
		it.each([
			["missing", {}],
			["empty", { text: "" }],
			["a number", { text: 42 }],
			["null", { text: null }],
			["an object", { text: {} }],
			["an array", { text: ["a"] }],
			["a boolean", { text: true }],
		])("shows an alert and sends nothing when text is %s", async (_name, settings) => {
			await press({ ...settings, submit: true });
			expect(hoisted.send).not.toHaveBeenCalled();
			expect(showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.error).not.toHaveBeenCalled();
		});

		it("shows an alert for empty text with submit disabled", async () => {
			await press({ text: "", submit: false });
			expect(hoisted.send).not.toHaveBeenCalled();
			expect(showAlert).toHaveBeenCalledTimes(1);
		});
	});

	describe("failures", () => {
		it.each(["{Nope}", "{Ctrl+Bogus}", "{Bogus+A}", "abc{Enter", "{"])(
			"logs and alerts without sending for the unparsable sequence %j",
			async (text) => {
				await press({ text });
				expect(hoisted.send).not.toHaveBeenCalled();
				expect(hoisted.error).toHaveBeenCalledTimes(1);
				expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining(`"${text}"`));
				expect(showAlert).toHaveBeenCalledTimes(1);
			},
		);

		it("includes the parse error message in the log", async () => {
			await press({ text: "{Nope}" });
			expect(hoisted.error).toHaveBeenCalledWith('Send Text failed for "{Nope}": Unknown key "{Nope}"');
		});

		it("logs the message of an Error rejected by the keyboard and alerts", async () => {
			hoisted.send.mockRejectedValueOnce(new Error("helper missing"));
			await press({ text: "hi" });
			expect(hoisted.error).toHaveBeenCalledWith('Send Text failed for "hi": helper missing');
			expect(showAlert).toHaveBeenCalledTimes(1);
		});

		it.each([
			["a string", "boom", "boom"],
			["a number", 7, "7"],
			["undefined", undefined, "undefined"],
			["an object", { code: 1 }, "[object Object]"],
		])("logs and alerts when the keyboard rejects with %s", async (_name, reason, text) => {
			hoisted.send.mockRejectedValueOnce(reason);
			await press({ text: "hi" });
			expect(hoisted.error).toHaveBeenCalledWith(`Send Text failed for "hi": ${text}`);
			expect(showAlert).toHaveBeenCalledTimes(1);
		});

		it("sends again after a failed press", async () => {
			hoisted.send.mockRejectedValueOnce(new Error("x"));
			await press({ text: "hi" });
			await press({ text: "hi" });
			expect(hoisted.send).toHaveBeenCalledTimes(2);
			expect(showAlert).toHaveBeenCalledTimes(1);
		});
	});
});
