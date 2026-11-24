import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { parsePrompts, SavedPrompts } from "../../src/actions/saved-prompts";

const DEFAULTS = [
	{ label: "yes", text: "yes" },
	{ label: "please commit", text: "please commit" },
	{ label: "/graphify", text: "/graphify" },
];

describe("parsePrompts", () => {
	it("returns the defaults when the setting is missing", () => {
		expect(parsePrompts({})).toEqual(DEFAULTS);
	});

	it.each([undefined, "", "   ", "\n\n", " | ", "label |"])("returns the defaults for %j", (prompts) => {
		expect(parsePrompts({ prompts })).toEqual(DEFAULTS);
	});

	it("returns the defaults when the setting is not a string", () => {
		expect(parsePrompts({ prompts: 5 as unknown as string })).toEqual(DEFAULTS);
	});

	it("uses a line without a separator as both label and text", () => {
		expect(parsePrompts({ prompts: "hello there" })).toEqual([{ label: "hello there", text: "hello there" }]);
	});

	it("splits a line at the first separator into label and text", () => {
		expect(parsePrompts({ prompts: "Commit | please commit" })).toEqual([{ label: "Commit", text: "please commit" }]);
	});

	it("keeps later separators in the text", () => {
		expect(parsePrompts({ prompts: "a | b | c" })).toEqual([{ label: "a", text: "b | c" }]);
	});

	it("uses the text as the label when the label is empty", () => {
		expect(parsePrompts({ prompts: "  | text only" })).toEqual([{ label: "text only", text: "text only" }]);
	});

	it("skips lines with an empty text", () => {
		expect(parsePrompts({ prompts: "label |\nkept" })).toEqual([{ label: "kept", text: "kept" }]);
	});

	it("skips blank lines and trims whitespace", () => {
		expect(parsePrompts({ prompts: "\n  one  \n\n  two | 2  \n" })).toEqual([
			{ label: "one", text: "one" },
			{ label: "two", text: "2" },
		]);
	});

	it("accepts CRLF line endings", () => {
		expect(parsePrompts({ prompts: "a\r\nb | c\r\n" })).toEqual([
			{ label: "a", text: "a" },
			{ label: "b", text: "c" },
		]);
	});

	it("keeps key syntax in the text", () => {
		expect(parsePrompts({ prompts: "Stop | {Esc}" })).toEqual([{ label: "Stop", text: "{Esc}" }]);
	});

	it("keeps the order of the lines", () => {
		expect(parsePrompts({ prompts: "c\nb\na" }).map((p) => p.text)).toEqual(["c", "b", "a"]);
	});
});

type FakeDial = { id: string; isDial: () => boolean; setFeedback: ReturnType<typeof vi.fn>; showAlert: ReturnType<typeof vi.fn> };

function dial(id = "d1"): FakeDial {
	return { id, isDial: () => true, setFeedback: vi.fn(), showAlert: vi.fn().mockResolvedValue(undefined) };
}

const settings = (prompts: string, submit?: boolean) => ({ prompts, submit });

describe("SavedPrompts", () => {
	let handler: SavedPrompts;
	let d: FakeDial;

	const rotate = (ticks: number, s = settings("a\nb\nc")) =>
		handler.onDialRotate({ action: d, payload: { ticks, settings: s } } as never);
	const press = (s = settings("a\nb\nc")) => handler.onDialDown({ action: d, payload: { settings: s } } as never);
	const lastCanvas = () => String(d.setFeedback.mock.calls.at(-1)?.[0].canvas);
	const decode = () => Buffer.from(lastCanvas().split(",")[1] as string, "base64").toString("utf8");

	beforeEach(() => {
		hoisted.send.mockReset().mockResolvedValue(undefined);
		hoisted.error.mockReset();
		d = dial();
		hoisted.instances.length = 0;
		hoisted.instances.push(d);
		handler = new SavedPrompts();
	});

	it("draws the first prompt when the action appears", () => {
		handler.onWillAppear({ action: d, payload: { settings: settings("alpha\nbeta") } } as never);
		expect(decode()).toContain("alpha");
		expect(decode()).toContain("1 / 2");
	});

	it("wraps forward past the last prompt", () => {
		handler.onWillAppear({ action: d, payload: { settings: settings("a\nb\nc") } } as never);
		rotate(3);
		expect(decode()).toContain("1 / 3");
		rotate(1);
		expect(decode()).toContain("2 / 3");
	});

	it("wraps backward past the first prompt", () => {
		rotate(-1);
		expect(decode()).toContain("3 / 3");
		rotate(-7);
		expect(decode()).toContain("2 / 3");
	});

	it("types the highlighted prompt followed by Enter without touching the real keyboard", async () => {
		rotate(1);
		await press();
		expect(hoisted.send).toHaveBeenCalledTimes(1);
		expect(hoisted.send).toHaveBeenCalledWith([
			{ type: "text", value: "b" },
			{ type: "key", vk: 0x0d, extended: false, modifiers: [] },
		]);
	});

	it("omits Enter when submit is false", async () => {
		await press(settings("a", false));
		expect(hoisted.send).toHaveBeenCalledWith([{ type: "text", value: "a" }]);
	});

	it("marks the prompt as sent after a successful send", async () => {
		await press();
		expect(decode()).toContain("sent");
		rotate(1);
		expect(decode()).toContain("press to send");
	});

	it("shows an alert and logs when the sequence is invalid, without sending", async () => {
		await press(settings("{Nope}"));
		expect(hoisted.send).not.toHaveBeenCalled();
		expect(d.showAlert).toHaveBeenCalledTimes(1);
		expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining("Unknown key"));
	});

	it("shows an alert when sending fails and does not mark the prompt as sent", async () => {
		hoisted.send.mockRejectedValueOnce(new Error("blocked"));
		await press();
		expect(d.showAlert).toHaveBeenCalledTimes(1);
		expect(hoisted.error).toHaveBeenCalledWith(expect.stringContaining("blocked"));
		rotate(0);
		expect(decode()).toContain("press to send");
	});

	it("returns to the first prompt when the list shrinks below the selection", () => {
		rotate(2);
		handler.onDidReceiveSettings({ action: d, payload: { settings: settings("only") } } as never);
		expect(decode()).toContain("1 / 1");
	});

	it("forgets the selection when the action disappears", () => {
		rotate(2);
		handler.onWillDisappear({ action: d } as never);
		handler.onWillAppear({ action: d, payload: { settings: settings("a\nb\nc") } } as never);
		expect(decode()).toContain("1 / 3");
	});
});
