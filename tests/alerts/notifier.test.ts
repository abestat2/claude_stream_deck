import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { createNotifier } from "../../src/alerts/notifier";

type FakeChild = EventEmitter & { unref: ReturnType<typeof vi.fn> };

function fakeChild(): FakeChild {
	return Object.assign(new EventEmitter(), { unref: vi.fn() });
}

let child: FakeChild;
let errors: string[];

beforeEach(() => {
	spawnMock.mockReset();
	child = fakeChild();
	spawnMock.mockReturnValue(child);
	errors = [];
});

function lastCall() {
	const call = spawnMock.mock.calls[spawnMock.mock.calls.length - 1] as [string, string[], { env: Record<string, string>; stdio: string; windowsHide: boolean }];
	return { command: call[0], args: call[1], options: call[2] };
}

describe("createNotifier", () => {
	const alert = { title: "Claude needs you", body: "demo - Bash: rm -rf /tmp/x", sound: true, toast: false };

	it("does not spawn until an alert is raised", () => {
		createNotifier((m) => errors.push(m));
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("runs the notification script with PowerShell", () => {
		createNotifier((m) => errors.push(m))(alert);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const { command, args, options } = lastCall();
		expect(command).toBe("powershell.exe");
		expect(args).toContain("-File");
		expect(args[args.indexOf("-File") + 1]).toMatch(/notify\.ps1$/);
		expect(options.windowsHide).toBe(true);
		expect(options.stdio).toBe("ignore");
	});

	it("passes alert fields through environment variables", () => {
		createNotifier((m) => errors.push(m))(alert);
		const { env } = lastCall().options;
		expect(env.CLAUDE_DECK_TITLE).toBe("Claude needs you");
		expect(env.CLAUDE_DECK_BODY).toBe("demo - Bash: rm -rf /tmp/x");
		expect(env.CLAUDE_DECK_SOUND).toBe("1");
		expect(env.CLAUDE_DECK_TOAST).toBe("0");
	});

	it("encodes the flags as 1 and 0", () => {
		const notify = createNotifier((m) => errors.push(m));
		notify({ ...alert, sound: false, toast: true });
		expect(lastCall().options.env.CLAUDE_DECK_SOUND).toBe("0");
		expect(lastCall().options.env.CLAUDE_DECK_TOAST).toBe("1");
	});

	it("never places alert text in the argument list", () => {
		const text = { title: "T\"itle'; calc", body: "$(whoami) `id` & more", sound: true, toast: true };
		createNotifier((m) => errors.push(m))(text);
		const { args } = lastCall();
		for (const arg of args) {
			expect(arg).not.toContain(text.title);
			expect(arg).not.toContain(text.body);
			expect(arg).not.toContain("whoami");
		}
		expect(lastCall().options.env.CLAUDE_DECK_TITLE).toBe(text.title);
		expect(lastCall().options.env.CLAUDE_DECK_BODY).toBe(text.body);
	});

	it("keeps the inherited environment", () => {
		createNotifier((m) => errors.push(m))(alert);
		expect(lastCall().options.env.PATH ?? lastCall().options.env.Path).toBe(process.env.PATH ?? process.env.Path);
	});

	it("detaches the child with unref", () => {
		createNotifier((m) => errors.push(m))(alert);
		expect(child.unref).toHaveBeenCalledTimes(1);
	});

	it("reports an asynchronous spawn error through onError", () => {
		createNotifier((m) => errors.push(m))(alert);
		expect(() => child.emit("error", new Error("spawn ENOENT"))).not.toThrow();
		expect(errors).toEqual(["Notification failed: spawn ENOENT"]);
	});

	it("reports a thrown Error through onError without throwing", () => {
		spawnMock.mockImplementation(() => {
			throw new Error("boom");
		});
		const notify = createNotifier((m) => errors.push(m));
		expect(() => notify(alert)).not.toThrow();
		expect(errors).toEqual(["Notification failed: boom"]);
	});

	it("reports a thrown non-Error value through onError", () => {
		spawnMock.mockImplementation(() => {
			throw "plain failure";
		});
		const notify = createNotifier((m) => errors.push(m));
		expect(() => notify(alert)).not.toThrow();
		expect(errors).toEqual(["Notification failed: plain failure"]);
	});

	it("can raise several alerts", () => {
		const notify = createNotifier((m) => errors.push(m));
		notify(alert);
		notify(alert);
		expect(spawnMock).toHaveBeenCalledTimes(2);
	});
});
