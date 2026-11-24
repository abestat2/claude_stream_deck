import {
	action,
	type DialDownEvent,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { svgDataUri } from "../render/character";
import { renderUsageDial, renderUsageKey } from "../render/usage";
import type { UsageService, WindowId } from "../usage/client";

type Settings = {
	/** Usage window to display: `session`, `week`, or `sonnet`. Defaults to `session`. */
	window?: string;
};

/** Interval at which the display is redrawn and a refresh is requested. The service limits actual requests. */
const TICK_MS = 30_000;

function toWindow(settings: Settings): WindowId {
	return settings.window === "week" || settings.window === "sonnet" ? settings.window : "session";
}

/**
 * Shows plan usage for one window on a key or a dial: percentage used, a bar, and time until reset.
 * Pressing the key or dial, or tapping the strip, requests a fresh reading.
 * Usage is only requested while at least one instance is visible.
 */
@action({ UUID: "com.claudedeck.controls.usage" })
export class Usage extends SingletonAction<Settings> {
	private readonly windows = new Map<string, WindowId>();
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly service: UsageService) {
		super();
		service.on("change", () => this.draw());
	}

	override onWillAppear(ev: WillAppearEvent<Settings>): void {
		this.windows.set(ev.action.id, toWindow(ev.payload.settings));
		this.start();
		this.draw();
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.windows.delete(ev.action.id);
		if (this.windows.size === 0) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
		this.windows.set(ev.action.id, toWindow(ev.payload.settings));
		this.draw();
	}

	override onKeyDown(_ev: KeyDownEvent<Settings>): void {
		void this.service.refresh(true);
	}

	override onDialDown(_ev: DialDownEvent<Settings>): void {
		void this.service.refresh(true);
	}

	override onTouchTap(_ev: TouchTapEvent<Settings>): void {
		void this.service.refresh(true);
	}

	/** Starts the periodic refresh and redraw while any instance is visible. */
	private start(): void {
		if (this.timer) {
			return;
		}
		void this.service.refresh();
		this.timer = setInterval(() => {
			void this.service.refresh();
			this.draw();
		}, TICK_MS);
		this.timer.unref();
	}

	private draw(): void {
		const state = this.service.state();
		for (const instance of this.actions) {
			const window = this.windows.get(instance.id);
			if (!window) {
				continue;
			}
			if (instance.isKey()) {
				void instance.setImage(svgDataUri(renderUsageKey(window, state)));
			} else if (instance.isDial()) {
				void instance.setFeedback({ canvas: svgDataUri(renderUsageDial(window, state)) });
			}
		}
	}
}
