import streamDeck, { action, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";
import { svgDataUri } from "../render/character";
import { renderMode } from "../render/mode";
import { nextMode } from "../state/modes";
import type { SessionStore } from "../state/sessions";

/**
 * Key that shows the permission mode of the most recently active session and cycles the mode
 * with Shift+Tab in the window that has focus.
 *
 * Claude Code reports the mode only with its hook events, so it cannot be read the moment it changes.
 * After a press the key shows the mode that cycling should lead to, marked as predicted, and replaces it
 * with the reported mode when the next hook event arrives. Pressing again before that continues from the
 * predicted mode. When the mode is not known yet there is nothing to predict, and the key shows an
 * out-of-date mark until an event arrives.
 */
@action({ UUID: "com.claudedeck.controls.permission-mode" })
export class PermissionMode extends SingletonAction {
	private cycledAt: number | undefined;
	private predicted: string | undefined;

	constructor(private readonly store: SessionStore) {
		super();
		store.on("detail", () => this.draw());
	}

	override onWillAppear(_ev: WillAppearEvent): void {
		this.draw();
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		try {
			await keyboard.send(parseSequence("{Shift+Tab}", false));

			const shown = this.isStale() ? this.predicted : this.reported()?.permissionMode;
			this.predicted = shown === undefined ? undefined : nextMode(shown, this.store.seenModes());
			this.cycledAt = Date.now();
			this.draw();
		} catch (err) {
			streamDeck.logger.error(`Permission mode cycle failed: ${err instanceof Error ? err.message : String(err)}`);
			await ev.action.showAlert();
		}
	}

	/** Returns the most recently active session that has reported a permission mode. */
	private reported() {
		return this.store.sessions().find((session) => session.permissionMode !== undefined);
	}

	/** True after a press and before a hook event confirms the mode. */
	private isStale(): boolean {
		const lastEvent = this.store.lastEvent();
		return this.cycledAt !== undefined && (lastEvent === undefined || lastEvent < this.cycledAt);
	}

	private draw(): void {
		const latest = this.reported();
		const stale = this.isStale();
		const predicted = stale ? this.predicted : undefined;
		const image = svgDataUri(renderMode(predicted ?? latest?.permissionMode, latest?.project ?? "", stale, predicted !== undefined));

		for (const instance of this.actions) {
			if (instance.isKey()) {
				void instance.setImage(image);
			}
		}
	}
}
