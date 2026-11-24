import { describe, expect, it } from "vitest";
import { computePace, LOOKBACK_MS, MIN_SPAN_MS, type Sample } from "../../src/usage/pace";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse("2026-03-01T12:00:00Z");
const LOOKBACK = 12 * HOUR;

const sample = (minutesAgo: number, percent: number): Sample => ({ at: NOW - minutesAgo * MINUTE, percent });
const resetIn = (ms: number) => new Date(NOW + ms);

describe("constants", () => {
	it("defines the lookback period per window", () => {
		expect(LOOKBACK_MS).toEqual({ session: 30 * MINUTE, week: 12 * HOUR, sonnet: 12 * HOUR });
	});

	it("defines the minimum span as five minutes", () => {
		expect(MIN_SPAN_MS).toBe(5 * MINUTE);
	});
});

describe("computePace", () => {
	describe("projection", () => {
		it("reports the time to the limit when it comes before the reset", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, resetIn(6 * HOUR), LOOKBACK);
			expect(pace).toEqual({ ratePerHour: 20, limitInMs: 4 * HOUR, projectedAtReset: undefined });
		});

		it("reports the projected percentage when the reset comes first", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, resetIn(2 * HOUR), LOOKBACK);
			expect(pace).toEqual({ ratePerHour: 20, limitInMs: undefined, projectedAtReset: 60 });
		});

		it("treats the limit and the reset arriving together as the reset coming first", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, resetIn(4 * HOUR), LOOKBACK);
			expect(pace).toEqual({ ratePerHour: 20, limitInMs: undefined, projectedAtReset: 100 });
		});

		it("reports the limit when it comes one millisecond before the reset", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, resetIn(4 * HOUR + 1), LOOKBACK);
			expect(pace?.limitInMs).toBe(4 * HOUR);
			expect(pace?.projectedAtReset).toBeUndefined();
		});

		it("reports only the time to the limit when the reset time is unknown", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, undefined, LOOKBACK);
			expect(pace).toEqual({ ratePerHour: 20, limitInMs: 4 * HOUR, projectedAtReset: undefined });
		});

		it("treats an invalid reset date as an unknown reset time", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, new Date(Number.NaN), LOOKBACK);
			expect(pace).toEqual({ ratePerHour: 20, limitInMs: 4 * HOUR, projectedAtReset: undefined });
		});

		it("computes fractional rates", () => {
			const pace = computePace([sample(60, 50), sample(0, 51)], NOW, undefined, LOOKBACK);
			expect(pace?.ratePerHour).toBeCloseTo(1, 10);
			expect(pace?.limitInMs).toBeCloseTo(49 * HOUR, 3);
		});

		it("measures the rate over the span between the readings, not the lookback", () => {
			const pace = computePace([sample(10, 40), sample(0, 45)], NOW, resetIn(HOUR), LOOKBACK);
			expect(pace?.ratePerHour).toBeCloseTo(30, 10);
			expect(pace?.projectedAtReset).toBeCloseTo(75, 10);
		});

		it("does not require the newest reading to be at the current time", () => {
			const pace = computePace([sample(40, 10), sample(10, 20)], NOW, resetIn(2 * HOUR), LOOKBACK);
			expect(pace?.ratePerHour).toBeCloseTo(20, 10);
			expect(pace?.projectedAtReset).toBeCloseTo(60, 10);
		});
	});

	describe("minimum history", () => {
		it("returns undefined without readings", () => {
			expect(computePace([], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("returns undefined with one reading", () => {
			expect(computePace([sample(0, 20)], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("accepts a span of exactly the minimum", () => {
			const pace = computePace([{ at: NOW - MIN_SPAN_MS, percent: 10 }, { at: NOW, percent: 11 }], NOW, undefined, LOOKBACK);
			expect(pace?.ratePerHour).toBeCloseTo(12, 10);
		});

		it("rejects a span one millisecond under the minimum", () => {
			expect(computePace([{ at: NOW - MIN_SPAN_MS + 1, percent: 10 }, { at: NOW, percent: 11 }], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("rejects readings taken at the same instant", () => {
			expect(computePace([sample(0, 10), sample(0, 20)], NOW, undefined, LOOKBACK)).toBeUndefined();
		});
	});

	describe("lookback", () => {
		it("ignores readings older than the lookback", () => {
			const samples = [sample(60, 0), sample(20, 10), sample(0, 20)];
			const pace = computePace(samples, NOW, undefined, 30 * MINUTE);
			expect(pace?.ratePerHour).toBeCloseTo(30, 10);
		});

		it("includes a reading exactly at the lookback age", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, undefined, 30 * MINUTE);
			expect(pace?.ratePerHour).toBeCloseTo(20, 10);
		});

		it("excludes a reading one millisecond older than the lookback", () => {
			const samples = [{ at: NOW - 30 * MINUTE - 1, percent: 10 }, sample(0, 20)];
			expect(computePace(samples, NOW, undefined, 30 * MINUTE)).toBeUndefined();
		});

		it("returns undefined when fewer than two readings are inside the lookback", () => {
			expect(computePace([sample(120, 10), sample(100, 15), sample(0, 20)], NOW, undefined, 30 * MINUTE)).toBeUndefined();
		});

		it("uses only the oldest and newest readings inside the lookback", () => {
			const samples = [sample(30, 10), sample(20, 50), sample(10, 12), sample(0, 20)];
			const pace = computePace(samples, NOW, undefined, 30 * MINUTE);
			expect(pace?.ratePerHour).toBeCloseTo(20, 10);
		});

		it("uses a different rate when the lookback excludes the oldest reading", () => {
			const samples = [sample(60, 0), sample(30, 10), sample(0, 40)];
			expect(computePace(samples, NOW, undefined, 60 * MINUTE)?.ratePerHour).toBeCloseTo(40, 10);
			expect(computePace(samples, NOW, undefined, 30 * MINUTE)?.ratePerHour).toBeCloseTo(60, 10);
		});
	});

	describe("no pace", () => {
		it("returns undefined when usage decreased", () => {
			expect(computePace([sample(30, 20), sample(0, 10)], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("returns undefined when usage is flat", () => {
			expect(computePace([sample(30, 20), sample(0, 20)], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("returns undefined when the newest reading is 100", () => {
			expect(computePace([sample(30, 90), sample(0, 100)], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("returns undefined when the newest reading is above 100", () => {
			expect(computePace([sample(30, 90), sample(0, 104)], NOW, undefined, LOOKBACK)).toBeUndefined();
		});

		it("accepts a newest reading just under 100", () => {
			const pace = computePace([sample(30, 98), sample(0, 99.5)], NOW, undefined, LOOKBACK);
			expect(pace?.limitInMs).toBeCloseTo(10 * MINUTE, 3);
		});

		it("returns undefined when the reset time is now", () => {
			expect(computePace([sample(30, 10), sample(0, 20)], NOW, new Date(NOW), LOOKBACK)).toBeUndefined();
		});

		it("returns undefined when the reset time is in the past", () => {
			expect(computePace([sample(30, 10), sample(0, 20)], NOW, new Date(NOW - MINUTE), LOOKBACK)).toBeUndefined();
		});

		it("accepts a reset time one millisecond ahead", () => {
			const pace = computePace([sample(30, 10), sample(0, 20)], NOW, new Date(NOW + 1), LOOKBACK);
			expect(pace?.limitInMs).toBeUndefined();
			expect(pace?.projectedAtReset).toBeCloseTo(20, 3);
		});
	});
});
