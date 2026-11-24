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
import { renderUsageDial, renderUsageKey, type WindowPair } from "../render/usage";
import type { UsageService, WindowId } from "../usage/client";

type Settings = {
	/** Window shown on the top bar: `session`, `week`, or `sonnet`. Defaults to `session`. */
	first?: string;
	/** Window shown on the bottom bar. Defaults to `week`. */
	second?: string;
};

/** Interval at which the display is redrawn and a refresh is requested. The service limits actual requests. */
const TICK_MS = 30_000;

const ALL_WINDOWS: WindowId[] = ["session", "week", "sonnet"];

function isWindow(value: unknown): value is WindowId {
	return ALL_WINDOWS.includes(value as WindowId);
}

/**
 * Resolves the two windows to show from the settings. When both bars are set to the same window,
 * the bottom bar shows the next window in order instead.
 */
export function toPair(settings: Settings): WindowPair {
	const first = isWindow(settings.first) ? settings.first : "session";
	const second = isWindow(settings.second) ? settings.second : "week";
	if (second !== first) {
		return [first, second];
	}
	return [first, ALL_WINDOWS[(ALL_WINDOWS.indexOf(first) + 1) % ALL_WINDOWS.length] as WindowId];
}

/**
 * Shows plan usage for two windows on a key or a dial: percentage used, a bar, and time until reset for each.
 * Pressing the key or dial, or tapping the strip, requests a fresh reading.
 * Usage is only requested while at least one instance is visible.
 */
@action({ UUID: "com.claudedeck.controls.usage" })
export class Usage extends SingletonAction<Settings> {
	private readonly windows = new Map<string, WindowPair>();
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly service: UsageService) {
		super();
		service.on("change", () => this.draw());
	}

	override onWillAppear(ev: WillAppearEvent<Settings>): void {
		this.windows.set(ev.action.id, toPair(ev.payload.settings));
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
		this.windows.set(ev.action.id, toPair(ev.payload.settings));
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
		const pace = this.service.pace();
		for (const instance of this.actions) {
			const pair = this.windows.get(instance.id);
			if (!pair) {
				continue;
			}
			if (instance.isKey()) {
				void instance.setImage(svgDataUri(renderUsageKey(pair, state, pace)));
			} else if (instance.isDial()) {
				void instance.setFeedback({ canvas: svgDataUri(renderUsageDial(pair, state, pace)) });
			}
		}
	}
}
