import { action, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import type { AlertConfig } from "../alerts/config";
import { type CharacterExtra, frameCount, renderCharacter, svgDataUri } from "../render/character";
import type { SessionStore, Summary } from "../state/sessions";

/** Time between animation frames. */
const FRAME_INTERVAL_MS = 180;

/**
 * Key that shows an animated character reflecting the aggregate state of all Claude Code sessions:
 * still when idle, walking with a turn timer while working, and hopping when a session needs attention.
 * A session that has waited past the escalation interval turns the alert red.
 */
@action({ UUID: "com.claudedeck.controls.claude-status" })
export class ClaudeStatus extends SingletonAction {
	private frame = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly store: SessionStore,
		private readonly alerts: AlertConfig,
	) {
		super();
		store.on("change", () => this.refresh());
		store.on("detail", () => this.refresh());
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

	/** Collects the longest running turn and the longest wait across sessions. */
	private extra(): CharacterExtra {
		const now = Date.now();
		let turnMs: number | undefined;
		let waitMs: number | undefined;

		for (const session of this.store.sessions()) {
			if (session.state === "working" && session.turnStartedAt !== undefined) {
				turnMs = Math.max(turnMs ?? 0, now - session.turnStartedAt);
			}
			if (session.state === "attention" && session.attentionSince !== undefined) {
				waitMs = Math.max(waitMs ?? 0, now - session.attentionSince);
			}
		}

		const limitMs = this.alerts.get().escalateMinutes * 60_000;
		return { turnMs, waitMs, escalated: limitMs > 0 && waitMs !== undefined && waitMs >= limitMs };
	}

	private draw(summary: Summary): void {
		const image = svgDataUri(renderCharacter(summary, this.frame, this.extra()));
		for (const instance of this.actions) {
			if (instance.isKey()) {
				void instance.setImage(image);
			}
		}
	}
}
