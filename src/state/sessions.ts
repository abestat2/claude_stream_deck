import { EventEmitter } from "node:events";

/**
 * What a session is doing:
 * - `idle`: finished its turn and is waiting for the next prompt.
 * - `working`: processing a prompt, running tools, or running subagents.
 * - `attention`: blocked on a permission prompt or a question for the user.
 */
export type SessionState = "idle" | "working" | "attention";

/** Aggregate view of all tracked sessions. */
export type Summary = {
	sessions: number;
	working: number;
	attention: number;
	idle: number;
	/** Subagents currently running across all sessions. */
	agents: number;
	/** Most urgent state across sessions: attention, then working, then idle. */
	overall: SessionState;
};

/** Fields read from a hook event payload. Other fields are ignored. */
export type HookEvent = {
	hook_event_name?: unknown;
	session_id?: unknown;
	agent_id?: unknown;
	notification_type?: unknown;
	cwd?: unknown;
};

type Session = {
	state: SessionState;
	agents: Set<string>;
	lastSeen: number;
};

/** A working session with no events for this long is reported as idle. */
const WORKING_STALE_MS = 10 * 60 * 1000;

/** A session with no events for this long is removed. */
const SESSION_EXPIRY_MS = 2 * 60 * 60 * 1000;

/** Interval at which stale and expired sessions are re-evaluated. */
const SWEEP_INTERVAL_MS = 30_000;

/** Notification types that mean the session is waiting on the user. */
const ATTENTION_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog"]);

/**
 * Tracks Claude Code sessions from hook events and emits `change` with a {@link Summary}
 * whenever the aggregate view changes.
 */
export class SessionStore extends EventEmitter {
	private readonly sessions = new Map<string, Session>();
	private lastKey = "";
	private timer: NodeJS.Timeout | undefined;

	/** Starts the periodic sweep that expires stale sessions. */
	start(): void {
		this.timer ??= setInterval(() => this.publish(), SWEEP_INTERVAL_MS);
		this.timer.unref();
	}

	/** Stops the periodic sweep. */
	stop(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	/** Applies one hook event to the tracked sessions. */
	handle(event: HookEvent): void {
		const id = typeof event.session_id === "string" ? event.session_id : undefined;
		const name = typeof event.hook_event_name === "string" ? event.hook_event_name : undefined;
		if (!id || !name) {
			return;
		}

		if (name === "SessionEnd") {
			this.sessions.delete(id);
			this.publish();
			return;
		}

		let session = this.sessions.get(id);
		if (!session) {
			session = { state: "idle", agents: new Set(), lastSeen: Date.now() };
			this.sessions.set(id, session);
		}
		session.lastSeen = Date.now();

		switch (name) {
			case "UserPromptSubmit":
			case "PreToolUse":
			case "PostToolUse":
			case "PostToolUseFailure":
			case "PermissionDenied":
				session.state = "working";
				break;

			case "PermissionRequest":
			case "Elicitation":
				session.state = "attention";
				break;

			case "Notification":
				if (typeof event.notification_type === "string" && ATTENTION_NOTIFICATIONS.has(event.notification_type)) {
					session.state = "attention";
				}
				break;

			case "Stop":
			case "StopFailure":
			case "SessionStart":
				session.state = "idle";
				break;

			case "SubagentStart":
				if (typeof event.agent_id === "string") {
					session.agents.add(event.agent_id);
				}
				if (session.state === "idle") {
					session.state = "working";
				}
				break;

			case "SubagentStop":
				if (typeof event.agent_id === "string") {
					session.agents.delete(event.agent_id);
				}
				break;
		}

		this.publish();
	}

	/** Returns the current aggregate view. */
	summary(): Summary {
		const now = Date.now();
		const summary: Summary = { sessions: 0, working: 0, attention: 0, idle: 0, agents: 0, overall: "idle" };

		for (const [id, session] of this.sessions) {
			if (now - session.lastSeen > SESSION_EXPIRY_MS) {
				this.sessions.delete(id);
				continue;
			}

			const state = this.effectiveState(session, now);
			summary.sessions++;
			summary[state]++;
			summary.agents += session.agents.size;
		}

		summary.overall = summary.attention > 0 ? "attention" : summary.working > 0 ? "working" : "idle";
		return summary;
	}

	/**
	 * Resolves a session's reported state. A session with running subagents counts as working,
	 * and a working session that has gone quiet counts as idle.
	 */
	private effectiveState(session: Session, now: number): SessionState {
		const stale = now - session.lastSeen > WORKING_STALE_MS;
		if (session.state === "attention") {
			return "attention";
		}
		if (stale) {
			return "idle";
		}
		return session.state === "working" || session.agents.size > 0 ? "working" : "idle";
	}

	/** Emits `change` when the aggregate view differs from the last one emitted. */
	private publish(): void {
		const summary = this.summary();
		const key = JSON.stringify(summary);
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.emit("change", summary);
		}
	}
}
