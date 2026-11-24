import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/install-hooks.mjs");
const FORWARDER = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/statusline-forward.mjs");
const URL_DEFAULT = "http://127.0.0.1:47831/event";

let dir: string;
let file: string;

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [SCRIPT, "--file", file, ...args], { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const read = () => JSON.parse(readFileSync(file, "utf8"));
const write = (value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const check = (...args: string[]) => JSON.parse(run("--check", ...args).stdout.trim());

const foreign = { type: "command", command: "echo my-status" };

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "install-statusline-"));
	file = join(dir, "settings.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("install-hooks --statusline", () => {
	it("does not set a status line without the flag", () => {
		run();
		expect(read().statusLine).toBeUndefined();
	});

	it("installs the forwarder when no status line exists", () => {
		const result = run("--statusline");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Installed the status line forwarder.");
		const { statusLine } = read();
		expect(statusLine.type).toBe("command");
		expect(statusLine.command).toMatch(/^node ".*statusline-forward\.mjs"$/);
	});

	it("writes a command that points at the forwarder next to the installer", () => {
		run("--statusline");
		const path = /^node "(.*)"$/.exec(read().statusLine.command)?.[1] as string;
		expect(path).not.toContain("\\");
		expect(basename(path)).toBe("statusline-forward.mjs");
		expect(resolve(path)).toBe(FORWARDER);
		expect(existsSync(path)).toBe(true);
		expect(statSync(path).isFile()).toBe(true);
	});

	it("also installs the hooks", () => {
		run("--statusline");
		expect(Object.keys(read().hooks)).toHaveLength(14);
	});

	it("is idempotent", () => {
		run("--statusline");
		const first = readFileSync(file, "utf8");
		const result = run("--statusline");
		expect(result.stdout).toContain("Installed the status line forwarder.");
		expect(readFileSync(file, "utf8")).toBe(first);
	});

	it("leaves a different status line unchanged and says so", () => {
		write({ statusLine: foreign });
		const result = run("--statusline");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("A different status line is already configured, so it was left unchanged.");
		expect(result.stdout).toContain("--force-statusline");
		expect(result.stdout).not.toContain("Installed the status line forwarder.");
		expect(read().statusLine).toEqual(foreign);
	});

	it("still installs the hooks when a different status line is left in place", () => {
		write({ statusLine: foreign });
		run("--statusline");
		expect(Object.keys(read().hooks)).toHaveLength(14);
	});

	it("replaces a different status line with --force-statusline", () => {
		write({ statusLine: foreign });
		const result = run("--statusline", "--force-statusline");
		expect(result.stdout).toContain("Installed the status line forwarder.");
		expect(read().statusLine.command).toMatch(/statusline-forward\.mjs"$/);
	});

	it("does nothing for --force-statusline without --statusline", () => {
		write({ statusLine: foreign });
		run("--force-statusline");
		expect(read().statusLine).toEqual(foreign);
	});

	it("preserves other settings", () => {
		write({ model: "opus", env: { A: "1" }, permissions: { allow: ["Bash(ls)"] } });
		run("--statusline");
		const settings = read();
		expect(settings.model).toBe("opus");
		expect(settings.env).toEqual({ A: "1" });
		expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
	});

	it("updates a stale forwarder command to the current path", () => {
		write({ statusLine: { type: "command", command: 'node "C:/old/place/statusline-forward.mjs"' } });
		run("--statusline");
		expect(read().statusLine.command).not.toContain("C:/old/place");
	});
});

describe("install-hooks --remove with a status line", () => {
	it("removes the forwarder status line", () => {
		run("--statusline");
		const result = run("--remove");
		expect(result.stdout).toContain("Removed the status line forwarder.");
		expect(read()).toEqual({});
	});

	it("leaves a different status line alone", () => {
		write({ statusLine: foreign });
		run();
		const result = run("--remove");
		expect(result.stdout).not.toContain("Removed the status line forwarder.");
		expect(read()).toEqual({ statusLine: foreign });
	});

	it("preserves other settings while removing the forwarder", () => {
		write({ model: "opus" });
		run("--statusline");
		run("--remove");
		expect(read()).toEqual({ model: "opus" });
	});

	it("does not install a status line when --statusline is combined with --remove", () => {
		run("--remove", "--statusline");
		expect(read().statusLine).toBeUndefined();
	});
});

describe("install-hooks --check", () => {
	it("reports nothing installed for a missing file", () => {
		expect(check()).toEqual({ hooks: false, statusLine: "none" });
	});

	it("reports nothing installed for an empty settings object", () => {
		write({});
		expect(check()).toEqual({ hooks: false, statusLine: "none" });
	});

	it("prints a single line of JSON and exits 0", () => {
		const result = run("--check");
		expect(result.status).toBe(0);
		expect(result.stdout.trim().split("\n")).toHaveLength(1);
	});

	it("reports hooks only", () => {
		run();
		expect(check()).toEqual({ hooks: true, statusLine: "none" });
	});

	it("reports hooks and the forwarder", () => {
		run("--statusline");
		expect(check()).toEqual({ hooks: true, statusLine: "forwarder" });
	});

	it("reports a different status line as other", () => {
		write({ statusLine: foreign });
		expect(check()).toEqual({ hooks: false, statusLine: "other" });
		run();
		expect(check()).toEqual({ hooks: true, statusLine: "other" });
	});

	it("reports the forwarder without hooks", () => {
		write({ statusLine: { type: "command", command: 'node "/x/statusline-forward.mjs"' } });
		expect(check()).toEqual({ hooks: false, statusLine: "forwarder" });
	});

	it("reports hooks as missing when one event has no plugin hook", () => {
		run();
		const settings = read();
		delete settings.hooks.Stop;
		write(settings);
		expect(check().hooks).toBe(false);
	});

	it("reports hooks as missing when an event only has other hooks", () => {
		run();
		const settings = read();
		settings.hooks.Stop = [{ hooks: [{ type: "command", command: "echo hi" }] }];
		write(settings);
		expect(check().hooks).toBe(false);
	});

	it("finds the plugin hook when it shares a group with other hooks", () => {
		run();
		const settings = read();
		settings.hooks.Stop = [{ hooks: [{ type: "command", command: "echo hi" }, { type: "http", url: URL_DEFAULT, timeout: 2 }] }];
		write(settings);
		expect(check().hooks).toBe(true);
	});

	it("looks for the URL of the port given with --port", () => {
		run();
		expect(check("--port", "50000").hooks).toBe(false);
		run("--port", "50000");
		expect(check("--port", "50000").hooks).toBe(true);
		expect(check().hooks).toBe(true);
	});

	it("reports hooks for another port as not installed", () => {
		run("--port", "50000");
		expect(check()).toEqual({ hooks: false, statusLine: "none" });
	});

	it("does not modify the file", () => {
		run("--statusline");
		const before = readFileSync(file, "utf8");
		check();
		expect(readFileSync(file, "utf8")).toBe(before);
	});

	it("does not create a backup", () => {
		write({ model: "opus" });
		check();
		expect(existsSync(`${file}.bak`)).toBe(false);
	});

	it("does not create the settings file", () => {
		check();
		expect(existsSync(file)).toBe(false);
	});

	it("ignores --remove and --statusline when checking", () => {
		write({ model: "opus" });
		const before = readFileSync(file, "utf8");
		run("--check", "--remove", "--statusline");
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(existsSync(`${file}.bak`)).toBe(false);
	});
});
