import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";
import { svgDataUri } from "../render/character";
import { type PermissionInfo, type PermissionResponseKind, renderPermission } from "../render/permission";
import type { SessionStore } from "../state/sessions";

type Settings = {
	/** Answer this key gives: `allow`, `always`, or `deny`. Defaults to `allow`. */
	response?: string;
	/** Presses Enter after the choice. Defaults to false. */
	submit?: boolean;
};

/** Time during which a second press is ignored, so one request is not answered twice. */
const PRESS_COOLDOWN_MS = 1_000;

/** Time the "sent" caption stays on the key. */
const SENT_CAPTION_MS = 2_000;

/** Keys that answer a permission prompt: the menu number for the choice, or Escape to reject. */
const SEQUENCES: Record<PermissionResponseKind, string> = {
	allow: "1",
	always: "2",
	deny: "{Esc}",
};

function toKind(settings: Settings): PermissionResponseKind {
	return settings.response === "always" || settings.response === "deny" ? settings.response : "allow";
}

/**
 * Key that answers a pending tool permission prompt. The key shows the tool and what it wants to do,
 * and the project it came from. It only sends keys while a permission request is pending, and
 * the keys go to the window that has focus.
 */
@action({ UUID: "com.claudedeck.controls.permission" })
export class PermissionResponse extends SingletonAction<Settings> {
	private readonly kinds = new Map<string, PermissionResponseKind>();
	private readonly sentAt = new Map<string, number>();

	constructor(private readonly store: SessionStore) {
		super();
		store.on("detail", () => this.drawAll());
	}

	override onWillAppear(ev: WillAppearEvent<Settings>): void {
		this.kinds.set(ev.action.id, toKind(ev.payload.settings));
		this.drawAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.kinds.delete(ev.action.id);
		this.sentAt.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
		this.kinds.set(ev.action.id, toKind(ev.payload.settings));
		this.drawAll();
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const id = ev.action.id;
		const now = Date.now();
		const last = this.sentAt.get(id);

		if (!this.store.pendingPermission() || (last !== undefined && now - last < PRESS_COOLDOWN_MS)) {
			await ev.action.showAlert();
			return;
		}

		const kind = toKind(ev.payload.settings);
		try {
			await keyboard.send(parseSequence(SEQUENCES[kind], kind !== "deny" && ev.payload.settings.submit === true));
			this.sentAt.set(id, now);
			this.drawAll();
			setTimeout(() => this.drawAll(), SENT_CAPTION_MS + 50).unref();
		} catch (err) {
			streamDeck.logger.error(`Permission response failed: ${err instanceof Error ? err.message : String(err)}`);
			await ev.action.showAlert();
		}
	}

	private info(): PermissionInfo | undefined {
		const pending = this.store.pendingPermission();
		return pending
			? {
					tool: pending.request.tool ?? "",
					detail: pending.request.detail,
					project: pending.session.project,
					others: pending.others,
				}
			: undefined;
	}

	private drawAll(): void {
		const info = this.info();
		const now = Date.now();
		for (const instance of this.actions) {
			const kind = this.kinds.get(instance.id);
			if (!kind || !instance.isKey()) {
				continue;
			}
			const sentAt = this.sentAt.get(instance.id);
			const sent = sentAt !== undefined && now - sentAt < SENT_CAPTION_MS;
			void instance.setImage(svgDataUri(renderPermission(kind, info, sent)));
		}
	}
}
