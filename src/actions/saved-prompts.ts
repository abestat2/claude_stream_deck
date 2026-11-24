import streamDeck, {
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";
import { svgDataUri } from "../render/character";
import { renderPrompts, type Prompt } from "../render/prompts";

type Settings = {
	/** One prompt per line, either `text` or `label | text`. */
	prompts?: string;
	/** Appends an Enter key press after the prompt. Defaults to true. */
	submit?: boolean;
};

const DEFAULT_PROMPTS: Prompt[] = [
	{ label: "yes", text: "yes" },
	{ label: "please commit", text: "please commit" },
	{ label: "/graphify", text: "/graphify" },
];

type Selection = {
	index: number;
	lastSent: string | undefined;
};

/**
 * Parses the prompts setting. Each non-empty line is either `text` or `label | text`,
 * where the label is shown on the strip and the text is sent. Falls back to the defaults when empty.
 */
export function parsePrompts(settings: Settings): Prompt[] {
	const prompts: Prompt[] = [];
	for (const line of (typeof settings.prompts === "string" ? settings.prompts : "").split(/\r?\n/)) {
		const separator = line.indexOf("|");
		const label = (separator === -1 ? line : line.slice(0, separator)).trim();
		const text = (separator === -1 ? line : line.slice(separator + 1)).trim();
		if (text.length > 0) {
			prompts.push({ label: label.length > 0 ? label : text, text });
		}
	}
	return prompts.length > 0 ? prompts : DEFAULT_PROMPTS;
}

/**
 * Dial that selects a saved prompt. Turning the dial moves through the list shown on the touch strip,
 * and pressing the dial or tapping the strip types the prompt into the foreground window.
 * Prompt text uses the same key syntax as the Send Text action.
 */
@action({ UUID: "com.claudedeck.controls.saved-prompts" })
export class SavedPrompts extends SingletonAction<Settings> {
	private readonly selections = new Map<string, Selection>();

	override onWillAppear(ev: WillAppearEvent<Settings>): void {
		this.draw(ev.action.id, parsePrompts(ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.selections.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
		this.draw(ev.action.id, parsePrompts(ev.payload.settings));
	}

	override onDialRotate(ev: DialRotateEvent<Settings>): void {
		const prompts = parsePrompts(ev.payload.settings);
		const selection = this.selection(ev.action.id);
		const count = prompts.length;
		selection.index = (((selection.index + ev.payload.ticks) % count) + count) % count;
		this.draw(ev.action.id, prompts);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		await this.send(ev.action, ev.payload.settings);
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		await this.send(ev.action, ev.payload.settings);
	}

	private selection(id: string): Selection {
		let selection = this.selections.get(id);
		if (!selection) {
			selection = { index: 0, lastSent: undefined };
			this.selections.set(id, selection);
		}
		return selection;
	}

	/** Types the highlighted prompt into the foreground window and marks it as sent. */
	private async send(target: { id: string; showAlert(): Promise<void> }, settings: Settings): Promise<void> {
		const prompts = parsePrompts(settings);
		const selection = this.selection(target.id);
		const prompt = prompts[selection.index % prompts.length];
		if (!prompt) {
			return;
		}

		try {
			await keyboard.send(parseSequence(prompt.text, settings.submit !== false));
			selection.lastSent = prompt.text;
			this.draw(target.id, prompts);
		} catch (err) {
			streamDeck.logger.error(`Saved prompt "${prompt.label}" failed: ${err instanceof Error ? err.message : String(err)}`);
			await target.showAlert();
		}
	}

	private draw(id: string, prompts: Prompt[]): void {
		const selection = this.selection(id);
		if (selection.index >= prompts.length) {
			selection.index = 0;
		}
		const sent = selection.lastSent !== undefined && selection.lastSent === prompts[selection.index]?.text;
		const image = svgDataUri(renderPrompts(prompts, selection.index, sent));

		for (const instance of this.actions) {
			if (instance.id === id && instance.isDial()) {
				void instance.setFeedback({ canvas: image });
			}
		}
	}
}
