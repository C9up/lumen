/**
 * The logger, and the two widgets that report one thing over time.
 *
 * Levels are a fixed vocabulary, not free-form: the same word in the same
 * colour for the same meaning, in every command of every package. That is the
 * whole point of putting this in one place — a `[ warn ]` must look identical
 * whether it comes from a migration, the dev server or an application command.
 *
 * Alert levels go to stderr so a command's data output stays pipeable: a
 * warning must not end up inside `ream list --json | jq`.
 */

import { stdout } from "node:process";
import type { Colors, StyleName } from "./colors.js";
import { formatDuration } from "./duration.js";
import { ConsoleRenderer, type Renderer, type Stream } from "./renderers.js";

/** Per-message decoration. */
export interface MessageOptions {
	/** Rendered dim, ahead of the label. `%time%` becomes the current ISO time. */
	prefix?: string | number;
	/** Rendered dim yellow, in parentheses, after the message. */
	suffix?: string | number;
	/** A `Date.now()` taken before the work; the elapsed time is appended. */
	startTime?: number;
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

	getLogs(): string[] {
		return this.#renderer.getLogs().map((entry) => entry.message);
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

	success(message: string, options: MessageOptions = {}): void {
		this.#renderer.log(this.prepare("success", message, options), "stdout");
	}

	info(message: string, options: MessageOptions = {}): void {
		this.#renderer.log(this.prepare("info", message, options), "stdout");
	}

	warning(message: string, options: MessageOptions = {}): void {
		this.#renderer.log(this.prepare("warning", message, options), "stderr");
	}

	error(message: string | Error, options: MessageOptions = {}): void {
		this.#renderer.log(
			this.prepare("error", messageOf(message), options),
			"stderr",
		);
	}

	/** An error plus its stack, indented and dimmed under the message. */
	fatal(message: string | Error, options: MessageOptions = {}): void {
		const line = this.prepare("fatal", messageOf(message), options);
		const stack =
			message instanceof Error ? this.#formatStack(message.stack) : "";
		this.#renderer.log(`${line}${stack}`, "stderr");
	}

	/** Only prints when DEBUG is set — the usual escape hatch for noisy detail. */
	debug(message: string, options: MessageOptions = {}): void {
		if (process.env.DEBUG === undefined || process.env.DEBUG === "") return;
		this.#renderer.log(this.prepare("debug", message, options), "stdout");
	}

	/** A line with no decoration at all. Use it for the command's own output. */
	log(message: string, stream: Stream = "stdout"): void {
		this.#renderer.log(message, stream);
	}

	/** A step whose outcome is reported later. */
	action(title: string): Action {
		return new Action(title, this.#colors, this.#renderer, {
			dim: this.#options.dim,
		});
	}

	/** A message with animated trailing dots, for work of unknown length. */
	await(message: string, options: MessageOptions = {}): Spinner {
		return new Spinner(
			() => this.prepare("await", message, options),
			this.#renderer,
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
		let text = this.#options.dim ? this.#colors.dim(message) : message;
		text = `${this.#label(colour, label)} ${text}`;

		const prefix = options.prefix ?? this.#stickyPrefix;
		if (prefix !== "") {
			// Not dimmed on top of dim: grey on grey stops being readable.
			const resolved = String(prefix).replace(
				/%time%/g,
				new Date().toISOString(),
			);
			text = `${this.#colors.dim(`[${resolved}]`)} ${text}`;
		}

		const suffix = options.suffix ?? this.#stickySuffix;
		if (suffix !== "") {
			text = `${text} ${this.#colors.dim.yellow(`(${String(suffix)})`)}`;
		}

		if (options.startTime !== undefined) {
			const elapsed = formatDuration(Date.now() - options.startTime);
			text = `${text} ${this.#colors.dim(`(${elapsed})`)}`;
		}

		return text;
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
			.map((line) => `      ${this.#colors.dim(line.trim())}`)
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
		this.#renderer.log(this.prepare("DONE", "green"), "stdout");
	}

	skipped(reason?: string): void {
		const suffix =
			reason === undefined ? "" : ` ${this.#colors.dim(`(${reason})`)}`;
		this.#renderer.log(`${this.prepare("SKIPPED", "cyan")}${suffix}`, "stdout");
	}

	failed(error: unknown): void {
		this.#renderer.log(
			`${this.prepare("FAILED", "red")}${this.#formatError(error)}`,
			"stderr",
		);
	}

	/** The line without writing it — same reason as `Logger.prepare`. */
	prepare(label: string, colour: "green" | "cyan" | "red"): string {
		// Padded on the LABEL, not the coloured string: escape codes occupy no
		// columns, and padding them would leave the column ragged.
		const padded = `${label}:`.padEnd(LABEL_WIDTH, " ");
		const tag = this.#colors[colour](padded);
		const title = this.#dim ? this.#colors.dim(this.#title) : this.#title;
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
			.map((line) => `      ${this.#colors.red(line.trim())}`)
			.join("\n")}`;
	}
}

/** `SKIPPED:` is the longest label, and everything aligns on it. */
const LABEL_WIDTH = "SKIPPED:".length;

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
	readonly #renderer: Renderer;
	#timer: ReturnType<typeof setInterval> | undefined;
	#frame = 0;

	constructor(render: () => string, renderer: Renderer) {
		this.#render = render;
		this.#renderer = renderer;
	}

	start(): this {
		if (!this.#animatable()) {
			this.#renderer.log(this.#render(), "stdout");
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

	update(render: string | (() => string)): this {
		this.#render = typeof render === "string" ? () => render : render;
		this.#frame = 0;
		if (this.#animatable()) this.#draw();
		else this.#renderer.log(this.#render(), "stdout");
		return this;
	}

	stop(): void {
		if (this.#timer === undefined) return;
		clearInterval(this.#timer);
		this.#timer = undefined;
		this.#renderer.logUpdatePersist();
	}

	#draw(): void {
		this.#renderer.logUpdate(
			`${this.#render()} ${Spinner.FRAMES[this.#frame] ?? ""}`,
		);
	}

	#animatable(): boolean {
		return this.#renderer instanceof ConsoleRenderer && stdout.isTTY === true;
	}
}

function messageOf(value: unknown): string {
	if (value instanceof Error) return value.message;
	return String(value);
}
