import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Step } from "./sequence";

/** Delay between consecutive steps, so the receiving app reads typed text and key presses as separate inputs. */
const STEP_DELAY_MS = 40;

/** Time allowed for one command to complete before it is rejected. */
const COMMAND_TIMEOUT_MS = 10_000;

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/send-keys.ps1", import.meta.url));

type Pending = {
	resolve: () => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
};

/**
 * Sends keyboard input to the foreground window through a long-running PowerShell helper process.
 * The helper is started on first use and restarted automatically if it exits.
 */
class Keyboard {
	private proc: ChildProcessWithoutNullStreams | undefined;
	private ready: Promise<void> | undefined;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();

	/**
	 * Sends the steps in order to the foreground window.
	 * @throws Error when the helper fails to start or reports a failure.
	 */
	async send(steps: Step[]): Promise<void> {
		if (steps.length === 0) {
			return;
		}

		await this.start();
		const proc = this.proc;
		if (!proc) {
			throw new Error("Keyboard helper is not running");
		}

		const id = this.nextId++;
		const line = toAsciiJson({ id, delayMs: STEP_DELAY_MS, steps });

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("Keyboard helper timed out"));
			}, COMMAND_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			proc.stdin.write(line + "\n");
		});
	}

	/**
	 * Starts the helper process if it is not already running, resolving once it reports ready.
	 */
	start(): Promise<void> {
		if (this.ready) {
			return this.ready;
		}

		this.ready = new Promise<void>((resolve, reject) => {
			const proc = spawn(
				"powershell.exe",
				["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH],
				{ windowsHide: true },
			);
			this.proc = proc;

			let started = false;
			let stderr = "";
			proc.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			createInterface({ input: proc.stdout }).on("line", (line) => {
				if (!started && line.trim() === "ready") {
					started = true;
					resolve();
					return;
				}
				this.handleLine(line);
			});

			proc.on("error", (err) => {
				this.reset(err);
				reject(err);
			});

			proc.on("exit", (code) => {
				const err = new Error(`Keyboard helper exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`);
				this.reset(err);
				if (!started) {
					reject(err);
				}
			});
		});

		return this.ready;
	}

	/**
	 * Stops the helper process.
	 */
	stop(): void {
		this.proc?.stdin.end();
		this.proc?.kill();
	}

	/**
	 * Resolves or rejects the pending command a helper response line refers to.
	 */
	private handleLine(line: string): void {
		const match = /^(ok|err) (\d+)(?: (.*))?$/.exec(line.trim());
		if (!match) {
			return;
		}

		const id = Number(match[2]);
		const pending = this.pending.get(id);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timer);
		this.pending.delete(id);
		if (match[1] === "ok") {
			pending.resolve();
		} else {
			pending.reject(new Error(match[3] ?? "Keyboard helper reported an error"));
		}
	}

	/**
	 * Clears process state and rejects all pending commands, so the next send starts a fresh helper.
	 */
	private reset(err: Error): void {
		this.proc = undefined;
		this.ready = undefined;
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(err);
			this.pending.delete(id);
		}
	}
}

/**
 * Serializes a value to JSON with every non-ASCII character escaped as `\uXXXX`,
 * so the helper decodes it identically regardless of its console code page.
 */
function toAsciiJson(value: unknown): string {
	return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export const keyboard = new Keyboard();
