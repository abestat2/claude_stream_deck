import { action, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import { frameCount, renderCharacter, svgDataUri } from "../render/character";
import type { SessionStore, Summary } from "../state/sessions";

/** Time between animation frames. */
const FRAME_INTERVAL_MS = 180;

/**
 * Key that shows an animated character reflecting the aggregate state of all Claude Code sessions:
 * still when idle, walking while working, and hopping when a session needs attention.
 */
@action({ UUID: "com.claudedeck.controls.claude-status" })
export class ClaudeStatus extends SingletonAction {
	private frame = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly store: SessionStore) {
		super();
		store.on("change", () => this.refresh());
	}

	override onWillAppear(_ev: WillAppearEvent): void {
		this.refresh();
	}

	/** Redraws all visible keys and starts or stops the animation timer to match the current state. */
	private refresh(): void {
		const summary = this.store.summary();
		this.draw(summary);

		const animated = frameCount(summary.overall) > 1;
		if (animated && !this.timer) {
			this.timer = setInterval(() => {
				this.frame++;
				this.draw(this.store.summary());
			}, FRAME_INTERVAL_MS);
			this.timer.unref();
		} else if (!animated && this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
			this.frame = 0;
			this.draw(summary);
		}
	}

	private draw(summary: Summary): void {
		const image = svgDataUri(renderCharacter(summary, this.frame));
		for (const instance of this.actions) {
			if (instance.isKey()) {
				void instance.setImage(image);
			}
		}
	}
}
