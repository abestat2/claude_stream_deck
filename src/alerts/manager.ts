import type { SessionInfo, SessionState, SessionStore } from "../state/sessions";
import type { AlertConfig } from "./config";

/** A notification to present to the user. */
export type Alert = {
	title: string;
	body: string;
	sound: boolean;
	toast: boolean;
};

/** Presents an alert. */
export type Notify = (alert: Alert) => void;

/** Interval at which waiting sessions are checked for escalation. */
const TICK_MS = 15_000;

function describe(session: SessionInfo): string {
	const where = session.project || "a session";
	const request = session.pending;
	if (!request) {
		return where;
	}
	if (request.kind === "permission") {
		const what = [request.tool, request.detail].filter((part) => part && part.length > 0).join(": ");
		return what ? `${where} - ${what}` : where;
	}
	return request.detail ? `${where} - ${request.detail}` : where;
}

/**
 * Raises alerts from session changes:
 * - when a session starts waiting on the user,
 * - again each time a session has kept waiting for the escalation interval,
 * - when a session finishes a turn without a question, if enabled.
 */
export class AlertManager {
	private readonly waiting = new Map<string, number>();
	private readonly previous = new Map<string, SessionState>();
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly store: SessionStore,
		private readonly config: AlertConfig,
		private readonly notify: Notify,
	) {
		store.on("detail", () => this.check());
	}

	/** Starts the periodic check that raises escalation alerts. */
	start(): void {
		this.timer ??= setInterval(() => this.check(), TICK_MS);
		this.timer.unref();
	}

	/** Stops the periodic check. */
	stop(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	/** Compares current sessions with the last check and raises any alerts that are due. */
	check(now = Date.now()): void {
		const settings = this.config.get();
		const sessions = this.store.sessions();
		const live = new Set(sessions.map((session) => session.id));

		for (const session of sessions) {
			if (session.state === "attention") {
				const lastAlertAt = this.waiting.get(session.id);
				if (lastAlertAt === undefined) {
					this.waiting.set(session.id, now);
					this.raise("Claude needs you", describe(session));
				} else if (settings.escalateMinutes > 0 && now - lastAlertAt >= settings.escalateMinutes * 60_000) {
					this.waiting.set(session.id, now);
					const minutes = Math.round((now - (session.attentionSince ?? lastAlertAt)) / 60_000);
					this.raise(`Claude is still waiting (${minutes}m)`, describe(session));
				}
			} else {
				this.waiting.delete(session.id);
				if (session.state === "done" && this.previous.get(session.id) === "working" && settings.onDone) {
					this.raise("Claude finished", session.project || "a session");
				}
			}
			this.previous.set(session.id, session.state);
		}

		for (const id of [...this.waiting.keys(), ...this.previous.keys()]) {
			if (!live.has(id)) {
				this.waiting.delete(id);
				this.previous.delete(id);
			}
		}
	}

	private raise(title: string, body: string): void {
		const { sound, toast } = this.config.get();
		if (sound || toast) {
			this.notify({ title, body, sound, toast });
		}
	}
}
