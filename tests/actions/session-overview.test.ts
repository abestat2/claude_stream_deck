import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	instances: [] as unknown[],
}));

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {
		get actions(): unknown[] {
			return hoisted.instances;
		}
	}
	return {
		default: { logger: { error: vi.fn() } },
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

import { SessionOverview } from "../../src/actions/session-overview";
import { SessionStore } from "../../src/state/sessions";
import { decodeDataUri, textElements } from "../helpers/svg";
import { xmlProblem } from "../helpers/xml";

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

describe("SessionOverview", () => {
	let store: SessionStore;
	let handler: SessionOverview;
	let d: FakeInstance;
	let k: FakeInstance;

	const hook = (name: string, session = "s1", extra: Record<string, unknown> = {}) =>
		store.handle({ hook_event_name: name, session_id: session, ...extra });
	const svgOf = (target: FakeInstance) => decodeDataUri(String(target.setFeedback.mock.calls.at(-1)?.[0].canvas));
	/** Sessions, agents, and waiting values from the last drawing. */
	const counts = (target: FakeInstance = d) => textElements(svgOf(target)).filter((_, i) => i % 2 === 1);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		store = new SessionStore();
		d = instance("dial", "d1");
		k = instance("key", "k1");
		hoisted.instances.length = 0;
		hoisted.instances.push(d, k);
		handler = new SessionOverview(store);
	});

	afterEach(() => {
		store.stop();
		vi.useRealTimers();
	});

	it("draws on appear with setFeedback canvas as an SVG data URI", () => {
		handler.onWillAppear({ action: d } as never);
		expect(d.setFeedback).toHaveBeenCalledTimes(1);
		const canvas = String(d.setFeedback.mock.calls[0]?.[0].canvas);
		expect(canvas.startsWith("data:image/svg+xml;base64,")).toBe(true);
		expect(xmlProblem(decodeDataUri(canvas))).toBe("");
		expect(Object.keys(d.setFeedback.mock.calls[0]?.[0])).toEqual(["canvas"]);
	});

	it("labels the three columns", () => {
		handler.onWillAppear({ action: d } as never);
		expect(textElements(svgOf(d)).filter((_, i) => i % 2 === 0)).toEqual(["SESSIONS", "AGENTS", "WAITING"]);
	});

	it("shows zeros when there are no sessions", () => {
		handler.onWillAppear({ action: d } as never);
		expect(counts()).toEqual(["0", "0", "0"]);
	});

	it("does not draw key instances", () => {
		handler.onWillAppear({ action: d } as never);
		hook("SessionStart");
		expect(k.setImage).not.toHaveBeenCalled();
		expect(k.setFeedback).not.toHaveBeenCalled();
	});

	it("redraws when the store changes and shows the session count", () => {
		handler.onWillAppear({ action: d } as never);
		hook("SessionStart", "s1");
		expect(counts()).toEqual(["1", "0", "0"]);
		hook("SessionStart", "s2");
		expect(counts()).toEqual(["2", "0", "0"]);
		hook("SessionEnd", "s2");
		expect(counts()).toEqual(["1", "0", "0"]);
		hook("SessionEnd", "s1");
		expect(counts()).toEqual(["0", "0", "0"]);
	});

	it("shows running subagents", () => {
		hook("SessionStart");
		hook("SubagentStart", "s1", { agent_id: "a1" });
		hook("SubagentStart", "s1", { agent_id: "a2" });
		expect(counts()).toEqual(["1", "2", "0"]);
		hook("SubagentStop", "s1", { agent_id: "a1" });
		expect(counts()).toEqual(["1", "1", "0"]);
	});

	it("shows sessions waiting on a permission request and clears them afterwards", () => {
		hook("SessionStart", "s1");
		hook("SessionStart", "s2");
		hook("PermissionRequest", "s1", { tool_name: "Bash", tool_input: { command: "ls" } });
		expect(counts()).toEqual(["2", "0", "1"]);
		hook("PermissionRequest", "s2", { tool_name: "Bash", tool_input: { command: "ls" } });
		expect(counts()).toEqual(["2", "0", "2"]);
		hook("Stop", "s1");
		hook("Stop", "s2");
		expect(counts()).toEqual(["2", "0", "0"]);
	});

	it("updates every dial instance", () => {
		const d2 = instance("dial", "d2");
		hoisted.instances.push(d2);
		hook("SessionStart");
		expect(d.setFeedback).toHaveBeenCalled();
		expect(d2.setFeedback).toHaveBeenCalled();
		expect(counts(d2)).toEqual(["1", "0", "0"]);
		expect(svgOf(d2)).toBe(svgOf(d));
	});
});
