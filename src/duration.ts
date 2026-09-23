/**
 * A moment something started, in any of the three shapes Node hands you.
 *
 * `Date.now()` is what most callers have. The other two are there because
 * upstream's example is `process.hrtime()`, and a tuple silently subtracted
 * from a number gives `NaN` — a duration that reads `(NaNm NaNs)` and points
 * at nothing.
 */
export type StartTime = number | bigint | [number, number];

/** Milliseconds elapsed since `start`, whichever shape it came in. */
export function elapsedSince(start: StartTime, now = Date.now()): number {
	if (typeof start === "number") return now - start;
	// `process.hrtime.bigint()` — nanoseconds against an arbitrary origin, so
	// it is measured against itself, never against the wall clock.
	if (typeof start === "bigint") {
		return Number(process.hrtime.bigint() - start) / 1e6;
	}
	// `process.hrtime()` — [seconds, nanoseconds] since the same origin, and
	// passing it back gives the difference directly.
	const [seconds, nanoseconds] = process.hrtime(start);
	return seconds * 1000 + nanoseconds / 1e6;
}

/**
 * How long something took, in the shortest form that is still precise.
 *
 * NAMED DEVIATION — upstream formats durations with `pretty-hrtime` and a
 * nanosecond tuple. This package carries no dependency, and a CLI reporting
 * "412ms" does not need nanoseconds: the caller passes a `Date.now()`, which
 * is what the callers already had.
 */
export function formatDuration(milliseconds: number): string {
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	const seconds = milliseconds / 1000;
	if (seconds < 60) return `${seconds.toFixed(2)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
