/** User-selected alert behavior, stored in the plugin's global settings. */
export type AlertSettings = {
	/** Plays a sound when an alert fires. */
	sound: boolean;
	/** Shows a Windows notification when an alert fires. */
	toast: boolean;
	/** Alerts when a session finishes a turn without a question. */
	onDone: boolean;
	/** Minutes a session may wait before it is treated as escalated and alerts again. 0 disables escalation. */
	escalateMinutes: number;
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { sound: true, toast: true, onDone: false, escalateMinutes: 3 };

/**
 * Converts raw global settings to alert settings. Missing or invalid values use the defaults.
 * Keys: `alertSound`, `alertToast`, `alertOnDone`, `escalateMinutes`.
 */
export function parseAlertSettings(raw: unknown): AlertSettings {
	const values = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	const raw = values.escalateMinutes;
	const minutes = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
	return {
		sound: values.alertSound !== false,
		toast: values.alertToast !== false,
		onDone: values.alertOnDone === true,
		escalateMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_ALERT_SETTINGS.escalateMinutes,
	};
}

/** Holds the current alert settings so every consumer sees updates. */
export class AlertConfig {
	private current: AlertSettings = DEFAULT_ALERT_SETTINGS;

	get(): AlertSettings {
		return this.current;
	}

	/** Replaces the settings with those parsed from raw global settings. */
	set(raw: unknown): void {
		this.current = parseAlertSettings(raw);
	}
}
