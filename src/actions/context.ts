import streamDeck, {
	action,
	type DialDownEvent,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";
import { svgDataUri } from "../render/character";
import { type ContextInfo, type ContextMissing, renderContextDial, renderContextKey } from "../render/context";
import type { SessionStore } from "../state/sessions";

type Settings = {
	/** Sends `/compact` when the key or dial is pressed. Defaults to true. */
	compact?: boolean;
};

type Target = { showAlert(): Promise<void> };

/**
 * Shows how full the context window is for the most recently active session, with the model and
 * token counts, on a key or a dial. Pressing it sends `/compact` to the window that has focus,
 * unless disabled. The press is refused while any session is working or waiting on the user, so
 * the command is never typed into a busy session.
 */
@action({ UUID: "com.claudedeck.controls.context" })
export class Context extends SingletonAction<Settings> {
	private readonly visible = new Set<string>();

	constructor(private readonly store: SessionStore) {
		super();
		store.on("detail", () => this.draw());
	}

	override onWillAppear(_ev: WillAppearEvent<Settings>): void {
		this.visible.add(_ev.action.id);
		this.draw();
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.visible.delete(ev.action.id);
	}

	override onDidReceiveSettings(_ev: DidReceiveSettingsEvent<Settings>): void {
		this.draw();
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		await this.compact(ev.action, ev.payload.settings);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		await this.compact(ev.action, ev.payload.settings);
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		await this.compact(ev.action, ev.payload.settings);
	}

	private async compact(target: Target, settings: Settings): Promise<void> {
		if (settings.compact === false) {
			return;
		}

		const state = this.store.summary().overall;
		if (this.store.latestContext() === undefined || state === "working" || state === "attention") {
			await target.showAlert();
			return;
		}

		try {
			await keyboard.send(parseSequence("/compact", true));
		} catch (err) {
			streamDeck.logger.error(`Compact failed: ${err instanceof Error ? err.message : String(err)}`);
			await target.showAlert();
		}
	}

	private draw(): void {
		const latest = this.store.latestContext();
		const info: ContextInfo | undefined = latest && {
			percent: latest.contextPercent ?? 0,
			tokens: latest.contextTokens,
			size: latest.contextSize,
			model: latest.model?.name,
		};
		const reason: ContextMissing = this.store.lastStatus() === undefined ? "not-set-up" : "no-messages";

		const key = svgDataUri(renderContextKey(info, reason));
		const dial = svgDataUri(renderContextDial(info, reason));
		for (const instance of this.actions) {
			if (instance.isKey()) {
				void instance.setImage(key);
			} else if (instance.isDial()) {
				void instance.setFeedback({ canvas: dial });
			}
		}
	}
}
