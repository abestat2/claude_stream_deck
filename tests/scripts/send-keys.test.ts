import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/send-keys.ps1");
const TIMEOUT = 60_000;
const CTRL_J = "key 74 17";

type Helper = {
	process: ChildProcessWithoutNullStreams;
	lines: string[];
	/** Sends one command and resolves with the output lines up to and including its ok or err line. */
	run: (steps: unknown[], id?: number) => Promise<string[]>;
	/** Sends a raw line and resolves with the output up to the next ok or err line. */
	raw: (line: string) => Promise<string[]>;
	stop: () => void;
};

/** Starts the helper in dry-run mode; the environment always carries CLAUDE_DECK_DRY_RUN=1. */
async function startHelper(clipboard: string): Promise<Helper> {
	const env = { ...process.env, CLAUDE_DECK_DRY_RUN: "1", CLAUDE_DECK_CLIPBOARD: clipboard };
	if (env.CLAUDE_DECK_DRY_RUN !== "1") {
		throw new Error("dry-run mode is not enabled");
	}
	const child = spawn(
		"powershell.exe",
		["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT],
		{ env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
	) as ChildProcessWithoutNullStreams;

	const lines: string[] = [];
	const waiters: (() => void)[] = [];
	createInterface({ input: child.stdout }).on("line", (line) => {
		lines.push(line);
		for (const waiter of waiters.splice(0)) waiter();
	});

	const take = (done: (collected: string[]) => boolean): Promise<string[]> =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`timed out waiting for helper output: ${JSON.stringify(lines)}`)), 30_000);
			const check = (): void => {
				if (done(lines)) {
					clearTimeout(timer);
					resolve(lines.splice(0, lines.length));
				} else {
					waiters.push(check);
				}
			};
			check();
		});

	/** Re-serializes the JSON string of a text line so that equivalent escapes compare equal. */
	const normalize = (line: string): string => (line.startsWith("text ") ? text(JSON.parse(line.slice(5)) as string) : line);
	const finished = (collected: string[]): boolean => collected.some((line) => /^(ok|err)( |$)/.test(line));
	const raw = (line: string): Promise<string[]> => {
		const result = take(finished).then((collected) => collected.map(normalize));
		child.stdin.write(`${line}\n`);
		return result;
	};

	const first = await take((collected) => collected.includes("ready"));
	expect(first).toEqual(["ready"]);

	return {
		process: child,
		lines,
		raw,
		run: (steps, id = 1) => raw(JSON.stringify({ id, delayMs: 0, steps })),
		stop: () => {
			child.stdin.end();
			child.kill();
		},
	};
}

const text = (value: string) => `text ${JSON.stringify(value)}`;
const clipboard = { type: "clipboard" };

describe.skipIf(process.platform !== "win32")("send-keys.ps1 dry run", () => {
	describe("steps", () => {
		let helper: Helper;

		beforeAll(async () => {
			helper = await startHelper("one\r\ntwo");
		}, TIMEOUT);

		afterAll(() => helper?.stop());

		it("prints a text step as a JSON string", async () => {
			expect(await helper.run([{ type: "text", value: 'say "hi" {x}\\' }], 5)).toEqual([text('say "hi" {x}\\'), "ok 5"]);
		}, TIMEOUT);

		it("prints a key step with its virtual key and modifiers", async () => {
			expect(await helper.run([{ type: "key", vk: 13, extended: false, modifiers: [] }])).toEqual(["key 13 ", "ok 1"]);
			expect(await helper.run([{ type: "key", vk: 9, extended: false, modifiers: [16] }])).toEqual(["key 9 16", "ok 1"]);
			expect(await helper.run([{ type: "key", vk: 67, extended: false, modifiers: [17, 16] }])).toEqual(["key 67 17+16", "ok 1"]);
		}, TIMEOUT);

		it("prints text and keys in order for a mixed command", async () => {
			const steps = [
				{ type: "text", value: "explain: " },
				clipboard,
				{ type: "key", vk: 13, extended: false, modifiers: [] },
			];
			expect(await helper.run(steps, 7)).toEqual([text("explain: "), text("one"), CTRL_J, text("two"), "key 13 ", "ok 7"]);
		}, TIMEOUT);

		it("accepts a command without steps", async () => {
			expect(await helper.run([], 3)).toEqual(["ok 3"]);
		}, TIMEOUT);

		it("reports an unknown step type", async () => {
			expect(await helper.run([{ type: "wave" }], 9)).toEqual(["err 9 Unknown step type 'wave'"]);
		}, TIMEOUT);

		it("stops a command at the first failing step", async () => {
			const out = await helper.run([{ type: "text", value: "a" }, { type: "wave" }, { type: "text", value: "b" }], 4);
			expect(out).toEqual([text("a"), "err 4 Unknown step type 'wave'"]);
		}, TIMEOUT);

		it("reports malformed JSON and keeps running", async () => {
			const out = await helper.raw("{not json");
			expect(out).toHaveLength(1);
			expect(out[0]).toMatch(/^err /);
			expect(await helper.run([{ type: "text", value: "after" }], 11)).toEqual([text("after"), "ok 11"]);
		}, TIMEOUT);

		it("ignores blank input lines", async () => {
			helper.process.stdin.write("\n   \n");
			expect(await helper.run([{ type: "text", value: "x" }], 12)).toEqual([text("x"), "ok 12"]);
		}, TIMEOUT);
	});

	describe("clipboard step", () => {
		const cases: [string, string, string[]][] = [
			["a single line", "hello world", [text("hello world")]],
			["lines separated by LF", "a\nb\nc", [text("a"), CTRL_J, text("b"), CTRL_J, text("c")]],
			["lines separated by CRLF", "a\r\nb\r\nc", [text("a"), CTRL_J, text("b"), CTRL_J, text("c")]],
			["blank lines between text", "a\n\nb", [text("a"), CTRL_J, CTRL_J, text("b")]],
			["blank lines with CRLF", "a\r\n\r\n\r\nb", [text("a"), CTRL_J, CTRL_J, CTRL_J, text("b")]],
			["leading blank lines", "\n\na", [CTRL_J, CTRL_J, text("a")]],
			["trailing line breaks", "a\nb\r\n\r\n\n", [text("a"), CTRL_J, text("b")]],
			["a single trailing line break", "line\n", [text("line")]],
			["quotes and braces", 'say "hi" {Enter} {{x}} \\ \'q\'', [text('say "hi" {Enter} {{x}} \\ \'q\'')]],
			["leading and inner spaces", "  a  b\n  c", [text("  a  b"), CTRL_J, text("  c")]],
		];

		// The clipboard contents are fixed when the helper starts, so each case uses its own process.
		it.each(cases)("types %s", async (_name, value, expected) => {
			const helper = await startHelper(value);
			try {
				expect(await helper.run([clipboard], 2)).toEqual([...expected, "ok 2"]);
			} finally {
				helper.stop();
			}
		}, TIMEOUT);
	});

	describe("clipboard limits", () => {
		it("truncates text longer than 10000 characters to exactly 10000", async () => {
			const helper = await startHelper("x".repeat(10_050));
			try {
				const out = await helper.run([clipboard]);
				expect(out).toHaveLength(2);
				const typed = JSON.parse((out[0] as string).slice("text ".length)) as string;
				expect(typed).toBe("x".repeat(10_000));
				expect(out[1]).toBe("ok 1");
			} finally {
				helper.stop();
			}
		}, TIMEOUT);

		it("keeps text of exactly 10000 characters whole", async () => {
			const helper = await startHelper("y".repeat(10_000));
			try {
				const out = await helper.run([clipboard]);
				expect(JSON.parse((out[0] as string).slice("text ".length))).toBe("y".repeat(10_000));
			} finally {
				helper.stop();
			}
		}, TIMEOUT);

		it("truncates across lines using the total length", async () => {
			const helper = await startHelper(`${"a".repeat(9_998)}\nbcd`);
			try {
				const out = await helper.run([clipboard]);
				expect(out).toEqual([text("a".repeat(9_998)), CTRL_J, text("b"), "ok 1"]);
			} finally {
				helper.stop();
			}
		}, TIMEOUT);

		it("drops a line break left at the end by truncation", async () => {
			const helper = await startHelper(`${"a".repeat(9_999)}\r\nbcd`);
			try {
				const out = await helper.run([clipboard]);
				expect(out).toEqual([text("a".repeat(9_999)), "ok 1"]);
			} finally {
				helper.stop();
			}
		}, TIMEOUT);

		it("prints nothing for a clipboard holding only line breaks", async () => {
			const helper = await startHelper("\r\n\r\n");
			try {
				expect(await helper.run([clipboard], 6)).toEqual(["ok 6"]);
			} finally {
				helper.stop();
			}
		}, TIMEOUT);
	});
});
