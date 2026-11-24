import streamDeck from "@elgato/streamdeck";
import { SendText } from "./actions/send-text";
import { keyboard } from "./input/keyboard";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new SendText());

keyboard.start().catch((err: unknown) => {
	streamDeck.logger.error(`Keyboard helper failed to start: ${err instanceof Error ? err.message : String(err)}`);
});

process.on("exit", () => keyboard.stop());

streamDeck.connect();
