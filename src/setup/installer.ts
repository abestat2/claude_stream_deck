import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/install-hooks.mjs", import.meta.url));

/** What the settings-panel buttons can ask for. */
export type SetupAction = "check" | "install" | "remove";

/** What is currently installed in the Claude Code settings file. */
export type SetupStatus = {
	/** True when every hook event reports to the plugin. */
	hooks: boolean;
	/** `forwarder` when the plugin's status line command is set, `other` for a different one, otherwise `none`. */
	statusLine: "forwarder" | "other" | "none";
};

/** Outcome of a setup action, sent back to the settings panel. */
export type SetupResult =
	| { ok: true; status: SetupStatus; message: string }
	| { ok: false; message: string };

/** Runs the setup script with arguments and resolves with what it printed. */
export type RunScript = (args: string[]) => Promise<string>;

const ARGUMENTS: Record<SetupAction, string[]> = {
	check: ["--check"],
	install: ["--statusline"],
	remove: ["--remove"],
};

const defaultRun: RunScript = (args) =>
	new Promise((resolve, reject) => {
		execFile(process.execPath, [SCRIPT_PATH, ...args], { windowsHide: true, timeout: 15_000 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
			} else {
				resolve(stdout);
			}
		});
	});

function parseStatus(output: string): SetupStatus {
	const parsed = JSON.parse(output.trim().split(/\r?\n/).pop() ?? "") as Partial<SetupStatus>;
	return {
		hooks: parsed.hooks === true,
		statusLine: parsed.statusLine === "forwarder" || parsed.statusLine === "other" ? parsed.statusLine : "none",
	};
}

/**
 * Checks, installs, or removes the hooks and status line forwarder in the Claude Code settings file
 * by running the setup script, then reports the resulting state.
 * @param run Runs the setup script. Defaults to running it with the plugin's Node.js.
 */
export async function runSetup(action: SetupAction, run: RunScript = defaultRun): Promise<SetupResult> {
	try {
		const output = action === "check" ? "" : await run(ARGUMENTS[action]);
		const status = parseStatus(await run(ARGUMENTS.check));
		const notes = output
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("Installed hooks") && !line.startsWith("Removed hooks"));
		return { ok: true, status, message: notes.join(" ") };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}
