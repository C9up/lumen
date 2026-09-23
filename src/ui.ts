/**
 * The UI: one object carrying the colours, the logger and the widgets.
 *
 * Its reason to exist is {@link Ui.switchMode}. A command writes the same code
 * in every mode; the mode decides whether that lands on a terminal with escape
 * codes, on a pipe without them, or in an array a test can assert on. Nothing
 * downstream branches on it — which is what keeps `if (process.env.NODE_ENV)`
 * out of rendering code.
 */

import { Box } from "./box.js";
import {
	ansiColors,
	type Colors,
	rawColors,
	silentColors,
	supportsColor,
} from "./colors.js";
import { type Icons, icons } from "./icons.js";
import { Logger, type LoggerOptions } from "./logger.js";
import {
	type CapturedLog,
	ConsoleRenderer,
	MemoryRenderer,
	type Renderer,
	type Stream,
} from "./renderers.js";
import { Steps } from "./steps.js";
import { Table } from "./table.js";
import { Tasks, type TasksOptions } from "./tasks.js";

export type UiMode = "normal" | "silent" | "raw";

export class Ui {
	#mode: UiMode;
	#colors: Colors;
	#renderer: Renderer;
	#logger: Logger;
	#lastTable: Table | undefined;

	constructor(mode: UiMode = "normal", options: LoggerOptions = {}) {
		this.#mode = mode;
		this.#colors = colorsFor(mode);
		this.#renderer = rendererFor(mode);
		this.#logger = new Logger(this.#colors, this.#renderer, options);
	}

	get mode(): UiMode {
		return this.#mode;
	}

	get colors(): Colors {
		return this.#colors;
	}

	get logger(): Logger {
		return this.#logger;
	}

	get icons(): Icons {
		return icons;
	}

	/**
	 * Swap the mode, and with it the colours and where lines go.
	 *
	 * Switching to raw CLEARS what was captured: a test that switches at the
	 * top of a case must not see the previous case's lines.
	 */
	switchMode(mode: UiMode): this {
		this.#mode = mode;
		this.#colors = colorsFor(mode);
		this.#renderer = rendererFor(mode);
		this.#logger.useColors(this.#colors).useRenderer(this.#renderer);
		this.#lastTable = undefined;
		return this;
	}

	useRenderer(renderer: Renderer): this {
		this.#renderer = renderer;
		this.#logger.useRenderer(renderer);
		return this;
	}

	useColors(colors: Colors): this {
		this.#colors = colors;
		this.#logger.useColors(colors);
		return this;
	}

	/** The single sink every widget writes through. */
	write(line: string, stream: Stream = "stdout"): void {
		this.#renderer.log(line, stream);
	}

	/** Everything written since raw mode was switched on. */
	getLogs(): string[] {
		return this.#renderer.getLogs().map((entry) => entry.message);
	}

	/** The same lines with the stream each one targeted. */
	getCapturedLogs(): CapturedLog[] {
		return this.#renderer.getLogs();
	}

	flushLogs(): void {
		this.#renderer.flushLogs();
	}

	/**
	 * Rows of the last table built through this UI, as they were given.
	 *
	 * Assertions compare DATA, not layout: a test should not break because a
	 * column grew wider.
	 */
	getTableRows(): string[][] {
		return this.#lastTable?.getRows() ?? [];
	}

	/** The head cells, kept apart so a test can assert the data alone. */
	getTableHead(): string[] {
		return this.#lastTable?.getHead() ?? [];
	}

	table(): Table {
		const table = new Table(this.#colors, this.#renderer);
		this.#lastTable = table;
		return table;
	}

	/** A highlighted block. */
	sticker(): Box {
		return new Box(this.#colors, this.#renderer);
	}

	/** The same box, every line marked with a pointer. */
	instructions(): Box {
		return new Box(this.#colors, this.#renderer, { pointer: true });
	}

	steps(): Steps {
		return new Steps(this.#colors, this.#renderer);
	}

	tasks(options: TasksOptions = {}): Tasks {
		return new Tasks(this.#colors, this.#renderer, options);
	}
}

function colorsFor(mode: UiMode): Colors {
	if (mode === "raw") return rawColors();
	if (mode === "silent") return silentColors();
	return ansiColors();
}

function rendererFor(mode: UiMode): Renderer {
	return mode === "raw" ? new MemoryRenderer() : new ConsoleRenderer();
}

export interface LumenOptions extends LoggerOptions {
	/**
	 * Force a mode. Left out, the terminal is asked: a stream that does not
	 * understand escape codes gets `silent`, so nothing downstream has to
	 * check again.
	 */
	mode?: UiMode;
}

/** Build a UI, detecting the mode when it is not given. */
export function lumen(options: LumenOptions = {}): Ui {
	const { mode, ...loggerOptions } = options;
	return new Ui(mode ?? (supportsColor() ? "normal" : "silent"), loggerOptions);
}
