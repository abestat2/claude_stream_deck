import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step } from "../../src/input/sequence";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

type FakeStream = PassThrough & { unref: ReturnType<typeof vi.fn> };

type FakeChild = EventEmitter & {
	stdin: FakeStream;
	stdout: FakeStream;
	stderr: FakeStream;
	unref: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
	/** Lines the module has written to the helper's stdin. */
	written: string[];
	/** Prints one line on the helper's stdout. */
	print(line: string): void;
};

function fakeStream(): FakeStream {
	return Object.assign(new PassThrough(), { unref: vi.fn() });
}

function fakeChild(): FakeChild {
	const stdin = fakeStream();
	const written: string[] = [];
	let buffer = "";
	stdin.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		written.push(...lines);
	});
	const stdout = fakeStream();
	return Object.assign(new EventEmitter(), {
		stdin,
		stdout,
		stderr: fakeStream(),
		unref: vi.fn(),
		kill: vi.fn(),
		written,
		print: (line: string) => {
			stdout.write(line + "\n");
		},
	});
}

/** Lets stream and readline events run. Only setTimeout and clearTimeout are faked. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const text = (value: string): Step => ({ type: "text", value });
const enter: Step = { type: "key", vk: 0x0d, extended: false, modifiers: [] };

type Keyboard = Awaited<ReturnType<typeof load>>;

let child: FakeChild;

async function load() {
	vi.resetModules();
	return (await import("../../src/input/keyboard")).keyboard;
}

/** Starts the helper and answers with `ready`. */
async function startReady(keyboard: Keyboard) {
	const started = keyboard.start();
	child.print("ready");
	await started;
}

const idOf = (line: string | undefined) => (JSON.parse(line as string) as { id: number }).id;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	spawnMock.mockReset();
	child = fakeChild();
	spawnMock.mockReturnValue(child);
});

afterEach(() => {
	vi.useRealTimers();
	vi.resetModules();
});

describe("keyboard", () => {
	describe("send", () => {
		it("resolves without starting a process when there are no steps", async () => {
			const keyboard = await load();
			await expect(keyboard.send([])).resolves.toBeUndefined();
			expect(spawnMock).not.toHaveBeenCalled();
		});

		it("starts the helper on the first send and waits for ready before writing", async () => {
			const keyboard = await load();
			const sent = keyboard.send([text("hi")]);
			await flush();
			expect(spawnMock).toHaveBeenCalledTimes(1);
			expect(child.written).toEqual([]);

			child.print("ready");
			await flush();
			expect(child.written).toHaveLength(1);

			child.print("ok 1");
			await expect(sent).resolves.toBeUndefined();
		});

		it("reuses the running helper for later sends", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const first = keyboard.send([text("a")]);
			await flush();
			child.print("ok 1");
			await first;
			const second = keyboard.send([text("b")]);
			await flush();
			child.print("ok 2");
			await second;
			expect(spawnMock).toHaveBeenCalledTimes(1);
		});
	});

	describe("helper process", () => {
		it("spawns PowerShell with the helper script and hidden window", async () => {
			const keyboard = await load();
			void keyboard.start();
			expect(spawnMock).toHaveBeenCalledTimes(1);
			const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], { windowsHide: boolean }];
			expect(command).toBe("powershell.exe");
			expect(args.slice(0, 6)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
			expect(args).toHaveLength(7);
			expect(options).toEqual({ windowsHide: true });
		});

		it("points at scripts/send-keys.ps1", async () => {
			const keyboard = await load();
			void keyboard.start();
			const args = spawnMock.mock.calls[0]?.[1] as string[];
			expect(args[6]?.replace(/\\/g, "/")).toMatch(/\/scripts\/send-keys\.ps1$/);
		});

		it("ships the helper script in the plugin folder", () => {
			const script = new URL("../../com.claudedeck.controls.sdPlugin/scripts/send-keys.ps1", import.meta.url);
			expect(existsSync(script)).toBe(true);
		});

		it("unrefs the process and its three streams", async () => {
			const keyboard = await load();
			void keyboard.start();
			expect(child.unref).toHaveBeenCalledTimes(1);
			expect(child.stdin.unref).toHaveBeenCalledTimes(1);
			expect(child.stdout.unref).toHaveBeenCalledTimes(1);
			expect(child.stderr.unref).toHaveBeenCalledTimes(1);
		});

		it("returns the same promise and spawns once when start is called twice", async () => {
			const keyboard = await load();
			const first = keyboard.start();
			const second = keyboard.start();
			expect(second).toBe(first);
			expect(spawnMock).toHaveBeenCalledTimes(1);
			child.print("ready");
			await first;
			expect(keyboard.start()).toBe(first);
			expect(spawnMock).toHaveBeenCalledTimes(1);
		});

		it("resolves start only when the helper prints ready", async () => {
			const keyboard = await load();
			const started = keyboard.start();
			let resolved = false;
			void started.then(() => (resolved = true));
			await flush();
			expect(resolved).toBe(false);
			child.print("  ready  ");
			await expect(started).resolves.toBeUndefined();
		});

		it("rejects start when the helper exits before printing ready", async () => {
			const keyboard = await load();
			const started = keyboard.start();
			child.emit("exit", 1);
			await expect(started).rejects.toThrow("Keyboard helper exited with code 1");
		});

		it("rejects start when the process cannot be spawned", async () => {
			const keyboard = await load();
			const started = keyboard.start();
			child.emit("error", new Error("spawn powershell.exe ENOENT"));
			await expect(started).rejects.toThrow("spawn powershell.exe ENOENT");
		});

		it("starts a fresh helper after a failed start", async () => {
			const keyboard = await load();
			const failed = keyboard.start();
			child.emit("exit", 1);
			await expect(failed).rejects.toThrow();

			child = fakeChild();
			spawnMock.mockReturnValue(child);
			const started = keyboard.start();
			child.print("ready");
			await expect(started).resolves.toBeUndefined();
			expect(spawnMock).toHaveBeenCalledTimes(2);
		});
	});

	describe("command format", () => {
		it("writes one JSON line per command with the step delay and steps", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const steps = [text("hello"), enter];
			const sent = keyboard.send(steps);
			await flush();
			expect(child.written).toHaveLength(1);
			expect(JSON.parse(child.written[0] as string)).toEqual({ id: 1, delayMs: 40, steps });
			child.print("ok 1");
			await sent;
		});

		it("increases the id for each command", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const a = keyboard.send([text("a")]);
			const b = keyboard.send([text("b")]);
			const c = keyboard.send([text("c")]);
			await flush();
			expect(child.written.map(idOf)).toEqual([1, 2, 3]);
			child.print("ok 1");
			child.print("ok 2");
			child.print("ok 3");
			await Promise.all([a, b, c]);
		});

		it("escapes non-ASCII characters and the text parses back unchanged", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const value = "café 中文 \u007f \u{1F600} \u{1D11E}";
			const sent = keyboard.send([text(value)]);
			await flush();
			const line = child.written[0] as string;
			expect(line).toMatch(/^[\x00-\x7e]*$/);
			expect(line).toContain("\\u00e9");
			expect(line).toContain("\\u4e2d");
			expect(line).toContain("\\ud83d\\ude00");
			expect((JSON.parse(line) as { steps: Step[] }).steps).toEqual([text(value)]);
			child.print("ok 1");
			await sent;
		});

		it("keeps ASCII text unescaped", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text('plain "quoted" text')]);
			await flush();
			expect(child.written[0]).toBe(JSON.stringify({ id: 1, delayMs: 40, steps: [text('plain "quoted" text')] }));
			child.print("ok 1");
			await sent;
		});
	});

	describe("replies", () => {
		it("resolves a command on ok", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.print("ok 1");
			await expect(sent).resolves.toBeUndefined();
		});

		it("rejects a command with the message of err", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.print("err 1 window not found");
			await expect(sent).rejects.toThrow("window not found");
		});

		it("rejects with a default message when err has no message", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.print("err 1");
			await expect(sent).rejects.toThrow("Keyboard helper reported an error");
		});

		it("ignores replies for unknown ids and unparsable lines", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			let settled = false;
			sent.then(
				() => (settled = true),
				() => (settled = true),
			);
			await flush();
			child.print("ok 99");
			child.print("err 42 nope");
			child.print("garbage");
			child.print("");
			child.print("ok");
			child.print("ok abc");
			await flush();
			expect(settled).toBe(false);
			child.print("ok 1");
			await expect(sent).resolves.toBeUndefined();
		});

		it("resolves concurrent commands independently and out of order", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const results: string[] = [];
			const a = keyboard.send([text("a")]).then(() => results.push("a"));
			const b = keyboard.send([text("b")]).then(
				() => results.push("b"),
				(err: Error) => results.push(`b:${err.message}`),
			);
			const c = keyboard.send([text("c")]).then(() => results.push("c"));
			await flush();

			child.print("ok 3");
			await flush();
			expect(results).toEqual(["c"]);
			child.print("err 2 boom");
			await flush();
			expect(results).toEqual(["c", "b:boom"]);
			child.print("ok 1");
			await Promise.all([a, b, c]);
			expect(results).toEqual(["c", "b:boom", "a"]);
		});

		it("does not treat a later ready line as a reply", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.print("ready");
			child.print("ok 1");
			await expect(sent).resolves.toBeUndefined();
		});
	});

	describe("timeout", () => {
		it("rejects a command that gets no reply after 10 seconds", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const outcome = keyboard.send([text("a")]).then(
				() => "resolved",
				(err: Error) => err.message,
			);
			await flush();
			vi.advanceTimersByTime(9_999);
			let early = "pending";
			void outcome.then((value) => (early = value));
			await flush();
			expect(early).toBe("pending");
			vi.advanceTimersByTime(1);
			await expect(outcome).resolves.toBe("Keyboard helper timed out");
		});

		it("ignores a late reply for a timed-out command", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const outcome = keyboard.send([text("a")]).then(
				() => "resolved",
				(err: Error) => err.message,
			);
			await flush();
			vi.advanceTimersByTime(10_000);
			await expect(outcome).resolves.toBe("Keyboard helper timed out");

			child.print("ok 1");
			await flush();
			const next = keyboard.send([text("b")]);
			await flush();
			expect(idOf(child.written[1])).toBe(2);
			child.print("ok 2");
			await expect(next).resolves.toBeUndefined();
		});

		it("clears the timer of an answered command", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.print("ok 1");
			await sent;
			expect(vi.getTimerCount()).toBe(0);
		});
	});

	describe("helper exit", () => {
		it("rejects all pending commands with the exit code", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const outcomes = Promise.allSettled([keyboard.send([text("a")]), keyboard.send([text("b")])]);
			await flush();
			child.emit("exit", 3);
			const [ra, rb] = await outcomes;
			expect(ra).toMatchObject({ status: "rejected", reason: { message: "Keyboard helper exited with code 3" } });
			expect(rb).toMatchObject({ status: "rejected", reason: { message: "Keyboard helper exited with code 3" } });
			expect(vi.getTimerCount()).toBe(0);
		});

		it("includes the trimmed stderr text in the error", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.stderr.write("Add-Type failed\r\n");
			await flush();
			child.emit("exit", 1);
			await expect(sent).rejects.toThrow("Keyboard helper exited with code 1: Add-Type failed");
		});

		it("includes stderr text when the helper exits before ready", async () => {
			const keyboard = await load();
			const started = keyboard.start();
			child.stderr.write("script blocked");
			await flush();
			child.emit("exit", 1);
			await expect(started).rejects.toThrow("Keyboard helper exited with code 1: script blocked");
		});

		it("starts a fresh helper on the next send", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			child.emit("exit", 0);

			const second = fakeChild();
			spawnMock.mockReturnValue(second);
			const sent = keyboard.send([text("again")]);
			await flush();
			expect(spawnMock).toHaveBeenCalledTimes(2);
			second.print("ready");
			await flush();
			expect(second.written).toHaveLength(1);
			second.print(`ok ${idOf(second.written[0])}`);
			await expect(sent).resolves.toBeUndefined();
		});

		it("rejects pending commands when the process emits an error", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			const sent = keyboard.send([text("a")]);
			await flush();
			child.emit("error", new Error("pipe broke"));
			await expect(sent).rejects.toThrow("pipe broke");
		});
	});

	describe("stop", () => {
		it("ends stdin and kills the process", async () => {
			const keyboard = await load();
			await startReady(keyboard);
			keyboard.stop();
			expect(child.stdin.writableEnded).toBe(true);
			expect(child.kill).toHaveBeenCalledTimes(1);
		});

		it("does nothing when no helper was started", async () => {
			const keyboard = await load();
			expect(() => keyboard.stop()).not.toThrow();
			expect(spawnMock).not.toHaveBeenCalled();
		});
	});
});
