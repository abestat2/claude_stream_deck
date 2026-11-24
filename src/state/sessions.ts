import { EventEmitter } from "node:events";

/**
 * What a session is doing:
 * - `idle`: nothing is happening.
 * - `working`: processing a prompt, running tools, or running subagents.
 * - `attention`: blocked on a permission prompt, or finished a turn by asking the user a question.
 * - `done`: finished a turn without a question. Stays until the next prompt is submitted.
 */
export type SessionState = "idle" | "working" | "attention" | "done";

/** Aggregate view of all tracked sessions. */
export type Summary = {
	sessions: number;
	working: number;
	attention: number;
	done: number;
	idle: number;
	/** Subagents currently running across all sessions. */
	agents: number;
	/** Most urgent state across sessions: attention, then working, then done, then idle. */
	overall: SessionState;
};

/** What a session in the `attention` state is waiting for. */
export type PendingRequest = {
	/** `permission` for a tool permission prompt, `question` for a question or dialog for the user. */
	kind: "permission" | "question";
	/** Display name of the tool awaiting permission. */
	tool: string | undefined;
	/** Short description of the request, such as a command, file path, or the question text. */
	detail: string;
};

/** Detailed view of one tracked session. */
export type SessionInfo = {
	id: string;
	/** Name of the working directory's last path segment, or an empty string when unknown. */
	project: string;
	state: SessionState;
	/** Subagents currently running in this session. */
	agents: number;
	/** Epoch milliseconds when the current turn started, while a turn is in progress. */
	turnStartedAt: number | undefined;
	/** Epoch milliseconds when the current wait for the user started, while in the `attention` state. */
	attentionSince: number | undefined;
	pending: PendingRequest | undefined;
	/** Display name of the most recent tool the session used. */
	currentTool: string | undefined;
	/** Permission mode reported by the session, such as `default`, `acceptEdits`, or `plan`. */
	permissionMode: string | undefined;
	/** Epoch milliseconds of the most recent event from the session. */
	lastSeen: number;
};

/** Fields read from a hook event payload. Other fields are ignored. */
export type HookEvent = {
	hook_event_name?: unknown;
	session_id?: unknown;
	agent_id?: unknown;
	notification_type?: unknown;
	message?: unknown;
	last_assistant_message?: unknown;
	tool_name?: unknown;
	tool_input?: unknown;
	permission_mode?: unknown;
	cwd?: unknown;
};

type Session = {
	state: SessionState;
	agents: Set<string>;
	lastSeen: number;
	project: string;
	turnStartedAt: number | undefined;
	attentionSince: number | undefined;
	pending: PendingRequest | undefined;
	currentTool: string | undefined;
	permissionMode: string | undefined;
};

/** A working session with no events for this long is reported as idle. */
const WORKING_STALE_MS = 10 * 60 * 1000;

/** A session with no events for this long is removed. */
const SESSION_EXPIRY_MS = 2 * 60 * 60 * 1000;

/** Interval at which stale and expired sessions are re-evaluated. */
const SWEEP_INTERVAL_MS = 30_000;

/** Longest request description kept for display. */
const MAX_DETAIL_CHARS = 160;

/** Notification types that mean the session is waiting on the user. */
const ATTENTION_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog"]);

/**
 * Reports whether a message ends by asking the user something, judged by a question mark
 * in its final paragraph.
 */
export function endsWithQuestion(message: unknown): boolean {
	if (typeof message !== "string") {
		return false;
	}
	const paragraphs = message.trim().split(/\n\s*\n/);
	return (paragraphs[paragraphs.length - 1] ?? "").includes("?");
}

function clip(value: string, max = MAX_DETAIL_CHARS): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

/** Returns the last path segment of a directory path written with either separator. */
export function projectName(cwd: unknown): string {
	if (typeof cwd !== "string") {
		return "";
	}
	const segments = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? "";
}

/** Converts a tool name to a display name: `mcp__server__tool` becomes `tool (server)`. */
export function displayTool(tool: unknown): string | undefined {
	if (typeof tool !== "string" || tool.length === 0) {
		return undefined;
	}
	const parts = tool.split("__");
	return parts[0] === "mcp" && parts.length >= 3 ? `${parts.slice(2).join("__")} (${parts[1]})` : tool;
}

/**
 * Describes a tool request in one short line: the command, file path, URL, or search text when the
 * input has one, otherwise the input serialized as JSON.
 */
export function describeTool(input: unknown): string {
	if (typeof input !== "object" || input === null) {
		return "";
	}
	const fields = input as Record<string, unknown>;
	for (const key of ["command", "file_path", "path", "url", "pattern", "query", "description", "prompt"]) {
		const value = fields[key];
		if (typeof value === "string" && value.length > 0) {
			return clip(value);
		}
	}
	try {
		const json = JSON.stringify(input);
		return json === "{}" ? "" : clip(json);
	} catch {
		return "";
	}
}

/**
 * Tracks Claude Code sessions from hook events. Emits `change` with a {@link Summary} whenever the
 * aggregate view changes, and `detail` whenever anything shown per session changes, such as the
 * pending request, the current tool, or the permission mode.
 */
export class SessionStore extends EventEmitter {
	private readonly tracked = new Map<string, Session>();
	private lastKey = "";
	private lastDetailKey = "";
	private lastEventAt: number | undefined;
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

		const now = Date.now();
		this.lastEventAt = now;

		if (name === "SessionEnd") {
			this.tracked.delete(id);
			this.publish();
			return;
		}

		let session = this.tracked.get(id);
		if (!session) {
			session = {
				state: "idle",
				agents: new Set(),
				lastSeen: now,
				project: "",
				turnStartedAt: undefined,
				attentionSince: undefined,
				pending: undefined,
				currentTool: undefined,
				permissionMode: undefined,
			};
			this.tracked.set(id, session);
		}
		session.lastSeen = now;

		const project = projectName(event.cwd);
		if (project) {
			session.project = project;
		}
		if (typeof event.permission_mode === "string" && event.permission_mode.length > 0) {
			session.permissionMode = event.permission_mode;
		}

		switch (name) {
			case "UserPromptSubmit":
				this.setState(session, "working");
				session.turnStartedAt = now;
				break;

			case "PreToolUse":
				session.currentTool = displayTool(event.tool_name) ?? session.currentTool;
				this.setState(session, "working");
				break;

			case "PostToolUse":
			case "PostToolUseFailure":
			case "PermissionDenied":
				this.setState(session, "working");
				break;

			case "PermissionRequest":
				this.setState(session, "attention");
				session.attentionSince = now;
				session.pending = {
					kind: "permission",
					tool: displayTool(event.tool_name),
					detail: describeTool(event.tool_input),
				};
				break;

			case "Elicitation":
				this.setState(session, "attention");
				session.attentionSince = now;
				session.pending = {
					kind: "question",
					tool: undefined,
					detail: typeof event.message === "string" ? clip(event.message) : "",
				};
				break;

			case "Notification":
				if (typeof event.notification_type === "string" && ATTENTION_NOTIFICATIONS.has(event.notification_type)) {
					const wasAttention = session.state === "attention";
					this.setState(session, "attention");
					if (!wasAttention) {
						session.attentionSince = now;
					}
					session.pending ??= {
						kind: event.notification_type === "permission_prompt" ? "permission" : "question",
						tool: undefined,
						detail: typeof event.message === "string" ? clip(event.message) : "",
					};
				}
				break;

			case "Stop":
				session.turnStartedAt = undefined;
				if (endsWithQuestion(event.last_assistant_message)) {
					this.setState(session, "attention");
					session.attentionSince = now;
					session.pending = { kind: "question", tool: undefined, detail: lastParagraph(event.last_assistant_message) };
				} else {
					this.setState(session, "done");
				}
				break;

			case "StopFailure":
			case "SessionStart":
				session.turnStartedAt = undefined;
				this.setState(session, "idle");
				break;

			case "SubagentStart":
				if (typeof event.agent_id === "string") {
					session.agents.add(event.agent_id);
				}
				if (session.state === "idle") {
					this.setState(session, "working");
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
		const summary: Summary = { sessions: 0, working: 0, attention: 0, done: 0, idle: 0, agents: 0, overall: "idle" };

		for (const session of this.sessions()) {
			summary.sessions++;
			summary[session.state]++;
			summary.agents += session.agents;
		}

		summary.overall =
			summary.attention > 0 ? "attention" : summary.working > 0 ? "working" : summary.done > 0 ? "done" : "idle";
		return summary;
	}

	/** Returns every tracked session, most recently active first. Expired sessions are removed. */
	sessions(): SessionInfo[] {
		const now = Date.now();
		const list: SessionInfo[] = [];

		for (const [id, session] of this.tracked) {
			if (now - session.lastSeen > SESSION_EXPIRY_MS) {
				this.tracked.delete(id);
				continue;
			}
			list.push({
				id,
				project: session.project,
				state: this.effectiveState(session, now),
				agents: session.agents.size,
				turnStartedAt: session.turnStartedAt,
				attentionSince: session.attentionSince,
				pending: session.pending,
				currentTool: session.currentTool,
				permissionMode: session.permissionMode,
				lastSeen: session.lastSeen,
			});
		}

		return list.sort((a, b) => b.lastSeen - a.lastSeen);
	}

	/**
	 * Returns the most recent tool permission request that is waiting for an answer, with the number
	 * of other sessions that are also waiting. Returns undefined when no permission request is pending.
	 */
	pendingPermission(): { session: SessionInfo; request: PendingRequest; others: number } | undefined {
		const waiting = this.sessions().filter((session) => session.state === "attention");
		const permissions = waiting
			.filter((session) => session.pending?.kind === "permission")
			.sort((a, b) => (b.attentionSince ?? 0) - (a.attentionSince ?? 0));
		const latest = permissions[0];
		return latest?.pending ? { session: latest, request: latest.pending, others: waiting.length - 1 } : undefined;
	}

	/** Returns the epoch milliseconds of the most recent hook event, or undefined when none has arrived. */
	lastEvent(): number | undefined {
		return this.lastEventAt;
	}

	/**
	 * Resolves a session's reported state. A session with running subagents counts as working,
	 * and a working session that has gone quiet counts as idle.
	 */
	private effectiveState(session: Session, now: number): SessionState {
		const quietFor = now - session.lastSeen;
		if (session.state === "attention") {
			return "attention";
		}
		if (session.state === "working" || session.agents.size > 0) {
			return quietFor > WORKING_STALE_MS ? "idle" : "working";
		}
		return session.state;
	}

	/** Sets a session's state and clears the wait details unless the state is `attention`. */
	private setState(session: Session, state: SessionState): void {
		session.state = state;
		if (state !== "attention") {
			session.attentionSince = undefined;
			session.pending = undefined;
		}
	}

	/** Emits `change` when the aggregate view differs from the last one emitted, and `detail` when per-session details differ. */
	private publish(): void {
		const summary = this.summary();
		const key = JSON.stringify(summary);
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.emit("change", summary);
		}

		const detailKey = JSON.stringify(
			this.sessions().map((s) => [s.id, s.project, s.state, s.agents, s.pending, s.currentTool, s.permissionMode]),
		);
		if (detailKey !== this.lastDetailKey) {
			this.lastDetailKey = detailKey;
			this.emit("detail");
		}
	}
}

function lastParagraph(message: unknown): string {
	if (typeof message !== "string") {
		return "";
	}
	const paragraphs = message.trim().split(/\n\s*\n/);
	return clip(paragraphs[paragraphs.length - 1] ?? "");
}
