import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from "../../src/alerts/config";

const UI_DIR = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/ui");
const HTML = readFileSync(resolve(UI_DIR, "claude-status.html"), "utf8");
const PLUGIN_SOURCE = readFileSync(resolve(__dirname, "../../src/plugin.ts"), "utf8");

/** Inline script text of the page. */
const SCRIPT = (/<script>([\s\S]*?)<\/script>/.exec(HTML) as RegExpExecArray)[1] as string;

type FakeElement = {
	textContent: string;
	handlers: Map<string, () => void>;
	addEventListener: (type: string, handler: () => void) => void;
	click: () => void;
};

type Panel = {
	elements: Record<string, FakeElement>;
	send: ReturnType<typeof vi.fn>;
	emit: (message: unknown) => void;
	status: () => string;
};

function fakeElement(text = ""): FakeElement {
	const element: FakeElement = {
		textContent: text,
		handlers: new Map(),
		addEventListener: (type, handler) => {
			element.handlers.set(type, handler);
		},
		click: () => {
			const handler = element.handlers.get("click");
			if (!handler) throw new Error("no click handler");
			handler();
		},
	};
	return element;
}

/** Runs the page script against fake DOM elements and a fake Stream Deck client. */
function loadPanel(): Panel {
	const elements: Record<string, FakeElement> = {
		"setup-status": fakeElement("Checking..."),
		"setup-install": fakeElement(),
		"setup-remove": fakeElement(),
	};
	const send = vi.fn();
	let callback: ((message: unknown) => void) | undefined;
	const context = {
		document: {
			getElementById: (id: string) => {
				const element = elements[id];
				if (!element) throw new Error(`unknown element ${id}`);
				return element;
			},
		},
		SDPIComponents: {
			streamDeckClient: {
				send,
				sendToPropertyInspector: {
					subscribe: (cb: (message: unknown) => void) => {
						callback = cb;
					},
				},
			},
		},
	};
	runInNewContext(SCRIPT, context);
	return {
		elements,
		send,
		emit: (message) => {
			if (!callback) throw new Error("no subscriber");
			callback(message);
		},
		status: () => (elements["setup-status"] as FakeElement).textContent,
	};
}

let panel: Panel;

beforeEach(() => {
	panel = loadPanel();
});

describe("setup panel script", () => {
	it("shows Checking... before any result", () => {
		expect(panel.status()).toBe("Checking...");
	});

	it("asks the plugin for the setup status once on load", () => {
		expect(panel.send).toHaveBeenCalledTimes(1);
		expect(panel.send).toHaveBeenCalledWith("sendToPlugin", { event: "setup-check" });
	});

	it("registers click handlers only on the install and remove buttons", () => {
		expect([...(panel.elements["setup-install"] as FakeElement).handlers.keys()]).toEqual(["click"]);
		expect([...(panel.elements["setup-remove"] as FakeElement).handlers.keys()]).toEqual(["click"]);
		expect((panel.elements["setup-status"] as FakeElement).handlers.size).toBe(0);
	});

	it("sends setup-install when the install button is clicked", () => {
		panel.send.mockClear();
		(panel.elements["setup-install"] as FakeElement).click();
		expect(panel.send).toHaveBeenCalledTimes(1);
		expect(panel.send).toHaveBeenCalledWith("sendToPlugin", { event: "setup-install" });
	});

	it("sends setup-remove when the remove button is clicked", () => {
		panel.send.mockClear();
		(panel.elements["setup-remove"] as FakeElement).click();
		expect(panel.send).toHaveBeenCalledTimes(1);
		expect(panel.send).toHaveBeenCalledWith("sendToPlugin", { event: "setup-remove" });
	});

	it("sends one message per click", () => {
		panel.send.mockClear();
		const install = panel.elements["setup-install"] as FakeElement;
		install.click();
		install.click();
		expect(panel.send).toHaveBeenCalledTimes(2);
	});

	describe("status text", () => {
		const hooksText = { true: "Hooks: installed", false: "Hooks: not installed" };
		const lineText = {
			forwarder: "Status line: installed",
			other: "Status line: another status line is in use",
			none: "Status line: not installed",
		};

		for (const hooks of [true, false]) {
			for (const statusLine of ["forwarder", "other", "none"] as const) {
				it(`describes hooks ${hooks} with status line ${statusLine}`, () => {
					panel.emit({ event: "setup-result", ok: true, status: { hooks, statusLine }, message: "" });
					expect(panel.status()).toBe(`${hooksText[String(hooks) as "true" | "false"]}. ${lineText[statusLine]}.`);
				});
			}
		}

		it("appends a non-empty message after the status", () => {
			panel.emit({ event: "setup-result", ok: true, status: { hooks: true, statusLine: "forwarder" }, message: "Installed the hooks." });
			expect(panel.status()).toBe("Hooks: installed. Status line: installed. Installed the hooks.");
		});

		it("appends nothing when the message is empty or missing", () => {
			panel.emit({ event: "setup-result", ok: true, status: { hooks: false, statusLine: "none" }, message: "" });
			expect(panel.status()).toBe("Hooks: not installed. Status line: not installed.");
			panel.emit({ event: "setup-result", ok: true, status: { hooks: true, statusLine: "other" } });
			expect(panel.status()).toBe("Hooks: installed. Status line: another status line is in use.");
		});

		it("describes a failed result with its message", () => {
			panel.emit({ event: "setup-result", ok: false, message: "settings.json is not valid JSON" });
			expect(panel.status()).toBe("Could not check or change the Claude settings: settings.json is not valid JSON");
		});

		it("describes a failed result even when status is present", () => {
			panel.emit({ event: "setup-result", ok: false, status: { hooks: true, statusLine: "forwarder" }, message: "boom" });
			expect(panel.status()).toBe("Could not check or change the Claude settings: boom");
		});

		it("handles a result nested under payload", () => {
			panel.emit({ payload: { event: "setup-result", ok: true, status: { hooks: true, statusLine: "none" }, message: "Done." } });
			expect(panel.status()).toBe("Hooks: installed. Status line: not installed. Done.");
		});

		it("handles a failed result nested under payload", () => {
			panel.emit({ payload: { event: "setup-result", ok: false, message: "denied" } });
			expect(panel.status()).toBe("Could not check or change the Claude settings: denied");
		});

		it("handles a result delivered flat", () => {
			panel.emit({ event: "setup-result", ok: true, status: { hooks: false, statusLine: "forwarder" }, message: "" });
			expect(panel.status()).toBe("Hooks: not installed. Status line: installed.");
		});

		it("replaces the previous text with each new result", () => {
			panel.emit({ event: "setup-result", ok: true, status: { hooks: true, statusLine: "forwarder" }, message: "first" });
			panel.emit({ event: "setup-result", ok: true, status: { hooks: false, statusLine: "none" }, message: "second" });
			expect(panel.status()).toBe("Hooks: not installed. Status line: not installed. second");
		});
	});

	describe("ignored messages", () => {
		const ignored: [string, unknown][] = [
			["another event name", { event: "other", ok: true, status: { hooks: true, statusLine: "forwarder" } }],
			["another event name under payload", { payload: { event: "other", ok: false, message: "x" } }],
			["a message without an event", { ok: true }],
			["null", null],
			["undefined", undefined],
			["a string", "setup-result"],
			["a number", 42],
			["zero", 0],
			["true", true],
			["an empty object", {}],
			["an array", []],
		];
		for (const [label, message] of ignored) {
			it(`leaves the text unchanged for ${label}`, () => {
				panel.emit(message);
				expect(panel.status()).toBe("Checking...");
			});
		}

		it("keeps an earlier result when an unrelated message arrives", () => {
			panel.emit({ event: "setup-result", ok: false, message: "kept" });
			panel.emit(null);
			panel.emit({ event: "something-else" });
			expect(panel.status()).toBe("Could not check or change the Claude settings: kept");
		});
	});
});

describe("setup panel markup", () => {
	it("has an element for every id the script reads", () => {
		for (const id of ["setup-status", "setup-install", "setup-remove"]) {
			expect(HTML).toMatch(new RegExp(`id="${id}"`));
			expect(SCRIPT).toContain(`"${id}"`);
		}
	});

	it("uses buttons for the install and remove controls and a paragraph for the status", () => {
		expect(HTML).toMatch(/<sdpi-button id="setup-install"/);
		expect(HTML).toMatch(/<sdpi-button id="setup-remove"/);
		expect(HTML).toMatch(/<p id="setup-status"/);
	});

	it("loads sdpi-components.js from the same folder", () => {
		expect(HTML).toMatch(/<script src="sdpi-components\.js"><\/script>/);
		expect(existsSync(resolve(UI_DIR, "sdpi-components.js"))).toBe(true);
	});

	it("loads sdpi-components.js before the inline script", () => {
		expect(HTML.indexOf('src="sdpi-components.js"')).toBeLessThan(HTML.indexOf("<script>"));
	});

	it("declares the alert controls as global settings", () => {
		for (const name of ["alertSound", "alertToast", "alertOnDone", "escalateMinutes"]) {
			const tag = new RegExp(`<sdpi-[a-z]+ [^>]*setting="${name}"[^>]*>`).exec(HTML);
			expect(tag, name).not.toBeNull();
			expect(tag?.[0]).toMatch(/\sglobal(\s|>|=)/);
		}
	});

	it("marks every setting in the page as global", () => {
		const settings = HTML.match(/<sdpi-[a-z]+ [^>]*setting="[^"]+"[^>]*>/g) ?? [];
		expect(settings).toHaveLength(4);
		for (const tag of settings) {
			expect(tag).toMatch(/\sglobal(\s|>|=)/);
		}
	});

	it("offers escalation choices that parse to numbers", () => {
		const select = /<sdpi-select setting="escalateMinutes"[^>]*>([\s\S]*?)<\/sdpi-select>/.exec(HTML) as RegExpExecArray;
		const values = [...(select[1] as string).matchAll(/value="(\d+)"/g)].map((m) => m[1] as string);
		expect(values).toEqual(["0", "1", "2", "3", "5", "10"]);
		for (const value of values) {
			expect(parseAlertSettings({ escalateMinutes: value }).escalateMinutes).toBe(Number(value));
		}
	});
});

describe("setup panel and alert settings keys", () => {
	it("reads alertSound as the sound setting", () => {
		expect(parseAlertSettings({}).sound).toBe(true);
		expect(parseAlertSettings({ alertSound: false }).sound).toBe(false);
		expect(parseAlertSettings({ sound: false }).sound).toBe(true);
	});

	it("reads alertToast as the toast setting", () => {
		expect(parseAlertSettings({}).toast).toBe(true);
		expect(parseAlertSettings({ alertToast: false }).toast).toBe(false);
		expect(parseAlertSettings({ toast: false }).toast).toBe(true);
	});

	it("reads alertOnDone as the finished-turn setting", () => {
		expect(parseAlertSettings({}).onDone).toBe(false);
		expect(parseAlertSettings({ alertOnDone: true }).onDone).toBe(true);
		expect(parseAlertSettings({ onDone: true }).onDone).toBe(false);
	});

	it("reads escalateMinutes as the escalation setting", () => {
		expect(parseAlertSettings({}).escalateMinutes).toBe(DEFAULT_ALERT_SETTINGS.escalateMinutes);
		expect(parseAlertSettings({ escalateMinutes: 10 }).escalateMinutes).toBe(10);
		expect(parseAlertSettings({ escalateMinutes: "5" }).escalateMinutes).toBe(5);
		expect(parseAlertSettings({ escalateMinutes: "0" }).escalateMinutes).toBe(0);
	});
});

describe("setup panel and plugin message names", () => {
	const names = ["setup-check", "setup-install", "setup-remove", "setup-result"];

	it("uses the message names in the script", () => {
		for (const name of names) {
			expect(SCRIPT).toContain(`"${name}"`);
		}
	});

	it("handles and answers the same names in the plugin source", () => {
		for (const name of names) {
			expect(PLUGIN_SOURCE, name).toMatch(new RegExp(`"${name}"`));
		}
	});
});
