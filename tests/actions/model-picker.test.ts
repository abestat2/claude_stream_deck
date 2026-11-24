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

import { ModelPicker } from "../../src/actions/model-picker";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, textElements } from "../helpers/svg";

type FakeDial = {
	id: string;
	isKey: () => boolean;
	isDial: () => boolean;
	setFeedback: ReturnType<typeof vi.fn>;
	showAlert: ReturnType<typeof vi.fn>;
};

function dial(id = "d1"): FakeDial {
	return { id, isKey: () => false, isDial: () => true, setFeedback: vi.fn(), showAlert: vi.fn().mockResolvedValue(undefined) };
}

const settings = (models?: string) => ({ models });

describe("ModelPicker", () => {
	let store: SessionStore;
	let handler: ModelPicker;
	let d: FakeDial;

	const model = (name: string, session = "s1") =>
		store.handleStatus({ session_id: session, model: { id: `id-${name}`, display_name: name } });
	const appear = (s = settings(), target: FakeDial = d) => handler.onWillAppear({ action: target, payload: { settings: s } } as never);
	const rotate = (ticks: number, s = settings(), target: FakeDial = d) =>
		handler.onDialRotate({ action: target, payload: { ticks, settings: s } } as never);
	const texts = (target: FakeDial = d) => textElements(decodeDataUri(String(target.setFeedback.mock.calls.at(-1)?.[0].canvas))).filter((t) => !t.startsWith("&#"));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		hoisted.send.mockReset().mockResolvedValue(undefined);
		hoisted.error.mockReset();
		store = new SessionStore();
		d = dial();
		hoisted.instances.length = 0;
		hoisted.instances.push(d);
		handler = new ModelPicker(store);
	});

	afterEach(() => {
		store.stop();
		vi.useRealTimers();
	});

	it("draws the first default model with the original layout when no model is reported", () => {
		appear();
		expect(texts()).toEqual(["MODEL", "opus", "press to send"]);
	});

	it("shows the reported model beside the title", () => {
		model("Opus 4.1");
		appear();
		expect(texts()).toEqual(["MODEL", "Opus 4.1", "opus", "active"]);
	});

	it("marks the highlighted entry active when the reported model name contains it", () => {
		model("Sonnet 4");
		appear();
		expect(texts()).toContain("press to send");
		rotate(1);
		expect(texts()).toContain("active");
		expect(texts()).not.toContain("press to send");
		rotate(1);
		expect(texts()).toContain("press to send");
	});

	it("compares case-insensitively in both directions", () => {
		model("CLAUDE OPUS");
		appear(settings("OpUs"));
		expect(texts()).toContain("active");
	});

	it("does not mark an entry active when the model name does not contain it", () => {
		model("Haiku");
		appear(settings("opus\nsonnet"));
		expect(texts()).not.toContain("active");
	});

	it("uses the model of the most recently active session that reported one", () => {
		model("Opus", "a");
		vi.advanceTimersByTime(10);
		store.handle({ hook_event_name: "UserPromptSubmit", session_id: "b" });
		vi.advanceTimersByTime(10);
		store.handle({ hook_event_name: "UserPromptSubmit", session_id: "a" });
		appear();
		expect(texts()).toContain("Opus");
	});

	it("shows active in preference to sent", async () => {
		model("Opus");
		appear();
		await handler.onDialDown({ action: d, payload: { settings: settings() } } as never);
		expect(texts()).toContain("active");
		expect(texts()).not.toContain("sent");
	});

	it("shows sent for a sent entry that is not the active model", async () => {
		model("Sonnet");
		appear();
		await handler.onDialDown({ action: d, payload: { settings: settings() } } as never);
		expect(texts()).toContain("sent");
	});

	it("redraws registered dials when the store reports a detail change", () => {
		appear();
		expect(texts()).toEqual(["MODEL", "opus", "press to send"]);
		d.setFeedback.mockClear();
		model("Opus");
		expect(d.setFeedback).toHaveBeenCalledTimes(1);
		expect(texts()).toEqual(["MODEL", "Opus", "opus", "active"]);
		model("Sonnet");
		expect(texts()).toEqual(["MODEL", "Sonnet", "opus", "press to send"]);
	});

	it("redraws every registered dial on a detail change", () => {
		const other = dial("d2");
		hoisted.instances.push(other);
		appear(settings(), d);
		appear(settings("haiku"), other);
		d.setFeedback.mockClear();
		other.setFeedback.mockClear();
		model("Haiku");
		expect(d.setFeedback).toHaveBeenCalledTimes(1);
		expect(other.setFeedback).toHaveBeenCalledTimes(1);
		expect(texts(other)).toContain("active");
		expect(texts(d)).not.toContain("active");
	});

	it("does not redraw on detail changes that happen before the dial appears", () => {
		model("Opus");
		expect(d.setFeedback).not.toHaveBeenCalled();
	});

	it("forgets a dial that disappears", () => {
		appear();
		handler.onWillDisappear({ action: d } as never);
		d.setFeedback.mockClear();
		model("Opus");
		expect(d.setFeedback).not.toHaveBeenCalled();
	});

	it("restarts from the first entry after a dial disappears and reappears", () => {
		appear();
		rotate(1);
		expect(texts()).toContain("sonnet");
		handler.onWillDisappear({ action: d } as never);
		appear();
		expect(texts()).toContain("opus");
	});

	it("does not draw instances that are not dials", () => {
		const key = { ...dial("k1"), isDial: () => false, isKey: () => true };
		hoisted.instances.push(key);
		appear(settings(), key);
		expect(key.setFeedback).not.toHaveBeenCalled();
	});

	it("escapes the reported model name", () => {
		model(`<Opus> & "x"`);
		appear();
		const svg = decodeDataUri(String(d.setFeedback.mock.calls.at(-1)?.[0].canvas));
		expect(svg).toContain("&lt;Opus&gt; &amp; &quot;x&quot;");
	});
});
