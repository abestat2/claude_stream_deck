import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Alert, Notify } from "./manager";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/notify.ps1", import.meta.url));

/**
 * Creates a notifier that plays a sound and shows a Windows notification by running a PowerShell script.
 * The alert text is passed through environment variables, never on the command line or inside script text.
 * @param onError Called with a message when the script cannot be started.
 */
export function createNotifier(onError: (message: string) => void): Notify {
	return (alert: Alert) => {
		try {
			const child = spawn(
				"powershell.exe",
				["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH],
				{
					windowsHide: true,
					stdio: "ignore",
					env: {
						...process.env,
						CLAUDE_DECK_TITLE: alert.title,
						CLAUDE_DECK_BODY: alert.body,
						CLAUDE_DECK_SOUND: alert.sound ? "1" : "0",
						CLAUDE_DECK_TOAST: alert.toast ? "1" : "0",
					},
				},
			);
			child.on("error", (err) => onError(`Notification failed: ${err.message}`));
			child.unref();
		} catch (err) {
			onError(`Notification failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	};
}
