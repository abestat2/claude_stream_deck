import { action, type DialRotateEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { svgDataUri } from "../render/character";
import { renderSessions, type SessionView } from "../render/sessions";
import type { SessionInfo, SessionStore } from "../state/sessions";

/** Time between redraws, which keeps the timers on screen current. */
const REFRESH_MS = 1_000;

function toView(session: SessionInfo, now: number): SessionView {
	const pending = session.pending;
	return {
		project: session.project,
		state: session.state,
		agents: session.agents,
		turnMs: session.turnStartedAt === undefined ? undefined : now - session.turnStartedAt,
		waitMs: session.attentionSince === undefined ? undefined : now - session.attentionSince,
		tool: session.currentTool,
		request: pending ? [pending.tool, pending.detail].filter((part) => part && part.length > 0).join(": ") : undefined,
		model: session.model?.name,
	};
}

/**
 * Dial that lists the open Claude Code sessions. Turning the dial moves through them, and the strip
 * shows each session's project, state with timer, and what it is doing or waiting for.
 * Sessions are ordered by project name so the order stays the same while they work.
 */
@action({ UUID: "com.claudedeck.controls.sessions" })
export class Sessions extends SingletonAction {
	private readonly selected = new Map<string, string>();
	private visible = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly store: SessionStore) {
		super();
		store.on("detail", () => this.draw());
	}

	override onWillAppear(_ev: WillAppearEvent): void {
		this.visible++;
		this.timer ??= setInterval(() => this.draw(), REFRESH_MS);
		this.timer.unref();
		this.draw();
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.selected.delete(ev.action.id);
		this.visible = Math.max(0, this.visible - 1);
		if (this.visible === 0) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	override onDialRotate(ev: DialRotateEvent): void {
		const list = this.list();
		if (list.length === 0) {
			return;
		}
		const current = Math.max(0, list.findIndex((session) => session.id === this.selected.get(ev.action.id)));
		const next = (((current + ev.payload.ticks) % list.length) + list.length) % list.length;
		this.selected.set(ev.action.id, list[next]?.id ?? "");
		this.draw();
	}

	/** Returns the sessions in a stable order: by project name, then id. */
	private list(): SessionInfo[] {
		return this.store.sessions().sort((a, b) => a.project.localeCompare(b.project) || a.id.localeCompare(b.id));
	}

	private draw(): void {
		const list = this.list();
		const now = Date.now();

		for (const instance of this.actions) {
			if (!instance.isDial()) {
				continue;
			}
			const found = list.findIndex((session) => session.id === this.selected.get(instance.id));
			const index = found === -1 ? 0 : found;
			const session = list[index];
			void instance.setFeedback({
				canvas: svgDataUri(renderSessions(session && toView(session, now), index, list.length)),
			});
		}
	}
}
