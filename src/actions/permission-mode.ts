import streamDeck, { action, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";
import { svgDataUri } from "../render/character";
import { renderMode } from "../render/mode";
import type { SessionStore } from "../state/sessions";

/**
 * Key that shows the permission mode of the most recently active session and cycles the mode
 * with Shift+Tab in the window that has focus.
 * The mode is reported with each hook event, so after cycling the key keeps the previous mode,
 * marked as out of date, until the next event arrives.
 */
@action({ UUID: "com.claudedeck.controls.permission-mode" })
export class PermissionMode extends SingletonAction {
	private cycledAt: number | undefined;

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
			this.cycledAt = Date.now();
			this.draw();
		} catch (err) {
			streamDeck.logger.error(`Permission mode cycle failed: ${err instanceof Error ? err.message : String(err)}`);
			await ev.action.showAlert();
		}
	}

	private draw(): void {
		const latest = this.store.sessions().find((session) => session.permissionMode !== undefined);
		const lastEvent = this.store.lastEvent();
		const stale = this.cycledAt !== undefined && (lastEvent === undefined || lastEvent < this.cycledAt);
		const image = svgDataUri(renderMode(latest?.permissionMode, latest?.project ?? "", stale));

		for (const instance of this.actions) {
			if (instance.isKey()) {
				void instance.setImage(image);
			}
		}
	}
}
