import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (ev: { payload: unknown }) => Promise<void>;

const hoisted = vi.hoisted(() => {
	const order: string[] = [];
	const registered: { kind: string; args: unknown[] }[] = [];
	const state = {
		globalSettings: Promise.resolve({}) as Promise<unknown>,
		settingsListener: undefined as undefined | ((ev: { settings: unknown }) => void),
		sendHandler: undefined as undefined | ((ev: { payload: unknown }) => Promise<void>),
		keyboardStart: undefined as undefined | (() => Promise<void>),
	};
	const logger = { setLevel: vi.fn(), info: vi.fn(), error: vi.fn() };
	const hookClose = vi.fn();
	return {
		order,
		registered,
		state,
		logger,
		hookClose,
		startHookServer: vi.fn(),
		keyboardStart: vi.fn(),
		keyboardStop: vi.fn(),
		runSetup: vi.fn(),
		createNotifier: vi.fn(),
		notify: vi.fn(),
		sendToPropertyInspector: vi.fn(),
		connect: vi.fn(),
	};
});

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {}
	return {
		default: {
			logger: hoisted.logger,
			actions: {
				registerAction: (instance: { kind: string; args: unknown[] }) => {
					hoisted.order.push(`register:${instance.kind}`);
					hoisted.registered.push(instance);
				},
			},
			settings: {
				getGlobalSettings: () => hoisted.state.globalSettings,
				onDidReceiveGlobalSettings: (listener: (ev: { settings: unknown }) => void) => {
					hoisted.state.settingsListener = listener;
				},
			},
			ui: {
				onSendToPlugin: (handler: (ev: { payload: unknown }) => Promise<void>) => {
					hoisted.state.sendHandler = handler;
				},
				sendToPropertyInspector: hoisted.sendToPropertyInspector,
			},
			connect: () => {
				hoisted.order.push("connect");
				hoisted.connect();
			},
		},
		action: () => (target: unknown) => target,
		SingletonAction,
	};
});

vi.mock("../src/server/hook-server", () => ({
	startHookServer: (...args: unknown[]) => {
		hoisted.order.push("hook-server");
		return hoisted.startHookServer(...args);
	},
	hookServerStatus: { listening: false },
}));

vi.mock("../src/input/keyboard", () => ({
	keyboard: {
		start: () => {
			hoisted.order.push("keyboard-start");
			return hoisted.keyboardStart();
		},
		stop: hoisted.keyboardStop,
		send: vi.fn(),
	},
}));

vi.mock("../src/setup/installer", () => ({ runSetup: hoisted.runSetup }));

vi.mock("../src/alerts/notifier", () => ({ createNotifier: hoisted.createNotifier }));

const actionMock = (kind: string) => ({
	[kind]: class {
		readonly kind = kind;
		readonly args: unknown[];
		constructor(...args: unknown[]) {
			this.args = args;
		}
	},
});

vi.mock("../src/actions/send-text", () => actionMock("SendText"));
vi.mock("../src/actions/claude-status", () => actionMock("ClaudeStatus"));
vi.mock("../src/actions/session-overview", () => actionMock("SessionOverview"));
vi.mock("../src/actions/model-picker", () => actionMock("ModelPicker"));
vi.mock("../src/actions/saved-prompts", () => actionMock("SavedPrompts"));
vi.mock("../src/actions/usage", () => actionMock("Usage"));
vi.mock("../src/actions/connection", () => actionMock("Connection"));
vi.mock("../src/actions/permission", () => actionMock("PermissionResponse"));
vi.mock("../src/actions/permission-mode", () => actionMock("PermissionMode"));
vi.mock("../src/actions/context", () => actionMock("Context"));
vi.mock("../src/actions/sessions", () => actionMock("Sessions"));

const EXPECTED_ACTIONS = [
	"SendText",
	"ClaudeStatus",
	"SessionOverview",
	"ModelPicker",
	"SavedPrompts",
	"Usage",
	"Connection",
	"PermissionResponse",
	"PermissionMode",
	"Context",
	"Sessions",
];

let processOn: { mockRestore(): void };
let exitHandlers: (() => void)[];
let hookServer: { close: typeof hoisted.hookClose };

/** Imports the plugin entry script with fresh module state and flushes pending promises. */
async function loadPlugin() {
	await import("../src/plugin");
	await Promise.resolve();
	await Promise.resolve();
}

const registeredArgs = (kind: string) => hoisted.registered.find((entry) => entry.kind === kind)?.args as unknown[];

/** Session store the plugin created, as passed to the Sessions action. */
const storeOf = () => registeredArgs("Sessions")[0] as import("../src/state/sessions").SessionStore;
const usageOf = () => registeredArgs("Usage")[0] as import("../src/usage/client").UsageService;
const configOf = () => registeredArgs("ClaudeStatus")[1] as import("../src/alerts/config").AlertConfig;

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	hoisted.order.length = 0;
	hoisted.registered.length = 0;
	hoisted.state.globalSettings = Promise.resolve({});
	hoisted.state.settingsListener = undefined;
	hoisted.state.sendHandler = undefined;
	for (const fn of [
		hoisted.logger.setLevel,
		hoisted.logger.info,
		hoisted.logger.error,
		hoisted.hookClose,
		hoisted.startHookServer,
		hoisted.keyboardStart,
		hoisted.keyboardStop,
		hoisted.runSetup,
		hoisted.createNotifier,
		hoisted.notify,
		hoisted.sendToPropertyInspector,
		hoisted.connect,
	]) {
		fn.mockReset();
	}
	hookServer = { close: hoisted.hookClose };
	hoisted.startHookServer.mockReturnValue(hookServer);
	hoisted.keyboardStart.mockResolvedValue(undefined);
	hoisted.createNotifier.mockReturnValue(hoisted.notify);
	hoisted.runSetup.mockResolvedValue({ ok: true, message: "done" });
	hoisted.sendToPropertyInspector.mockResolvedValue(undefined);

	exitHandlers = [];
	processOn = vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
		if (event === "exit") {
			exitHandlers.push(listener);
		}
		return process;
	}) as never);
});

afterEach(() => {
	processOn.mockRestore();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("plugin startup", () => {
	it("sets the log level to info", async () => {
		await loadPlugin();
		expect(hoisted.logger.setLevel).toHaveBeenCalledWith("info");
	});

	it("registers the 11 actions", async () => {
		await loadPlugin();
		expect(hoisted.registered.map((entry) => entry.kind)).toEqual(EXPECTED_ACTIONS);
	});

	it("gives each action the store and services it needs", async () => {
		await loadPlugin();
		const store = storeOf();
		const usage = usageOf();
		expect(registeredArgs("SendText")).toEqual([]);
		expect(registeredArgs("SavedPrompts")).toEqual([]);
		expect(registeredArgs("ClaudeStatus")[0]).toBe(store);
		expect(registeredArgs("SessionOverview")[0]).toBe(store);
		expect(registeredArgs("ModelPicker")[0]).toBe(store);
		expect(registeredArgs("Connection")).toEqual([store, usage]);
		expect(registeredArgs("PermissionResponse")[0]).toBe(store);
		expect(registeredArgs("PermissionMode")[0]).toBe(store);
		expect(registeredArgs("Context")[0]).toBe(store);
	});

	it("starts the hook server with the session store and the logger", async () => {
		await loadPlugin();
		expect(hoisted.startHookServer).toHaveBeenCalledTimes(1);
		expect(hoisted.startHookServer).toHaveBeenCalledWith(storeOf(), hoisted.logger);
	});

	it("starts the keyboard helper", async () => {
		await loadPlugin();
		expect(hoisted.keyboardStart).toHaveBeenCalledTimes(1);
	});

	it("connects once, after the registrations, the hook server and the keyboard start", async () => {
		await loadPlugin();
		expect(hoisted.connect).toHaveBeenCalledTimes(1);
		const order = hoisted.order;
		expect(order[order.length - 1]).toBe("connect");
		for (const kind of EXPECTED_ACTIONS) {
			expect(order.indexOf(`register:${kind}`)).toBeLessThan(order.indexOf("connect"));
		}
		expect(order.indexOf("hook-server")).toBeLessThan(order.indexOf("connect"));
		expect(order.indexOf("keyboard-start")).toBeLessThan(order.indexOf("connect"));
	});

	it("builds the notifier with a logger callback for notification errors", async () => {
		await loadPlugin();
		expect(hoisted.createNotifier).toHaveBeenCalledTimes(1);
		const report = hoisted.createNotifier.mock.calls[0]?.[0] as (message: string) => void;
		report("notify failed");
		expect(hoisted.logger.error).toHaveBeenCalledWith("notify failed");
	});

	it("registers a single exit handler on the process", async () => {
		await loadPlugin();
		expect(exitHandlers).toHaveLength(1);
	});
});

describe("keyboard start failure", () => {
	it("logs the message of an Error", async () => {
		hoisted.keyboardStart.mockRejectedValue(new Error("script blocked"));
		await loadPlugin();
		await vi.waitFor(() => expect(hoisted.logger.error).toHaveBeenCalledWith("Keyboard helper failed to start: script blocked"));
	});

	it("logs a non-Error rejection as a string", async () => {
		hoisted.keyboardStart.mockRejectedValue("denied");
		await loadPlugin();
		await vi.waitFor(() => expect(hoisted.logger.error).toHaveBeenCalledWith("Keyboard helper failed to start: denied"));
	});

	it("logs nothing when the helper starts", async () => {
		await loadPlugin();
		await Promise.resolve();
		expect(hoisted.logger.error).not.toHaveBeenCalled();
	});

	it("still connects after a failure", async () => {
		hoisted.keyboardStart.mockRejectedValue(new Error("x"));
		await loadPlugin();
		expect(hoisted.connect).toHaveBeenCalledTimes(1);
	});
});

describe("global settings", () => {
	it("applies the stored global settings to the alert configuration", async () => {
		hoisted.state.globalSettings = Promise.resolve({ escalateMinutes: 7, alertSound: false, alertOnDone: true });
		await loadPlugin();
		await vi.waitFor(() => expect(configOf().get().escalateMinutes).toBe(7));
		expect(configOf().get()).toMatchObject({ sound: false, toast: true, onDone: true });
	});

	it("uses defaults until the stored settings arrive", async () => {
		hoisted.state.globalSettings = new Promise(() => undefined);
		await loadPlugin();
		expect(configOf().get()).toEqual({ sound: true, toast: true, onDone: false, escalateMinutes: 3 });
	});

	it("applies settings received later to the alert configuration", async () => {
		await loadPlugin();
		expect(hoisted.state.settingsListener).toBeTypeOf("function");
		hoisted.state.settingsListener?.({ settings: { escalateMinutes: 0, alertToast: false } });
		expect(configOf().get()).toMatchObject({ escalateMinutes: 0, toast: false });
	});
});

describe("event wiring", () => {
	it("forwards rate limits of a status event to the usage service", async () => {
		const { UsageService } = await import("../src/usage/client");
		const ingest = vi.spyOn(UsageService.prototype, "ingestStatusLine");
		await loadPlugin();
		const limits = { five_hour: { used_percentage: 10 } };
		storeOf().emit("status", { rate_limits: limits });
		expect(ingest).toHaveBeenCalledTimes(1);
		expect(ingest).toHaveBeenCalledWith(limits);
	});

	it("forwards undefined when a status event has no rate limits", async () => {
		const { UsageService } = await import("../src/usage/client");
		const ingest = vi.spyOn(UsageService.prototype, "ingestStatusLine");
		await loadPlugin();
		storeOf().emit("status", {});
		expect(ingest).toHaveBeenCalledWith(undefined);
	});

	it("logs a summary line when the sessions summary changes", async () => {
		await loadPlugin();
		storeOf().emit("change", { sessions: 3, working: 1, attention: 1, done: 1, idle: 0, agents: 2 });
		expect(hoisted.logger.info).toHaveBeenCalledWith("Sessions: 3 (working 1, attention 1, done 1, idle 0), agents: 2");
	});

	it("logs usage percentages rounded, with dashes for missing windows", async () => {
		await loadPlugin();
		usageOf().emit("change", { windows: { session: { percent: 42.4 }, week: { percent: 7.5 } }, error: undefined });
		expect(hoisted.logger.info).toHaveBeenCalledWith("Usage: session 42%, week 8%, sonnet -");
	});

	it("appends the error name to the usage line", async () => {
		await loadPlugin();
		usageOf().emit("change", { windows: {}, error: "offline" });
		expect(hoisted.logger.info).toHaveBeenCalledWith("Usage: session -, week -, sonnet -, error offline");
	});

	it("reports status line limits through the usage log", async () => {
		await loadPlugin();
		storeOf().emit("status", { rate_limits: { five_hour: { used_percentage: 61.2 }, seven_day: { used_percentage: 12 } } });
		expect(hoisted.logger.info).toHaveBeenCalledWith("Usage: session 61%, week 12%, sonnet -");
	});

	describe("context line", () => {
		const latest = (percent: number | undefined, model?: string) =>
			({ contextPercent: percent, model: model ? { name: model } : undefined }) as never;

		it("logs the rounded context percentage and model name", async () => {
			const { SessionStore } = await import("../src/state/sessions");
			vi.spyOn(SessionStore.prototype, "latestContext").mockReturnValue(latest(42.6, "Opus"));
			await loadPlugin();
			storeOf().emit("detail");
			expect(hoisted.logger.info).toHaveBeenCalledWith("Context: 43% (Opus)");
		});

		it("uses a fallback name when the model is unknown", async () => {
			const { SessionStore } = await import("../src/state/sessions");
			vi.spyOn(SessionStore.prototype, "latestContext").mockReturnValue(latest(10));
			await loadPlugin();
			storeOf().emit("detail");
			expect(hoisted.logger.info).toHaveBeenCalledWith("Context: 10% (unknown model)");
		});

		it("logs once per distinct value", async () => {
			const { SessionStore } = await import("../src/state/sessions");
			const spy = vi.spyOn(SessionStore.prototype, "latestContext").mockReturnValue(latest(20, "Opus"));
			await loadPlugin();
			const contextCalls = () => hoisted.logger.info.mock.calls.filter(([line]) => String(line).startsWith("Context:"));
			storeOf().emit("detail");
			storeOf().emit("detail");
			expect(contextCalls()).toHaveLength(1);
			spy.mockReturnValue(latest(21, "Opus"));
			storeOf().emit("detail");
			expect(contextCalls()).toHaveLength(2);
			spy.mockReturnValue(latest(21, "Sonnet"));
			storeOf().emit("detail");
			expect(contextCalls()).toHaveLength(3);
		});

		it("logs nothing when no session has reported context", async () => {
			const { SessionStore } = await import("../src/state/sessions");
			vi.spyOn(SessionStore.prototype, "latestContext").mockReturnValue(undefined);
			await loadPlugin();
			storeOf().emit("detail");
			expect(hoisted.logger.info).not.toHaveBeenCalled();
		});
	});
});

describe("settings panel messages", () => {
	const send = async (payload: unknown) => {
		await loadPlugin();
		await hoisted.state.sendHandler?.({ payload });
	};

	it("registers the handler", async () => {
		await loadPlugin();
		expect(hoisted.state.sendHandler).toBeTypeOf("function");
	});

	it.each([
		["setup-install", "install"],
		["setup-remove", "remove"],
		["setup-check", "check"],
	])("runs the %s request as %s", async (event, action) => {
		await send({ event });
		expect(hoisted.runSetup).toHaveBeenCalledTimes(1);
		expect(hoisted.runSetup).toHaveBeenCalledWith(action);
	});

	it.each([
		["an unknown event", { event: "something-else" }],
		["a missing event", {}],
		["a null payload", null],
		["an undefined payload", undefined],
		["a string payload", "setup-install"],
		["a number payload", 5],
		["a non-string event", { event: 1 }],
	])("does nothing for %s", async (_name, payload) => {
		await send(payload);
		expect(hoisted.runSetup).not.toHaveBeenCalled();
		expect(hoisted.sendToPropertyInspector).not.toHaveBeenCalled();
		expect(hoisted.logger.error).not.toHaveBeenCalled();
	});

	it("sends the result back to the settings panel", async () => {
		hoisted.runSetup.mockResolvedValue({ ok: true, message: "Installed", detail: 1 });
		await send({ event: "setup-install" });
		expect(hoisted.sendToPropertyInspector).toHaveBeenCalledWith({ event: "setup-result", ok: true, message: "Installed", detail: 1 });
		expect(hoisted.logger.error).not.toHaveBeenCalled();
	});

	it("logs a failed result and still sends it back", async () => {
		hoisted.runSetup.mockResolvedValue({ ok: false, message: "settings.json is invalid" });
		await send({ event: "setup-remove" });
		expect(hoisted.logger.error).toHaveBeenCalledWith("Setup remove failed: settings.json is invalid");
		expect(hoisted.sendToPropertyInspector).toHaveBeenCalledWith({ event: "setup-result", ok: false, message: "settings.json is invalid" });
	});
});

describe("process exit", () => {
	it("stops the keyboard helper, the session sweep and the alert manager, and closes the hook server", async () => {
		const { SessionStore } = await import("../src/state/sessions");
		const { AlertManager } = await import("../src/alerts/manager");
		const storeStop = vi.spyOn(SessionStore.prototype, "stop");
		const alertsStop = vi.spyOn(AlertManager.prototype, "stop");
		await loadPlugin();
		expect(hoisted.keyboardStop).not.toHaveBeenCalled();
		expect(hoisted.hookClose).not.toHaveBeenCalled();

		exitHandlers[0]?.();

		expect(hoisted.keyboardStop).toHaveBeenCalledTimes(1);
		expect(storeStop).toHaveBeenCalledTimes(1);
		expect(alertsStop).toHaveBeenCalledTimes(1);
		expect(hoisted.hookClose).toHaveBeenCalledTimes(1);
	});
});
