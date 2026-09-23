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
