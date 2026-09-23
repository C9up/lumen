/**
 * A sequence of steps with their outcome.
 *
 * Sequential on purpose: the point is a readable progress report, and running
 * them concurrently would interleave the lines into noise. A failing task stops
 * the run — the ones after it usually depend on it.
 *
 * Each task is an observable object rather than a closure's local state, so a
 * caller can render the run its own way: `tasks()` hands back the list and
 * `onUpdate` fires whenever one moves.
 */

import type { Colors } from "./colors.js";
import { formatDuration } from "./duration.js";
import { icons } from "./icons.js";
import type { Renderer } from "./renderers.js";

export type TaskState = "idle" | "running" | "succeeded" | "failed";

/**
 * One step: its state, and the API its callback uses to report progress.
 *
 * Handed to the callback, and kept by the manager afterwards — which is what
 * makes a finished run inspectable instead of only printable.
 */
export class Task {
	readonly #title: string;
	readonly #listeners: Array<(task: Task) => void> = [];
	#state: TaskState = "idle";
	#message: string | null = null;
	#error: unknown;
	#startedAt: number | undefined;
	#elapsed: number | undefined;
	#lastLine: string | null = null;

	constructor(title: string) {
		this.#title = title;
	}

	get title(): string {
		return this.#title;
	}

	getState(): TaskState {
		return this.#state;
	}

	/** How long it ran, formatted; `null` while it has not finished. */
	getDuration(): string | null {
		return this.#elapsed === undefined ? null : formatDuration(this.#elapsed);
	}

	getError(): unknown {
		return this.#error;
	}

	/** The message it finished with, or the last progress message it reported. */
	getSuccessMessage(): string | null {
		return this.#message;
	}

	/** The last line the manager wrote for this task. */
	getLastLoggedLine(): string | null {
		return this.#lastLine;
	}

	/** @internal Recorded by the manager as it renders. */
	setLastLoggedLine(line: string): void {
		this.#lastLine = line;
	}

	/**
	 * Called whenever the task moves — started, progressed, finished.
	 *
	 * This is the seam for a renderer of your own: the manager's own output is
	 * one consumer of these events, not the only possible one.
	 */
	onUpdate(listener: (task: Task) => void): this {
		this.#listeners.push(listener);
		return this;
	}

	start(): this {
		this.#state = "running";
		this.#startedAt = Date.now();
		return this.#notify();
	}

	/**
	 * Report progress.
	 *
	 * Verbose prints every message; minimal keeps only the last one, surfaced
	 * on the task's final line. A progress loop otherwise floods the output
	 * with a line per percent.
	 */
	update(message: string): this {
		this.#message = message;
		return this.#notify();
	}

	markAsSucceeded(message?: string): this {
		if (message !== undefined) this.#message = message;
		this.#state = "succeeded";
		this.#finish();
		return this.#notify();
	}

	markAsFailed(error: unknown): this {
		this.#error = error instanceof Error ? error : new Error(String(error));
		this.#state = "failed";
		this.#finish();
		return this.#notify();
	}

	/**
	 * Mark the task as failed and hand the Error back.
	 *
	 * RETURNED from the callback rather than thrown, so an expected failure
	 * reads as a value instead of control flow:
	 *
	 *     .add('install', async (task) => task.error('no network'))
	 */
	error(reason: string | Error): Error {
		this.markAsFailed(reason);
		const failure = this.#error;
		return failure instanceof Error ? failure : new Error(String(reason));
	}

	#finish(): void {
		this.#elapsed =
			this.#startedAt === undefined ? 0 : Date.now() - this.#startedAt;
	}

	#notify(): this {
		for (const listener of this.#listeners) listener(this);
		return this;
	}
}

/** The shape a caller reads off a finished run. */
export interface TaskOutcome {
	title: string;
	state: "succeeded" | "failed";
	message: string;
	/** Formatted, as `getDuration()` gives it. */
	duration: string | null;
	error?: Error;
}

export interface TasksOptions {
	/**
	 * Mark each outcome with a glyph. Off, the words carry it alone — for a
	 * terminal whose font has no box drawing.
	 */
	icons?: boolean;
	/**
	 * Print every progress message instead of only the last one.
	 *
	 * Minimal is the default: a hundred `Downloaded 42%` lines make a
	 * transcript unreadable. Verbose is what a `--verbose` flag turns on.
	 */
	verbose?: boolean;
}

export class Tasks {
	#colors: Colors;
	#renderer: Renderer;
	readonly #verbose: boolean;
	readonly #icons: boolean;
	readonly #entries: Array<{
		task: Task;
		work: (task: Task) => Promise<unknown>;
	}> = [];
	readonly #outcomes: TaskOutcome[] = [];
	#state: TaskState = "idle";

	constructor(colors: Colors, renderer: Renderer, options: TasksOptions = {}) {
		this.#colors = colors;
		this.#renderer = renderer;
		this.#verbose = options.verbose === true;
		this.#icons = options.icons !== false;
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

	add(title: string, work: (task: Task) => Promise<unknown>): this {
		this.#entries.push({ task: new Task(title), work });
		return this;
	}

	/** Add it only when the condition holds — a step behind a flag. */
	addIf(
		condition: boolean,
		title: string,
		work: (task: Task) => Promise<unknown>,
	): this {
		return condition ? this.add(title, work) : this;
	}

	addUnless(
		condition: boolean,
		title: string,
		work: (task: Task) => Promise<unknown>,
	): this {
		return condition ? this : this.add(title, work);
	}

	/** Every task, in declaration order — before, during or after the run. */
	tasks(): Task[] {
		return this.#entries.map((entry) => entry.task);
	}

	/** `failed` as soon as one did; `succeeded` once they all have. */
	getState(): TaskState {
		return this.#state;
	}

	/** Results in declaration order, including the task that failed. */
	get outcomes(): TaskOutcome[] {
		return [...this.#outcomes];
	}

	async run(): Promise<TaskOutcome[]> {
		this.#state = "running";
		for (const { task, work } of this.#entries) {
			if (this.#verbose) {
				// Every progress message, as it happens. Registered before the
				// run so the first `update` is not missed.
				task.onUpdate((current) => {
					if (current.getState() !== "running") return;
					const message = current.getSuccessMessage();
					if (message === null) return;
					this.#write(
						current,
						`  ${this.#colors.dim(`${current.title}: ${message}`)}`,
						"stdout",
					);
				});
			}
			task.start();

			try {
				const returned = await work(task);
				if (task.getState() === "running") {
					// The callback reported nothing: a returned Error still means
					// failure, anything else means success.
					if (returned instanceof Error) task.markAsFailed(returned);
					else
						task.markAsSucceeded(
							returned === undefined ? undefined : String(returned),
						);
				}
			} catch (error) {
				task.markAsFailed(error);
			}

			const elapsed = this.#colors.dim(`(${task.getDuration() ?? "0ms"})`);
			const message = task.getSuccessMessage() ?? "";

			if (task.getState() === "succeeded") {
				this.#outcomes.push({
					title: task.title,
					state: "succeeded",
					message,
					duration: task.getDuration(),
				});
				const detail = message === "" ? "" : ` ${this.#colors.dim(message)}`;
				this.#write(
					task,
					`${this.#mark(icons.tick, "green")}${task.title}${detail} ${elapsed}`,
					"stdout",
				);
				continue;
			}

			const failure =
				task.getError() instanceof Error
					? (task.getError() as Error)
					: new Error(String(task.getError()));
			this.#outcomes.push({
				title: task.title,
				state: "failed",
				message: failure.message,
				duration: task.getDuration(),
				error: failure,
			});
			this.#write(
				task,
				`${this.#mark(icons.cross, "red")}${task.title} ${this.#colors.dim(failure.message)} ${elapsed}`,
				"stderr",
			);
			// Stop here: later steps normally build on this one.
			this.#state = "failed";
			return this.outcomes;
		}

		this.#state = "succeeded";
		return this.outcomes;
	}

	/** The glyph before an outcome, or nothing when icons are off. */
	#mark(glyph: string, colour: "green" | "red"): string {
		return this.#icons ? `${this.#colors[colour](glyph)} ` : "";
	}

	#write(task: Task, line: string, stream: "stdout" | "stderr"): void {
		task.setLastLoggedLine(line);
		this.#renderer.log(line, stream);
	}
}

/**
 * The name the task object had when it only carried the callback's two
 * methods. Kept so existing imports keep resolving.
 */
export { Task as TaskContext };
