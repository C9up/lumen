/**
 * Lumen — terminal output for the Ream ecosystem.
 *
 *   import { lumen } from '@c9up/lumen'
 *
 *   const ui = lumen()
 *   ui.logger.success('migrated 3 files')
 *   ui.table().head(['Name', 'Batch']).row(['users', '1']).render()
 *
 * Colours alone, without the widgets or anything from `node:`, are on
 * `@c9up/lumen/colors`; the layout primitives are on `@c9up/lumen/helpers`.
 */

export { type BorderPainter, Box } from "./box.js";
export {
	ansiColors,
	type ColorStream,
	type Colors,
	rawColors,
	STYLE_NAMES,
	type StyleName,
	silentColors,
	stripAnsi,
	supportsColor,
} from "./colors.js";
export { formatDuration } from "./duration.js";
export {
	type JustifyOptions,
	justify,
	stringWidth,
	type TruncateOptions,
	terminalWidth,
	truncate,
	type WrapOptions,
	wrap,
} from "./helpers.js";
export { type Icons, icons, iconsFor } from "./icons.js";
export {
	Action,
	Logger,
	type LoggerOptions,
	type MessageOptions,
	Spinner,
} from "./logger.js";
export {
	type CapturedLog,
	ConsoleRenderer,
	MemoryRenderer,
	type Renderer,
	type Stream,
} from "./renderers.js";
export { Steps } from "./steps.js";
export {
	InvalidColumnError,
	Table,
	type TableCell,
	type TableInput,
} from "./table.js";
export {
	TaskContext,
	type TaskOutcome,
	Tasks,
	type TasksOptions,
} from "./tasks.js";
export { type LumenOptions, lumen, Ui, type UiMode } from "./ui.js";
