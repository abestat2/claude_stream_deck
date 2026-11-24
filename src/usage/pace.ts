import type { WindowId } from "./client";

/** One reading of a window's usage. */
export type Sample = {
	/** Epoch milliseconds of the reading. */
	at: number;
	/** Percentage of the window's limit used. */
	percent: number;
};

/** How fast a window is being used, and what that means for its limit. */
export type Pace = {
	/** Percentage points used per hour over the lookback period. */
	ratePerHour: number;
	/** Milliseconds until the window reaches 100% at this rate. Set only when that happens before the window resets. */
	limitInMs: number | undefined;
	/** Percentage the window reaches when it resets, at this rate. Set only when it stays below 100%. */
	projectedAtReset: number | undefined;
};

/** How far back readings are used to measure the rate, per window. */
export const LOOKBACK_MS: Record<WindowId, number> = {
	session: 30 * 60_000,
	week: 12 * 60 * 60_000,
	sonnet: 12 * 60 * 60_000,
};

/** Shortest span between the first and last reading that is used to measure a rate. */
export const MIN_SPAN_MS = 5 * 60_000;

const HOUR_MS = 3_600_000;

/**
 * Measures how fast a window is being used and projects the result.
 *
 * The rate is the increase between the oldest and newest reading inside the lookback period, so the
 * projection assumes use continues at that rate until the window resets.
 * @param samples Readings in time order.
 * @param now Epoch milliseconds to measure from.
 * @param resetsAt When the window resets, when known.
 * @param lookbackMs How far back readings count.
 * @returns undefined when there is too little history, usage is not increasing, the limit is already
 * reached, or the reset time has passed.
 */
export function computePace(samples: readonly Sample[], now: number, resetsAt: Date | undefined, lookbackMs: number): Pace | undefined {
	const recent = samples.filter((sample) => now - sample.at <= lookbackMs);
	const first = recent[0];
	const last = recent[recent.length - 1];
	if (!first || !last || recent.length < 2) {
		return undefined;
	}

	const spanMs = last.at - first.at;
	const increase = last.percent - first.percent;
	if (spanMs < MIN_SPAN_MS || increase <= 0 || last.percent >= 100) {
		return undefined;
	}

	const msToReset = resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt.getTime() - now : undefined;
	if (msToReset !== undefined && msToReset <= 0) {
		return undefined;
	}

	const ratePerHour = increase / (spanMs / HOUR_MS);
	const msToLimit = ((100 - last.percent) / ratePerHour) * HOUR_MS;
	const hitsLimitFirst = msToReset === undefined || msToLimit < msToReset;

	return {
		ratePerHour,
		limitInMs: hitsLimitFirst ? msToLimit : undefined,
		projectedAtReset: hitsLimitFirst || msToReset === undefined ? undefined : last.percent + ratePerHour * (msToReset / HOUR_MS),
	};
}
