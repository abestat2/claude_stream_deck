import { action, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { renderConnection } from "../render/connection";
import { svgDataUri } from "../render/character";
import { hookServerStatus } from "../server/hook-server";
import type { SessionStore } from "../state/sessions";
import type { UsageService } from "../usage/client";

/** Time between redraws. */
const REFRESH_MS = 5_000;

/**
 * Key that shows whether the plugin is receiving Claude Code hook events, how many sessions it is
 * tracking, and whether plan usage can be read.
 */
@action({ UUID: "com.claudedeck.controls.connection" })
export class Connection extends SingletonAction {
	private visible = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly store: SessionStore,
		private readonly usage: UsageService,
	) {
		super();
		store.on("change", () => this.draw());
		usage.on("change", () => this.draw());
	}

	override onWillAppear(_ev: WillAppearEvent): void {
		this.visible++;
		this.timer ??= setInterval(() => this.draw(), REFRESH_MS);
		this.timer.unref();
		this.draw();
	}

	override onWillDisappear(): void {
		this.visible = Math.max(0, this.visible - 1);
		if (this.visible === 0) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private draw(): void {
		const lastEvent = this.store.lastEvent();
		const lastStatus = this.store.lastStatus();
		const usage = this.usage.state();
		const image = svgDataUri(
			renderConnection({
				listening: hookServerStatus.listening,
				serverError: hookServerStatus.error,
				sinceLastEventMs: lastEvent === undefined ? undefined : Date.now() - lastEvent,
				sinceLastStatusMs: lastStatus === undefined ? undefined : Date.now() - lastStatus,
				sessions: this.store.summary().sessions,
				usage: usage.error ?? (usage.fetchedAt === undefined ? undefined : "ok"),
			}),
		);

		for (const instance of this.actions) {
			if (instance.isKey()) {
				void instance.setImage(image);
			}
		}
	}
}
