/**
 * The logger, and the two widgets that report one thing over time.
 *
 * Levels are a fixed vocabulary, not free-form: the same word in the same
 * colour for the same meaning, in every command of every package. That is the
 * whole point of putting this in one place — a `[ warn ]` must look identical
 * whether it comes from a migration, the dev server or an application command.
 *
 * Alert levels go to stderr so a command's data output stays pipeable: a
 * warning must not end up inside `ream list --json | jq` (a named deviation
 * for `warning`, on the method).
 */

import { stdout } from "node:process";
import { sanitize } from "./ansi.js";
import type { Colors, StyleName } from "./colors.js";
import { elapsedSince, formatDuration, type StartTime } from "./duration.js";
import {
	type CapturedLog,
	ConsoleRenderer,
	MemoryRenderer,
	type Renderer,
	type Stream,
} from "./renderers.js";

/** Per-message decoration. */
export interface MessageOptions {
	/** Rendered dim, ahead of the label. `%time%` becomes the current ISO time. */
	prefix?: string | number;
	/** Rendered dim yellow, in parentheses, after the message. */
	suffix?: string | number;
	/**
	 * When the work started; the elapsed time is appended.
	 *
	 * Takes a `Date.now()`, a `process.hrtime()` tuple or a
	 * `process.hrtime.bigint()` — upstream's examples use the tuple, and
	 * subtracting one from a number would quietly render `(NaNm NaNs)`.
	 */
	startTime?: StartTime;
	/**
	 * Build the line but do not write it.
	 *
	 * For a caller that decides per call — a `--quiet` flag threaded through
	 * rather than a second logger.
	 */
	silent?: boolean;
}

export interface LoggerOptions {
	/** Dim the whole message — for output that is context, not the answer. */
	dim?: boolean;
	/** Dim only the labels. Defaults to whatever `dim` is. */
	dimLabels?: boolean;
}

type Level =
	| "success"
	| "error"
	| "fatal"
	| "warning"
	| "info"
	| "debug"
	| "await";

/** The label and colour of every level, in one place. */
const LEVELS: Record<Level, { label: string; colour: StyleName }> = {
	success: { label: "success", colour: "green" },
	error: { label: "error", colour: "red" },
	fatal: { label: "error", colour: "red" },
	warning: { label: "warn", colour: "yellow" },
	info: { label: "info", colour: "blue" },
	debug: { label: "debug", colour: "cyan" },
	await: { label: "wait", colour: "cyan" },
};

export class Logger {
	readonly #options: Required<LoggerOptions>;
	#colors: Colors;
	#renderer: Renderer;
	#stickyPrefix = "";
	#stickySuffix = "";

	constructor(
		colors: Colors,
		renderer: Renderer = new ConsoleRenderer(),
		options: LoggerOptions = {},
	) {
		this.#colors = colors;
		this.#renderer = renderer;
		const dim = options.dim ?? false;
		this.#options = { dim, dimLabels: options.dimLabels ?? dim };
	}

	get colors(): Colors {
		return this.#colors;
	}

	getColors(): Colors {
		return this.#colors;
	}

	useColors(colors: Colors): this {
		this.#colors = colors;
		return this;
	}

	getRenderer(): Renderer {
		return this.#renderer;
	}

	useRenderer(renderer: Renderer): this {
		this.#renderer = renderer;
		return this;
	}

	/** What was captured, each line with the stream it targeted — upstream's shape. */
	getLogs(): CapturedLog[] {
		return this.#renderer.getLogs();
	}

	flushLogs(): void {
		this.#renderer.flushLogs();
	}

	/**
	 * Prepend a fixed marker to EVERY message from now on.
	 *
	 * NAMED DEVIATION — upstream's prefix is per-message (supported too). This
	 * sticky form exists because a command that tags all of its output should
	 * not have to repeat itself on every call.
	 */
	prefix(value: string): this {
		this.#stickyPrefix = value;
		return this;
	}

	suffix(value: string): this {
		this.#stickySuffix = value;
		return this;
	}

	/** A child that shares the colours and the renderer, with its own options. */
	child(options: LoggerOptions = {}): Logger {
		return new Logger(this.#colors, this.#renderer, options);
	}

	/**
	 * A logger that discards everything.
	 *
	 * For a stretch where the output belongs to something else — inside a task
	 * callback, where the task widget owns the terminal and a stray line would
	 * land in the middle of its redraw.
	 */
	dummy(): Logger {
		return new Logger(this.#colors, new MemoryRenderer());
	}

	success(message: string, options: MessageOptions = {}): void {
		if (options.silent === true) return;
		this.#renderer.log(this.prepare("success", message, options), "stdout");
	}

	info(message: string, options: MessageOptions = {}): void {
		if (options.silent === true) return;
		this.#renderer.log(this.prepare("info", message, options), "stdout");
	}

	/**
	 * NAMED DEVIATION — upstream writes a warning to stdout, with success and
	 * info; only `error` and `fatal` go to stderr there. Here a warning goes to
	 * stderr with them: it is a diagnostic, not the command's output, and on
	 * stdout it would land inside `ream list --json | jq` and break the pipe.
	 * An assertion ported from upstream that reads `getLogs()` expects
	 * `stream: 'stderr'` for a warning.
	 */
	warning(message: string, options: MessageOptions = {}): void {
		if (options.silent === true) return;
		this.#renderer.log(this.prepare("warning", message, options), "stderr");
	}

	error(message: string | Error, options: MessageOptions = {}): void {
		if (options.silent === true) return;
		this.#renderer.log(
			this.prepare("error", messageOf(message), options),
			"stderr",
		);
	}

	/** An error plus its stack, indented and dimmed under the message. */
	fatal(message: string | Error, options: MessageOptions = {}): void {
		if (options.silent === true) return;
		const line = this.prepare("fatal", messageOf(message), options);
		const stack =
			message instanceof Error ? this.#formatStack(message.stack) : "";
		this.#renderer.log(`${line}${stack}`, "stderr");
	}

	/**
	 * Always prints, as upstream's does: whether detail is wanted is the
	 * command's decision — its own `--verbose` flag — not an environment
	 * variable read behind its back.
	 */
	debug(message: string, options: MessageOptions = {}): void {
		if (options.silent === true) return;
		this.#renderer.log(this.prepare("debug", message, options), "stdout");
	}

	/**
	 * A line with no decoration at all. Use it for the command's own output.
	 *
	 * The raw escape hatch: unlike every level above, it writes the text as
	 * given, escape sequences included — for a caller printing a hyperlink or
	 * a cursor move on purpose. Never hand it untrusted text.
	 */
	log(message: string, stream: Stream = "stdout"): void {
		this.#renderer.log(message, stream);
	}

	/** The same, on stderr. */
	logError(message: string): void {
		this.#renderer.log(message, "stderr");
	}

	/** Overwrite the line written last — for a progress line of your own. */
	logUpdate(message: string): void {
		this.#renderer.logUpdate(message);
	}

	/** Stop overwriting: the last updated line becomes permanent. */
	logUpdatePersist(): void {
		this.#renderer.logUpdatePersist();
	}

	/** A step whose outcome is reported later. */
	action(title: string): Action {
		return new Action(title, this.#colors, this.#renderer, {
			dim: this.#options.dim,
		});
	}

	/** A message with animated trailing dots, for work of unknown length. */
	await(message: string, options: MessageOptions = {}): Spinner {
		// The spinner's own copy: update() merges into it, never into the
		// caller's object.
		const current = { ...options };
		return new Spinner(
			() => this.prepare("await", message, current),
			this.#renderer,
			options.silent === true,
			(text, changed) => {
				Object.assign(current, changed);
				return () => this.prepare("await", text, current);
			},
		);
	}

	/**
	 * Build the line without writing it.
	 *
	 * Public because that is what makes the format testable on its own, and
	 * what lets a caller put a decorated line somewhere else — inside a box,
	 * say.
	 */
	prepare(level: Level, message: string, options: MessageOptions = {}): string {
		const { label, colour } = LEVELS[level];
		const safe = sanitize(message);
		let text = this.#options.dim ? this.#colors.dim(safe) : safe;
		text = `${this.#label(colour, label)} ${text}`;

		const prefix = options.prefix ?? this.#stickyPrefix;
		if (prefix !== "") {
			// Not dimmed on top of dim: grey on grey stops being readable.
			const resolved = sanitize(String(prefix)).replace(
				/%time%/g,
				new Date().toISOString(),
			);
			text = `${this.#colors.dim(`[${resolved}]`)} ${text}`;
		}

		const suffix = options.suffix ?? this.#stickySuffix;
		if (suffix !== "") {
			text = `${text} ${this.#colors.dim.yellow(`(${sanitize(String(suffix))})`)}`;
		}

		if (options.startTime !== undefined) {
			const elapsed = formatDuration(elapsedSince(options.startTime));
			text = `${text} ${this.#colors.dim(`(${elapsed})`)}`;
		}

		return text;
	}

	/**
	 * One `prepare` per level, mirroring the levels themselves.
	 *
	 * `prepare('info', …)` says the same thing; these exist because a caller
	 * building a line to put somewhere else reaches for the name it already
	 * uses to log it.
	 */
	prepareSuccess(message: string, options: MessageOptions = {}): string {
		return this.prepare("success", message, options);
	}

	prepareInfo(message: string, options: MessageOptions = {}): string {
		return this.prepare("info", message, options);
	}

	prepareWarning(message: string, options: MessageOptions = {}): string {
		return this.prepare("warning", message, options);
	}

	prepareError(message: string | Error, options: MessageOptions = {}): string {
		return this.prepare("error", messageOf(message), options);
	}

	prepareFatal(message: string | Error, options: MessageOptions = {}): string {
		const line = this.prepare("fatal", messageOf(message), options);
		return message instanceof Error
			? `${line}${this.#formatStack(message.stack)}`
			: line;
	}

	prepareDebug(message: string, options: MessageOptions = {}): string {
		return this.prepare("debug", message, options);
	}

	#label(colour: StyleName, text: string): string {
		const coloured = this.#colors[colour](text);
		return this.#options.dimLabels
			? `[ ${this.#colors.dim(coloured)} ]`
			: `[ ${coloured} ]`;
	}

	#formatStack(stack: string | undefined): string {
		if (stack === undefined) return "";
		return `\n${stack
			.split("\n")
			.slice(1)
			.map((line) => `      ${this.#colors.dim(sanitize(line.trim()))}`)
			.join("\n")}`;
	}
}

/**
 * One step, reported once it is over.
 *
 *   const create = logger.action('creating config/auth.ts')
 *   try { …; create.displayDuration().succeeded() }
 *   catch (error) { create.failed(error) }
 *
 * The labels are padded to the same width so a column of actions lines up.
 */
export class Action {
	readonly #title: string;
	readonly #colors: Colors;
	readonly #renderer: Renderer;
	readonly #dim: boolean;
	readonly #startedAt = Date.now();
	#withDuration = false;

	constructor(
		title: string,
		colors: Colors,
		renderer: Renderer,
		options: { dim?: boolean } = {},
	) {
		this.#title = title;
		this.#colors = colors;
		this.#renderer = renderer;
		this.#dim = options.dim ?? false;
	}

	/** Append how long the action took. */
	displayDuration(): this {
		this.#withDuration = true;
		return this;
	}

	succeeded(): void {
		this.#renderer.log(this.prepareSucceeded(), "stdout");
	}

	skipped(reason?: string): void {
		this.#renderer.log(this.prepareSkipped(reason), "stdout");
	}

	failed(error: unknown): void {
		this.#renderer.log(this.prepareFailed(error), "stderr");
	}

	/** The three outcome lines, built without writing them. */
	prepareSucceeded(): string {
		return this.prepare("DONE", "green");
	}

	prepareSkipped(reason?: string): string {
		const suffix =
			reason === undefined
				? ""
				: ` ${this.#colors.dim(`(${sanitize(reason)})`)}`;
		return `${this.prepare("SKIPPED", "cyan")}${suffix}`;
	}

	prepareFailed(error: unknown): string {
		return `${this.prepare("FAILED", "red")}${this.#formatError(error)}`;
	}

	/** The line without writing it — same reason as `Logger.prepare`. */
	prepare(label: string, colour: "green" | "cyan" | "red"): string {
		// Padded on the LABEL, not the coloured string: escape codes occupy no
		// columns, and padding them would leave the column ragged.
		const padded = `${label}:`.padEnd(LABEL_WIDTH, " ");
		const tag = this.#colors[colour](padded);
		const safe = sanitize(this.#title);
		const title = this.#dim ? this.#colors.dim(safe) : safe;
		const duration = this.#withDuration
			? ` ${this.#colors.dim(`(${formatDuration(Date.now() - this.#startedAt)})`)}`
			: "";
		return `${this.#dim ? this.#colors.dim(tag) : tag} ${title}${duration}`;
	}

	#formatError(error: unknown): string {
		const detail =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		return `\n${detail
			.split("\n")
			.map((line) => `      ${this.#colors.red(sanitize(line.trim()))}`)
			.join("\n")}`;
	}
}

/** `SKIPPED:` is the longest label, and everything aligns on it. */
const LABEL_WIDTH = "SKIPPED:".length;

/**
 * Turns the text and options given to `Spinner.update()` into the function
 * that renders the line — called once per update, the line itself per frame.
 */
export type SpinnerDecorator = (
	text: string,
	options: MessageOptions,
) => () => string;

/**
 * A message with animated trailing dots.
 *
 * Only animates on a TTY: on a pipe, or with a memory renderer, one line per
 * frame would be noise in a log and unassertable in a test — so it prints once
 * and each `update` once more.
 */
export class Spinner {
	static readonly FRAMES = [".  ", ".. ", "...", " ..", "  .", "   "];
	static readonly INTERVAL = 200;

	#render: () => string;
	readonly #decorate: SpinnerDecorator;
	readonly #renderer: Renderer;
	#timer: ReturnType<typeof setInterval> | undefined;
	#writer: ((line: string) => void) | undefined;
	readonly #silent: boolean;
	#frame = 0;
	/**
	 * Drives everything, as upstream's does: start() only from idle, update()
	 * only while running. Without it a second start() leaked an interval that
	 * kept redrawing over whatever was printed after stop().
	 */
	#state: "idle" | "running" | "stopped" = "idle";

	/**
	 * `decorate` turns the text given to `update()` back into a full line —
	 * for the logger's spinner, the `[ wait ]` label with its prefix and
	 * suffix. A spinner built bare shows the text as it is.
	 */
	constructor(
		render: () => string,
		renderer: Renderer,
		silent = false,
		decorate: SpinnerDecorator = (text) => () => text,
	) {
		this.#render = render;
		this.#renderer = renderer;
		this.#silent = silent;
		this.#decorate = decorate;
	}

	start(): this {
		if (this.#silent || this.#state !== "idle") return this;
		this.#state = "running";
		if (!this.#animatable()) {
			this.#renderer.log(this.#line(), "stdout");
			return this;
		}
		this.#draw();
		this.#timer = setInterval(() => {
			this.#frame = (this.#frame + 1) % Spinner.FRAMES.length;
			this.#draw();
		}, Spinner.INTERVAL);
		// Never hold the process open for a decoration.
		this.#timer.unref?.();
		return this;
	}

	/**
	 * Change the text, keeping the label and the options — upstream's
	 * `update(text, options)`, the options merged into the ones given so far.
	 * A function instead replaces the whole line, for a caller rendering its
	 * own.
	 */
	update(render: string | (() => string), options: MessageOptions = {}): this {
		if (this.#silent || this.#state !== "running") return this;
		this.#render =
			typeof render === "string" ? this.#decorate(render, options) : render;
		this.#frame = 0;
		if (this.#animatable()) this.#draw();
		else this.#renderer.log(this.#line(), "stdout");
		return this;
	}

	/**
	 * Write the animation yourself instead of letting the renderer do it.
	 *
	 * For a caller that already owns a region of the terminal — a task widget
	 * redrawing several lines — where a spinner writing on its own would land
	 * in the middle of someone else's frame.
	 */
	tap(writer: (line: string) => void): this {
		this.#writer = writer;
		return this;
	}

	stop(): void {
		this.#state = "stopped";
		if (this.#timer === undefined) return;
		clearInterval(this.#timer);
		this.#timer = undefined;
		// A tapped spinner's output belongs to the caller. Otherwise the line
		// settles on the full `...` frame, as upstream leaves it.
		if (this.#writer !== undefined) return;
		this.#renderer.logUpdate(`${this.#line()} ${Spinner.FRAMES[2] ?? ""}`);
		this.#renderer.logUpdatePersist();
	}

	#draw(): void {
		const line = `${this.#line()} ${Spinner.FRAMES[this.#frame] ?? ""}`;
		if (this.#writer !== undefined) {
			this.#writer(line);
			return;
		}
		this.#renderer.logUpdate(line);
	}

	/** The text, never trusted: `update()` takes it straight from the caller. */
	#line(): string {
		return sanitize(this.#render());
	}

	#animatable(): boolean {
		// A tapped spinner animates wherever it is: the caller took
		// responsibility for the output, so the TTY question is theirs.
		if (this.#writer !== undefined) return true;
		return this.#renderer instanceof ConsoleRenderer && stdout.isTTY === true;
	}
}

function messageOf(value: unknown): string {
	if (value instanceof Error) return value.message;
	return String(value);
}
