import streamDeck, { action, type KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";

type Settings = {
	/** Key sequence to send. See `parseSequence` for the syntax. */
	text?: string;
	/** Appends an Enter key press after the sequence. Defaults to true. */
	submit?: boolean;
};

/**
 * Types a configured key sequence into the foreground window when the key is pressed.
 * Each placed instance has its own sequence.
 */
@action({ UUID: "com.claudedeck.controls.send-text" })
export class SendText extends SingletonAction<Settings> {
	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const text = typeof ev.payload.settings.text === "string" ? ev.payload.settings.text : "";
		const submit = ev.payload.settings.submit !== false;

		try {
			const steps = parseSequence(text, submit);
			if (steps.length === 0) {
				await ev.action.showAlert();
				return;
			}
			await keyboard.send(steps);
		} catch (err) {
			streamDeck.logger.error(`Send Text failed for "${text}": ${err instanceof Error ? err.message : String(err)}`);
			await ev.action.showAlert();
		}
	}
}
