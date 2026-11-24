import { action, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { renderOverview } from "../render/overview";
import { svgDataUri } from "../render/character";
import type { SessionStore } from "../state/sessions";

/**
 * Dial that shows the number of Claude Code sessions, running subagents,
 * and sessions waiting on the user on its touch strip segment.
 */
@action({ UUID: "com.claudedeck.controls.session-overview" })
export class SessionOverview extends SingletonAction {
	constructor(private readonly store: SessionStore) {
		super();
		store.on("change", () => this.draw());
	}

	override onWillAppear(_ev: WillAppearEvent): void {
		this.draw();
	}

	private draw(): void {
		const image = svgDataUri(renderOverview(this.store.summary()));
		for (const instance of this.actions) {
			if (instance.isDial()) {
				void instance.setFeedback({ canvas: image });
			}
		}
	}
}
