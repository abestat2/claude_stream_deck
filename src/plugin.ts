import streamDeck from "@elgato/streamdeck";
import { AlertConfig } from "./alerts/config";
import { AlertManager } from "./alerts/manager";
import { createNotifier } from "./alerts/notifier";
import { ClaudeStatus } from "./actions/claude-status";
import { Connection } from "./actions/connection";
import { Context } from "./actions/context";
import { ModelPicker } from "./actions/model-picker";
import { PermissionMode } from "./actions/permission-mode";
import { PermissionResponse } from "./actions/permission";
import { SavedPrompts } from "./actions/saved-prompts";
import { SendText } from "./actions/send-text";
import { SessionOverview } from "./actions/session-overview";
import { keyboard } from "./input/keyboard";
import { startHookServer } from "./server/hook-server";
import { SessionStore } from "./state/sessions";
import { Usage } from "./actions/usage";
import { UsageService } from "./usage/client";

streamDeck.logger.setLevel("info");

const store = new SessionStore();
store.start();

const alertConfig = new AlertConfig();
streamDeck.settings.getGlobalSettings().then((settings) => alertConfig.set(settings));
streamDeck.settings.onDidReceiveGlobalSettings((ev) => alertConfig.set(ev.settings));

const alerts = new AlertManager(store, alertConfig, createNotifier((message) => streamDeck.logger.error(message)));
alerts.start();

const usage = new UsageService();
store.on("status", (payload: { rate_limits?: unknown }) => usage.ingestStatusLine(payload.rate_limits));
usage.on("change", (state) => {
	const pct = (id: "session" | "week" | "sonnet"): string => {
		const w = state.windows[id];
		return w ? `${Math.round(w.percent)}%` : "-";
	};
	streamDeck.logger.info(`Usage: session ${pct("session")}, week ${pct("week")}, sonnet ${pct("sonnet")}${state.error ? `, error ${state.error}` : ""}`);
});
store.on("change", (summary) => {
	streamDeck.logger.info(
		`Sessions: ${summary.sessions} (working ${summary.working}, attention ${summary.attention}, done ${summary.done}, idle ${summary.idle}), agents: ${summary.agents}`,
	);
});

let lastContextLine = "";
store.on("detail", () => {
	const latest = store.latestContext();
	const line = latest ? `Context: ${Math.round(latest.contextPercent ?? 0)}% (${latest.model?.name ?? "unknown model"})` : "";
	if (line && line !== lastContextLine) {
		lastContextLine = line;
		streamDeck.logger.info(line);
	}
});

streamDeck.actions.registerAction(new SendText());
streamDeck.actions.registerAction(new ClaudeStatus(store, alertConfig));
streamDeck.actions.registerAction(new SessionOverview(store));
streamDeck.actions.registerAction(new ModelPicker(store));
streamDeck.actions.registerAction(new SavedPrompts());
streamDeck.actions.registerAction(new Usage(usage));
streamDeck.actions.registerAction(new Connection(store, usage));
streamDeck.actions.registerAction(new PermissionResponse(store));
streamDeck.actions.registerAction(new PermissionMode(store));
streamDeck.actions.registerAction(new Context(store));

const hookServer = startHookServer(store, streamDeck.logger);

keyboard.start().catch((err: unknown) => {
	streamDeck.logger.error(`Keyboard helper failed to start: ${err instanceof Error ? err.message : String(err)}`);
});

process.on("exit", () => {
	keyboard.stop();
	store.stop();
	alerts.stop();
	hookServer.close();
});

streamDeck.connect();
