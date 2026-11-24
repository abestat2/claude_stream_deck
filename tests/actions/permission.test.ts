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

import { PermissionResponse } from "../../src/actions/permission";
import { parseSequence } from "../../src/input/sequence";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, textElements } from "../helpers/svg";

type FakeKey = {
	id: string;
	isKey: () => boolean;
	isDial: () => boolean;
	setImage: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
};

function key(id = "k1"): FakeKey {
	return { id, isKey: () => true, isDial: () => false, setImage: vi.fn(), showAlert: vi.fn().mockResolvedValue(undefined) };
}

type Settings = { response?: string; submit?: boolean };

describe("PermissionResponse", () => {
	let store: SessionStore;
	let handler: PermissionResponse;
	let k: FakeKey;

	const appear = (settings: Settings = {}, target: FakeKey = k) =>
		handler.onWillAppear({ action: target, payload: { settings } } as never);
	const press = (settings: Settings = {}, target: FakeKey = k) =>
		handler.onKeyDown({ action: target, payload: { settings } } as never);
	const request = (tool = "Bash", input: unknown = { command: "npm test" }, session = "s1") =>
		store.handle({ hook_event_name: "PermissionRequest", session_id: session, tool_name: tool, tool_input: input, cwd: "C:\\code\\demo" });
	const drawn = (target: FakeKey = k) => decodeDataUri(String(target.setImage.mock.calls.at(-1)?.[0]));
	const texts = (target: FakeKey = k) => textElements(drawn(target));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		hoisted.send.mockReset().mockResolvedValue(undefined);
		hoisted.error.mockReset();
		store = new SessionStore();
		k = key();
		hoisted.instances.length = 0;
		hoisted.instances.push(k);
		handler = new PermissionResponse(store);
	});

	afterEach(() => {
		store.stop();
		vi.useRealTimers();
	});

	describe("without a pending request", () => {
		it("shows an alert and sends nothing", async () => {
			await press();
			expect(k.showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.send).not.toHaveBeenCalled();
		});

		it("shows an alert when only a question is pending", async () => {
			store.handle({ hook_event_name: "Elicitation", session_id: "s1", message: "Which one?" });
			await press();
			expect(k.showAlert).toHaveBeenCalledTimes(1);
			expect(hoisted.send).not.toHaveBeenCalled();
		});

		it("draws the key with the no request notice", () => {
			appear();
			expect(texts()).toEqual(["ALLOW", "no request"]);
		});
	});

	describe("with a pending request", () => {
		beforeEach(() => request());

		it("sends 1 for allow", async () => {
			await press({ response: "allow" });
			expect(hoisted.send).toHaveBeenCalledTimes(1);
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("1", false));
			expect(k.showAlert).not.toHaveBeenCalled();
		});

		it("sends 1 when no response is configured", async () => {
			await press({});
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("1", false));
		});

		it("sends 1 for an unknown response", async () => {
			await press({ response: "maybe" });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("1", false));
		});

		it("sends 2 for always", async () => {
			await press({ response: "always" });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("2", false));
		});

		it("sends Escape for deny", async () => {
			await press({ response: "deny" });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("{Esc}", false));
			expect(hoisted.send).toHaveBeenCalledWith([{ type: "key", vk: 0x1b, extended: false, modifiers: [] }]);
		});

		it("appends Enter for allow and always when submit is true", async () => {
			await press({ response: "allow", submit: true });
			expect(hoisted.send).toHaveBeenLastCalledWith(parseSequence("1", true));
			expect(hoisted.send.mock.calls[0]?.[0]).toHaveLength(2);
			vi.advanceTimersByTime(1_001);
			await press({ response: "always", submit: true });
			expect(hoisted.send).toHaveBeenLastCalledWith(parseSequence("2", true));
		});

		it("never appends Enter for deny", async () => {
			await press({ response: "deny", submit: true });
			expect(hoisted.send).toHaveBeenCalledWith(parseSequence("{Esc}", false));
			expect(hoisted.send.mock.calls[0]?.[0]).toHaveLength(1);
		});

		it("does not append Enter when submit is not exactly true", async () => {
			await press({ response: "allow", submit: "yes" as unknown as boolean });
			expect(hoisted.send.mock.calls[0]?.[0]).toHaveLength(1);
		});

		it("refuses a second press within one second", async () => {
			await press();
			vi.advanceTimersByTime(999);
			await press();
			expect(hoisted.send).toHaveBeenCalledTimes(1);
			expect(k.showAlert).toHaveBeenCalledTimes(1);
		});

		it("accepts a press once the cooldown has elapsed", async () => {
			await press();
			vi.advanceTimersByTime(1_000);
			await press();
			expect(hoisted.send).toHaveBeenCalledTimes(2);
			expect(k.showAlert).not.toHaveBeenCalled();
		});

		it("applies the cooldown separately to each key", async () => {
			const other = key("k2");
			hoisted.instances.push(other);
			await press({}, k);
			await press({}, other);
			expect(hoisted.send).toHaveBeenCalledTimes(2);
		});

		it("forgets the cooldown when the key disappears", async () => {
			await press();
			handler.onWillDisappear({ action: k } as never);
			await press();
			expect(hoisted.send).toHaveBeenCalledTimes(2);
		});

		it("logs a keyboard failure, shows an alert, and does not start the cooldown", async () => {
			hoisted.send.mockRejectedValueOnce(new Error("helper died"));
			await press();
			expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining("helper died"));
			expect(k.showAlert).toHaveBeenCalledTimes(1);
			await press();
			expect(hoisted.send).toHaveBeenCalledTimes(2);
		});

		it("logs a failure that is not an Error", async () => {
			hoisted.send.mockRejectedValueOnce("plain failure");
			await press();
			expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining("plain failure"));
			expect(k.showAlert).toHaveBeenCalledTimes(1);
		});
	});

	describe("drawing", () => {
		it("draws the request on a key with setImage and an SVG data URI", () => {
			request("Bash", { command: "npm test" });
			appear({ response: "deny" });
			expect(k.setImage).toHaveBeenCalled();
			const uri = String(k.setImage.mock.calls.at(-1)?.[0]);
			expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
			expect(texts()).toEqual(["DENY", "Bash", "npm test", "demo"]);
		});

		it("shows the other waiting sessions as a badge", () => {
			request("Bash", { command: "a" }, "s1");
			vi.advanceTimersByTime(10);
			request("Edit", { file_path: "b.ts" }, "s2");
			appear();
			expect(texts()).toContain("+1");
			expect(texts()).toContain("Edit");
		});

		it("redraws when the session detail changes", () => {
			appear();
			expect(texts()).toEqual(["ALLOW", "no request"]);
			request();
			expect(texts()).toEqual(["ALLOW", "Bash", "npm test", "demo"]);
			store.handle({ hook_event_name: "PostToolUse", session_id: "s1" });
			expect(texts()).toEqual(["ALLOW", "no request"]);
		});

		it("updates the kind when settings change", () => {
			request();
			appear({ response: "allow" });
			expect(texts()[0]).toBe("ALLOW");
			handler.onDidReceiveSettings({ action: k, payload: { settings: { response: "always" } } } as never);
			expect(texts()[0]).toBe("ALWAYS");
			handler.onDidReceiveSettings({ action: k, payload: { settings: { response: "deny" } } } as never);
			expect(texts()[0]).toBe("DENY");
		});

		it("does not draw an instance that has not appeared", () => {
			request();
			expect(k.setImage).not.toHaveBeenCalled();
		});

		it("does not draw an instance after it disappears", () => {
			appear();
			handler.onWillDisappear({ action: k } as never);
			k.setImage.mockClear();
			request();
			expect(k.setImage).not.toHaveBeenCalled();
		});

		it("does not draw dials", () => {
			const dial = { ...key("d1"), isKey: () => false, isDial: () => true };
			hoisted.instances.push(dial);
			appear({}, dial);
			expect(dial.setImage).not.toHaveBeenCalled();
		});

		it("shows the sent caption after a press and restores the project after two seconds", async () => {
			request();
			appear();
			await press();
			expect(texts().at(-1)).toBe("sent");
			vi.advanceTimersByTime(2_050);
			expect(texts().at(-1)).toBe("demo");
		});
	});
});
