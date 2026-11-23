/**
 * Lumen errors, one per code, so a caller can match on `error.code` or on
 * `error instanceof errors.E_…` rather than on the message.
 */
import { createError } from "@c9up/flare";

/** A table was asked for a shape it does not have: a column, a width or a span. */
export const E_LUMEN_INVALID_COLUMN = createError<[string]>(
	"%s",
	"E_LUMEN_INVALID_COLUMN",
);

/**
 * A task failed with something that is not an `Error`; the message is that
 * value's text and `cause` holds the value itself.
 */
export const E_LUMEN_TASK_FAILED = createError<[string]>(
	"%s",
	"E_LUMEN_TASK_FAILED",
);

/** A task callback returned nothing and did not mark the task itself. */
export const E_LUMEN_TASK_NO_RESULT = createError(
	"the task returned no result: return a success message, or an Error",
	"E_LUMEN_TASK_NO_RESULT",
);

/** An invariant inside lumen broke: a bug to report. */
export const E_LUMEN_INTERNAL = createError<[string]>(
	"unreachable: %s",
	"E_LUMEN_INTERNAL",
);
