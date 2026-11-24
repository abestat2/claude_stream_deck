import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/install-hooks.mjs");
const URL_DEFAULT = "http://127.0.0.1:47831/event";
const EVENT_COUNT = 14;

let dir: string;
let file: string;

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [SCRIPT, "--file", file, ...args], { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const read = () => JSON.parse(readFileSync(file, "utf8"));
const write = (value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

const ours = (url = URL_DEFAULT) => ({ type: "http", url, timeout: 2 });
const other = { type: "command", command: "echo hi" };

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "install-hooks-"));
	file = join(dir, "settings.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("install-hooks install", () => {
	it("creates the settings file when it does not exist", () => {
		const result = run();
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Installed hooks in");
		expect(Object.keys(read().hooks)).toHaveLength(EVENT_COUNT);
	});

	it("does not create a backup when there was no file", () => {
		run();
		expect(existsSync(`${file}.bak`)).toBe(false);
	});

	it("adds one http hook per event pointing at the receiver", () => {
		run();
		const { hooks } = read();
		for (const event of ["SessionStart", "Stop", "SubagentStop", "PermissionRequest", "Notification"]) {
			expect(hooks[event]).toEqual([{ hooks: [ours()] }]);
		}
	});

	it("is idempotent", () => {
		run();
		const first = readFileSync(file, "utf8");
		run();
		expect(readFileSync(file, "utf8")).toBe(first);
		for (const groups of Object.values(read().hooks) as unknown[][]) {
			expect(groups).toHaveLength(1);
		}
	});

	it("preserves unrelated settings", () => {
		write({ model: "opus", permissions: { allow: ["Bash(ls)"] }, env: { A: "1" } });
		run();
		const settings = read();
		expect(settings.model).toBe("opus");
		expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
		expect(settings.env).toEqual({ A: "1" });
	});

	it("preserves existing hooks for the same event and appends the new one after them", () => {
		write({ hooks: { Stop: [{ matcher: "x", hooks: [other] }] } });
		run();
		expect(read().hooks.Stop).toEqual([{ matcher: "x", hooks: [other] }, { hooks: [ours()] }]);
	});

	it("preserves hooks for events the script does not manage", () => {
		write({ hooks: { CustomEvent: [{ hooks: [other] }] } });
		run();
		expect(read().hooks.CustomEvent).toEqual([{ hooks: [other] }]);
	});

	it("leaves an http hook with a different URL alone", () => {
		const foreign = { type: "http", url: "http://example.invalid/event" };
		write({ hooks: { Stop: [{ hooks: [foreign] }] } });
		run();
		expect(read().hooks.Stop[0]).toEqual({ hooks: [foreign] });
	});

	it("writes a backup identical to the previous file", () => {
		write({ model: "opus" });
		const before = readFileSync(file, "utf8");
		run();
		expect(readFileSync(`${file}.bak`, "utf8")).toBe(before);
	});

	it("overwrites the backup with the file as it was before the latest run", () => {
		write({ model: "opus" });
		run();
		const afterFirst = readFileSync(file, "utf8");
		run();
		expect(readFileSync(`${file}.bak`, "utf8")).toBe(afterFirst);
	});

	it("uses the port given with --port", () => {
		run("--port", "50000");
		expect(read().hooks.Stop[0].hooks[0].url).toBe("http://127.0.0.1:50000/event");
	});

	it("keeps hooks for another port when installing a different one", () => {
		run("--port", "50000");
		run();
		const groups = read().hooks.Stop;
		expect(groups.map((g: { hooks: { url: string }[] }) => g.hooks[0]?.url)).toEqual([
			"http://127.0.0.1:50000/event",
			URL_DEFAULT,
		]);
	});

	it("ends the file with a newline and indents with two spaces", () => {
		run();
		const text = readFileSync(file, "utf8");
		expect(text.endsWith("}\n")).toBe(true);
		expect(text).toContain('\n  "hooks": {');
	});

	it("fails without modifying the file when it is not valid JSON", () => {
		writeFileSync(file, "{ not json");
		const result = run();
		expect(result.status).not.toBe(0);
		expect(readFileSync(file, "utf8")).toBe("{ not json");
		expect(existsSync(`${file}.bak`)).toBe(false);
	});
});

describe("install-hooks --remove", () => {
	it("removes every hook and the hooks key when only the plugin hooks existed", () => {
		write({ model: "opus" });
		run();
		const result = run("--remove");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Removed hooks from");
		expect(read()).toEqual({ model: "opus" });
	});

	it("restores the original settings exactly when other hooks existed", () => {
		const original = {
			model: "opus",
			hooks: { Stop: [{ matcher: "x", hooks: [other] }], PreToolUse: [{ hooks: [other, other] }] },
		};
		write(original);
		run();
		run("--remove");
		expect(read()).toEqual(original);
	});

	it("keeps other hooks that share a group with the plugin hook", () => {
		write({ hooks: { Stop: [{ matcher: "m", hooks: [other, ours()] }] } });
		run("--remove");
		expect(read().hooks).toEqual({ Stop: [{ matcher: "m", hooks: [other] }] });
	});

	it("drops groups that become empty and events with no groups left", () => {
		write({ hooks: { Stop: [{ hooks: [ours()] }], Notification: [{ hooks: [ours()] }, { hooks: [other] }] } });
		run("--remove");
		expect(read().hooks).toEqual({ Notification: [{ hooks: [other] }] });
	});

	it("is idempotent", () => {
		write({ model: "opus", hooks: { Stop: [{ hooks: [other] }] } });
		run();
		run("--remove");
		const first = readFileSync(file, "utf8");
		run("--remove");
		expect(readFileSync(file, "utf8")).toBe(first);
	});

	it("only removes hooks for the selected port", () => {
		run("--port", "50000");
		run();
		run("--remove", "--port", "50000");
		const urls = read().hooks.Stop.map((g: { hooks: { url: string }[] }) => g.hooks[0]?.url);
		expect(urls).toEqual([URL_DEFAULT]);
	});

	it("writes a backup of the file as it was before removal", () => {
		run();
		const installed = readFileSync(file, "utf8");
		run("--remove");
		expect(readFileSync(`${file}.bak`, "utf8")).toBe(installed);
	});

	it("leaves an empty object when the file had only plugin hooks", () => {
		run();
		run("--remove");
		expect(read()).toEqual({});
	});

	it("creates an empty settings file when there is nothing to remove from", () => {
		run("--remove");
		expect(read()).toEqual({});
	});
});
