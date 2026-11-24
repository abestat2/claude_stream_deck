import { describe, expect, it } from "vitest";
import { AlertConfig, DEFAULT_ALERT_SETTINGS, parseAlertSettings } from "../../src/alerts/config";

describe("parseAlertSettings", () => {
	it("returns the defaults for an empty object", () => {
		expect(parseAlertSettings({})).toEqual({ sound: true, toast: true, onDone: false, escalateMinutes: 3 });
	});

	it("returns the defaults for non-object input", () => {
		for (const value of [undefined, null, "text", 5, true]) {
			expect(parseAlertSettings(value)).toEqual(DEFAULT_ALERT_SETTINGS);
		}
	});

	it("reads each boolean key", () => {
		expect(parseAlertSettings({ alertSound: false, alertToast: false, alertOnDone: true })).toMatchObject({
			sound: false,
			toast: false,
			onDone: true,
		});
	});

	it("treats only false as disabling sound and toast", () => {
		for (const value of [true, 0, "false", null, undefined, ""]) {
			const parsed = parseAlertSettings({ alertSound: value, alertToast: value });
			expect(parsed.sound).toBe(true);
			expect(parsed.toast).toBe(true);
		}
	});

	it("treats only true as enabling onDone", () => {
		for (const value of [false, 1, "true", null, undefined]) {
			expect(parseAlertSettings({ alertOnDone: value }).onDone).toBe(false);
		}
	});

	it("accepts numeric escalation minutes including zero and fractions", () => {
		expect(parseAlertSettings({ escalateMinutes: 10 }).escalateMinutes).toBe(10);
		expect(parseAlertSettings({ escalateMinutes: 0 }).escalateMinutes).toBe(0);
		expect(parseAlertSettings({ escalateMinutes: 0.5 }).escalateMinutes).toBe(0.5);
	});

	it("accepts numeric strings", () => {
		expect(parseAlertSettings({ escalateMinutes: "5" }).escalateMinutes).toBe(5);
		expect(parseAlertSettings({ escalateMinutes: "0" }).escalateMinutes).toBe(0);
	});

	it("uses the default for an empty string", () => {
		expect(parseAlertSettings({ escalateMinutes: "" }).escalateMinutes).toBe(3);
	});

	it("uses the default for negative numbers", () => {
		expect(parseAlertSettings({ escalateMinutes: -1 }).escalateMinutes).toBe(3);
		expect(parseAlertSettings({ escalateMinutes: "-5" }).escalateMinutes).toBe(3);
	});

	it("uses the default for non-numeric and non-finite values", () => {
		for (const value of ["abc", NaN, Infinity, -Infinity, {}, "Infinity"]) {
			expect(parseAlertSettings({ escalateMinutes: value }).escalateMinutes).toBe(3);
		}
	});

	it("uses the default when escalateMinutes is missing", () => {
		expect(parseAlertSettings({ alertSound: false }).escalateMinutes).toBe(3);
	});
});

describe("AlertConfig", () => {
	it("starts with the default settings", () => {
		expect(new AlertConfig().get()).toEqual(DEFAULT_ALERT_SETTINGS);
	});

	it("replaces settings with parsed values", () => {
		const config = new AlertConfig();
		config.set({ alertSound: false, escalateMinutes: "7", alertOnDone: true });
		expect(config.get()).toEqual({ sound: false, toast: true, onDone: true, escalateMinutes: 7 });
	});

	it("resets omitted keys to defaults on each set", () => {
		const config = new AlertConfig();
		config.set({ alertSound: false });
		config.set({});
		expect(config.get()).toEqual(DEFAULT_ALERT_SETTINGS);
	});

	it("falls back to defaults for invalid input", () => {
		const config = new AlertConfig();
		config.set({ escalateMinutes: 9 });
		config.set(null);
		expect(config.get()).toEqual(DEFAULT_ALERT_SETTINGS);
	});
});

describe("parseAlertSettings escalation values", () => {
	it.each([[null], [false], [true], ["  "], [[]], [{}]])("uses the default escalation for %j", (value) => {
		expect(parseAlertSettings({ escalateMinutes: value }).escalateMinutes).toBe(DEFAULT_ALERT_SETTINGS.escalateMinutes);
	});

	it("accepts zero as a number and as a string to disable escalation", () => {
		expect(parseAlertSettings({ escalateMinutes: 0 }).escalateMinutes).toBe(0);
		expect(parseAlertSettings({ escalateMinutes: "0" }).escalateMinutes).toBe(0);
	});
});
