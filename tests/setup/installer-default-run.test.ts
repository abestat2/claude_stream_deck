import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const hoisted = vi.hoisted(() => ({
	execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: hoisted.execFile,
}));

const CHECK_OUTPUT = `${JSON.stringify({ hooks: true, statusLine: "forwarder" })}\n`;
const INSTALL_OUTPUT = "Installed the status line forwarder.\nInstalled hooks in C:\\Users\\someone\\.claude\\settings.json\n";
const REMOVE_OUTPUT = "Removed the status line forwarder.\nRemoved hooks from C:\\Users\\someone\\.claude\\settings.json\n";
const NONE_OUTPUT = `${JSON.stringify({ hooks: false, statusLine: "none" })}\n`;

type Reply = { error?: Error | null; stdout?: string; stderr?: string };

/** Makes each execFile call answer with the next reply, in order. */
function reply(...replies: Reply[]): void {
	for (const r of replies) {
		hoisted.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Callback) => {
			callback(r.error ?? null, r.stdout ?? "", r.stderr ?? "");
		});
	}
}

async function load() {
	vi.resetModules();
	return import("../../src/setup/installer");
}

const argsOf = (call: number) => hoisted.execFile.mock.calls[call]?.[1] as string[];

describe("runSetup with the default runner", () => {
	beforeEach(() => {
		hoisted.execFile.mockReset();
	});

	it("has the installer script in the plugin's scripts folder", () => {
		expect(existsSync(resolve(__dirname, "../../com.claudedeck.controls.sdPlugin/scripts/install-hooks.mjs"))).toBe(true);
	});

	describe("check", () => {
		it("runs the script once with --check using the current Node.js", async () => {
			reply({ stdout: CHECK_OUTPUT });
			const { runSetup } = await load();
			const result = await runSetup("check");
			expect(hoisted.execFile).toHaveBeenCalledTimes(1);
			const [file, args, options] = hoisted.execFile.mock.calls[0] as [string, string[], unknown];
			expect(file).toBe(process.execPath);
			expect(args).toHaveLength(2);
			expect(args[0]?.replace(/\\/g, "/")).toMatch(/scripts\/install-hooks\.mjs$/);
			expect(args[1]).toBe("--check");
			expect(options).toEqual({ windowsHide: true, timeout: 15_000 });
			expect(result).toEqual({ ok: true, status: { hooks: true, statusLine: "forwarder" }, message: "" });
		});
	});

	describe("install", () => {
		it("runs --statusline and then --check", async () => {
			reply({ stdout: INSTALL_OUTPUT }, { stdout: CHECK_OUTPUT });
			const { runSetup } = await load();
			const result = await runSetup("install");
			expect(hoisted.execFile).toHaveBeenCalledTimes(2);
			for (const call of [0, 1]) {
				const [file, args, options] = hoisted.execFile.mock.calls[call] as [string, string[], unknown];
				expect(file).toBe(process.execPath);
				expect(args[0]?.replace(/\\/g, "/")).toMatch(/scripts\/install-hooks\.mjs$/);
				expect(options).toEqual({ windowsHide: true, timeout: 15_000 });
			}
			expect(argsOf(0).slice(1)).toEqual(["--statusline"]);
			expect(argsOf(1).slice(1)).toEqual(["--check"]);
			expect(argsOf(0)[0]).toBe(argsOf(1)[0]);
			expect(result).toEqual({
				ok: true,
				status: { hooks: true, statusLine: "forwarder" },
				message: "Installed the status line forwarder.",
			});
		});

		it("does not run the check when the install fails", async () => {
			reply({ error: new Error("exit 1"), stderr: "boom\n" });
			const { runSetup } = await load();
			const result = await runSetup("install");
			expect(hoisted.execFile).toHaveBeenCalledTimes(1);
			expect(result).toEqual({ ok: false, message: "boom" });
		});
	});

	describe("remove", () => {
		it("runs --remove and then --check", async () => {
			reply({ stdout: REMOVE_OUTPUT }, { stdout: NONE_OUTPUT });
			const { runSetup } = await load();
			const result = await runSetup("remove");
			expect(hoisted.execFile).toHaveBeenCalledTimes(2);
			expect(argsOf(0).slice(1)).toEqual(["--remove"]);
			expect(argsOf(1).slice(1)).toEqual(["--check"]);
			expect(result).toEqual({ ok: true, status: { hooks: false, statusLine: "none" }, message: "Removed the status line forwarder." });
		});

		it("does not run the check when the removal fails", async () => {
			reply({ error: new Error("exit 1") });
			const { runSetup } = await load();
			const result = await runSetup("remove");
			expect(hoisted.execFile).toHaveBeenCalledTimes(1);
			expect(result.ok).toBe(false);
		});
	});

	describe("errors", () => {
		it("reports the trimmed stderr when it is not empty", async () => {
			reply({ error: new Error("Command failed: node install-hooks.mjs --check"), stderr: "  SyntaxError: bad settings\r\n" });
			const { runSetup } = await load();
			expect(await runSetup("check")).toEqual({ ok: false, message: "SyntaxError: bad settings" });
		});

		it("reports the error message when stderr is empty", async () => {
			reply({ error: new Error("spawn failed"), stderr: "" });
			const { runSetup } = await load();
			expect(await runSetup("check")).toEqual({ ok: false, message: "spawn failed" });
		});

		it("reports the error message when stderr is only whitespace", async () => {
			reply({ error: new Error("spawn failed"), stderr: " \r\n " });
			const { runSetup } = await load();
			expect(await runSetup("check")).toEqual({ ok: false, message: "spawn failed" });
		});

		it("handles a timeout error the same way", async () => {
			const timeout = Object.assign(new Error("Command failed: timed out"), { killed: true, code: null, signal: "SIGTERM" });
			reply({ error: timeout });
			const { runSetup } = await load();
			expect(await runSetup("check")).toEqual({ ok: false, message: "Command failed: timed out" });
		});

		it("handles a timeout error that has stderr output", async () => {
			const timeout = Object.assign(new Error("timed out"), { killed: true, code: "ETIMEDOUT" });
			reply({ error: timeout, stderr: "partial output\n" });
			const { runSetup } = await load();
			expect(await runSetup("check")).toEqual({ ok: false, message: "partial output" });
		});

		it("reports a failure of the follow-up check after a successful install", async () => {
			reply({ stdout: INSTALL_OUTPUT }, { error: new Error("check failed"), stderr: "bad json in settings\n" });
			const { runSetup } = await load();
			expect(await runSetup("install")).toEqual({ ok: false, message: "bad json in settings" });
			expect(hoisted.execFile).toHaveBeenCalledTimes(2);
		});

		it("returns a failure when the script prints something that is not JSON", async () => {
			reply({ stdout: "not json\n" });
			const { runSetup } = await load();
			const result = await runSetup("check");
			expect(result.ok).toBe(false);
		});
	});
});
