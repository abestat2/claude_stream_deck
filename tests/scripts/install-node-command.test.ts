import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/install-hooks.mjs");
const FORWARDER = resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/statusline-forward.mjs");

const SYSTEM32 = join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32");
const INHERITED = ["SystemRoot", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "PATHEXT", "SystemDrive"];

const isWindows = process.platform === "win32";

let root: string;
let counter = 0;

/** Environment that contains only the inherited system variables and the given PATH entries. */
function environment(pathEntries: string[]): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const name of INHERITED) {
		const value = process.env[name];
		if (value !== undefined) {
			env[name] = value;
		}
	}
	const path = pathEntries.join(";");
	env.PATH = path;
	env.Path = path;
	return env;
}

type Run = { status: number | null; stdout: string; stderr: string; file: string; command: string | undefined; read: () => Record<string, unknown> };

/** Runs the installer against a settings file in a fresh temp directory. */
function install(pathEntries: string[], extra: string[] = ["--statusline"], initial?: unknown): Run {
	const dir = join(root, `run${counter++}`);
	mkdirSync(dir);
	const file = join(dir, "settings.json");
	if (initial !== undefined) {
		writeFileSync(file, JSON.stringify(initial));
	}
	const result = spawnSync(process.execPath, [SCRIPT, "--file", file, ...extra], {
		encoding: "utf8",
		env: environment(pathEntries),
		cwd: dir,
		timeout: 20_000,
	});
	const read = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	const command = existsSync(file) ? ((read().statusLine as { command?: string } | undefined)?.command ?? undefined) : undefined;
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, file, command, read };
}

/** Creates a directory under the test root that holds an empty node.cmd and returns its path. */
function fakeNode(name: string): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "node.cmd"), "@echo off\r\n");
	return dir;
}

/** Splits a command into its executable part and the quoted forwarder path. */
function split(command: string): { exe: string; forwarder: string } {
	const match = /^(\S+) "(.+)"$/.exec(command) ?? /^(.+?) "(.+)"$/.exec(command);
	expect(match).not.toBeNull();
	return { exe: match?.[1] as string, forwarder: match?.[2] as string };
}

describe.skipIf(!isWindows)("install-hooks node command", () => {
	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "install-node-command-"));
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	describe("Node.js found on PATH", () => {
		it("uses the node.cmd on PATH written with forward slashes", () => {
			const dir = fakeNode("on-path");
			const run = install([dir, SYSTEM32]);
			expect(run.status).toBe(0);
			expect(run.command).toBeDefined();
			const expected = join(dir, "node.cmd").replace(/\\/g, "/");
			const { exe } = split(run.command as string);
			expect(exe.toLowerCase()).toBe(expected.toLowerCase());
			expect(run.command?.startsWith(`${expected} "`)).toBe(true);
			expect(run.command).not.toContain("\\");
			expect(exe).not.toMatch(/\s/);
		});

		it("uses the first match when several directories on PATH hold a node", () => {
			const first = fakeNode("first-node");
			const second = fakeNode("second-node");
			const run = install([first, second, SYSTEM32]);
			const { exe } = split(run.command as string);
			expect(exe.toLowerCase()).toBe(join(first, "node.cmd").replace(/\\/g, "/").toLowerCase());
		});

		it("converts a path that contains a space to its short form, or falls back to node", () => {
			const dir = fakeNode("with space");
			const run = install([dir, SYSTEM32]);
			expect(run.status).toBe(0);
			const { exe } = split(run.command as string);
			expect(exe).not.toMatch(/\s/);
			expect(exe).not.toContain("\\");
			if (exe !== "node") {
				expect(exe.toLowerCase()).toMatch(/node\.cmd$/);
				expect(existsSync(exe)).toBe(true);
			}
		});
	});

	describe("Node.js missing from PATH", () => {
		it("uses the Node.js that runs the installer", () => {
			const run = install([SYSTEM32]);
			expect(run.status).toBe(0);
			const { exe } = split(run.command as string);
			expect(exe.toLowerCase()).toMatch(/node\.exe$/);
			expect(exe).not.toMatch(/\s/);
			expect(exe).not.toContain("\\");
			expect(existsSync(exe)).toBe(true);
		});

		it("ignores unrelated directories on PATH", () => {
			const other = join(root, "unrelated");
			mkdirSync(other);
			const withOther = install([other, SYSTEM32]);
			const without = install([SYSTEM32]);
			expect(withOther.command).toBe(without.command);
		});
	});

	describe("forwarder path", () => {
		it.each([
			["a Node.js on PATH", () => [fakeNode("forwarder-path"), SYSTEM32]],
			["no Node.js on PATH", () => [SYSTEM32]],
		])("ends with the quoted forwarder next to the installer with %s", (_name, entries) => {
			const run = install(entries());
			const { forwarder } = split(run.command as string);
			expect(run.command?.endsWith(`"${forwarder}"`)).toBe(true);
			expect(forwarder).not.toContain("\\");
			expect(forwarder.endsWith("/statusline-forward.mjs")).toBe(true);
			expect(existsSync(forwarder)).toBe(true);
			expect(resolve(forwarder).toLowerCase()).toBe(FORWARDER.toLowerCase());
		});
	});

	describe("repeated runs", () => {
		it("writes an identical command when run twice", () => {
			const dir = fakeNode("repeat");
			const first = install([dir, SYSTEM32]);
			const second = spawnSync(process.execPath, [SCRIPT, "--file", first.file, "--statusline"], {
				encoding: "utf8",
				env: environment([dir, SYSTEM32]),
				cwd: join(first.file, ".."),
				timeout: 20_000,
			});
			expect(second.status).toBe(0);
			expect((first.read().statusLine as { command: string }).command).toBe(first.command);
			expect(first.read().statusLine).toEqual({ type: "command", command: first.command });
		});

		it("removes the command with --remove and leaves other settings unchanged", () => {
			const dir = fakeNode("remove");
			const other = { model: "opus", env: { A: "1" }, permissions: { allow: ["Bash(ls)"] } };
			const installed = install([dir, SYSTEM32], ["--statusline"], other);
			expect(installed.command).toBeDefined();
			const removed = spawnSync(process.execPath, [SCRIPT, "--file", installed.file, "--remove"], {
				encoding: "utf8",
				env: environment([dir, SYSTEM32]),
				cwd: join(installed.file, ".."),
				timeout: 20_000,
			});
			expect(removed.status).toBe(0);
			expect(removed.stdout).toContain("Removed the status line forwarder.");
			expect(installed.read()).toEqual(other);
		});

		it("keeps other settings when installing", () => {
			const dir = fakeNode("keep");
			const other = { model: "opus", env: { A: "1" } };
			const run = install([dir, SYSTEM32], ["--statusline"], other);
			expect(run.read()).toMatchObject(other);
			expect(run.read().statusLine).toBeDefined();
		});

		it("does not write a status line without --statusline", () => {
			const run = install([SYSTEM32], []);
			expect(run.status).toBe(0);
			expect(run.read().statusLine).toBeUndefined();
		});
	});
});
