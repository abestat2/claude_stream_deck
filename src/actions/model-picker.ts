import streamDeck, {
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import { keyboard } from "../input/keyboard";
import { parseSequence } from "../input/sequence";
import { renderPicker } from "../render/picker";
import { svgDataUri } from "../render/character";

type Settings = {
	/** Model names, one per line, as accepted by the `/model` command. */
	models?: string;
};

const DEFAULT_MODELS = ["opus", "sonnet", "haiku"];

type Selection = {
	index: number;
	lastSent: string | undefined;
};

/** Parses the models setting into a list of names, falling back to the defaults when empty. */
function parseModels(settings: Settings): string[] {
	const names = (typeof settings.models === "string" ? settings.models : "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return names.length > 0 ? names : DEFAULT_MODELS;
}

/**
 * Dial that selects a model from a configured list. Turning the dial moves through the list,
 * and pressing the dial or tapping the strip sends `/model <name>` to the foreground window.
 */
@action({ UUID: "com.claudedeck.controls.model-picker" })
export class ModelPicker extends SingletonAction<Settings> {
	private readonly selections = new Map<string, Selection>();

	override onWillAppear(ev: WillAppearEvent<Settings>): void {
		this.draw(ev.action, parseModels(ev.payload.settings));
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
		this.draw(ev.action, parseModels(ev.payload.settings));
	}

	override onDialRotate(ev: DialRotateEvent<Settings>): void {
		const models = parseModels(ev.payload.settings);
		const selection = this.selection(ev.action.id);
		const count = models.length;
		selection.index = (((selection.index + ev.payload.ticks) % count) + count) % count;
		this.draw(ev.action, models);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		await this.send(ev.action, parseModels(ev.payload.settings));
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		await this.send(ev.action, parseModels(ev.payload.settings));
	}

	private selection(id: string): Selection {
		let selection = this.selections.get(id);
		if (!selection) {
			selection = { index: 0, lastSent: undefined };
			this.selections.set(id, selection);
		}
		return selection;
	}

	/** Sends the highlighted model to the foreground window and marks it as sent. */
	private async send(target: { id: string; isDial(): boolean; showAlert(): Promise<void> }, models: string[]): Promise<void> {
		const selection = this.selection(target.id);
		const name = models[selection.index % models.length] ?? "";

		try {
			await keyboard.send(parseSequence(`/model ${name.replace(/[{}]/g, (c) => c + c)}`, true));
			selection.lastSent = name;
			this.drawById(target.id, models);
		} catch (err) {
			streamDeck.logger.error(`Model switch to "${name}" failed: ${err instanceof Error ? err.message : String(err)}`);
			await target.showAlert();
		}
	}

	private draw(target: { id: string; isDial(): boolean }, models: string[]): void {
		this.drawById(target.id, models);
	}

	private drawById(id: string, models: string[]): void {
		const selection = this.selection(id);
		if (selection.index >= models.length) {
			selection.index = 0;
		}
		const name = models[selection.index] ?? "";
		const image = svgDataUri(renderPicker(models, selection.index, selection.lastSent === name));

		for (const instance of this.actions) {
			if (instance.id === id && instance.isDial()) {
				void instance.setFeedback({ canvas: image });
			}
		}
	}
}
