import streamDeck from "@elgato/streamdeck";
import { ClaudeStatus } from "./actions/claude-status";
import { ModelPicker } from "./actions/model-picker";
import { SendText } from "./actions/send-text";
import { SessionOverview } from "./actions/session-overview";
import { keyboard } from "./input/keyboard";
import { startHookServer } from "./server/hook-server";
import { SessionStore } from "./state/sessions";

streamDeck.logger.setLevel("info");

const store = new SessionStore();
store.start();
store.on("change", (summary) => {
	streamDeck.logger.info(
		`Sessions: ${summary.sessions} (working ${summary.working}, attention ${summary.attention}, idle ${summary.idle}), agents: ${summary.agents}`,
	);
});

streamDeck.actions.registerAction(new SendText());
streamDeck.actions.registerAction(new ClaudeStatus(store));
streamDeck.actions.registerAction(new SessionOverview(store));
streamDeck.actions.registerAction(new ModelPicker());

const hookServer = startHookServer(store, streamDeck.logger);

keyboard.start().catch((err: unknown) => {
	streamDeck.logger.error(`Keyboard helper failed to start: ${err instanceof Error ? err.message : String(err)}`);
});

process.on("exit", () => {
	keyboard.stop();
	store.stop();
	hookServer.close();
});

streamDeck.connect();
