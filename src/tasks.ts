/**
 * A sequence of steps with their outcome.
 *
 * Sequential on purpose: the point is a readable progress report, and running
 * them concurrently would interleave the lines into noise. A failing task stops
 * the run — the ones after it usually depend on it.
 */

import type { Colors } from "./colors.js";
import { formatDuration } from "./duration.js";
import { icons } from "./icons.js";
import type { Renderer } from "./renderers.js";

/** Handed to a task callback so it can report progress and failure. */
export class TaskContext {
	readonly #colors: Colors;
	readonly #renderer: Renderer;
	readonly #title: string;
	readonly #verbose: boolean;
	#lastMessage = "";
	#failure: Error | undefined;

	constructor(
		colors: Colors,
		renderer: Renderer,
		title: string,
		verbose: boolean,
	) {
		this.#colors = colors;
		this.#renderer = renderer;
		this.#title = title;
		this.#verbose = verbose;
	}

	/**
	 * Report progress.
	 *
	 * Verbose prints every message; minimal keeps only the last one, surfaced
	 * on the task's final line. A progress loop otherwise floods the output
	 * with a line per percent.
	 */
	update(message: string): void {
		this.#lastMessage = message;
		if (this.#verbose) {
			this.#renderer.log(
				`  ${this.#colors.dim(`${this.#title}: ${message}`)}`,
				"stdout",
			);
		}
	}

	/** @internal The last progress message, shown when the task ends. */
	get lastMessage(): string {
		return this.#lastMessage;
	}

	/**
	 * Mark the task as failed. RETURNED from the callback rather than thrown,
	 * so an expected failure reads as a value instead of control flow.
	 */
	error(reason: string | Error): Error {
		this.#failure = reason instanceof Error ? reason : new Error(reason);
		return this.#failure;
	}

	/** @internal */
	get failure(): Error | undefined {
		return this.#failure;
	}
}

export interface TaskOutcome {
	title: string;
	state: "succeeded" | "failed";
	message: string;
	error?: Error;
}

export interface TasksOptions {
	/**
	 * Print every progress message instead of only the last one.
	 *
	 * Minimal is the default: a hundred `Downloaded 42%` lines make a
	 * transcript unreadable. Verbose is what a `--verbose` flag turns on.
	 */
	verbose?: boolean;
}

export class Tasks {
	readonly #colors: Colors;
	readonly #renderer: Renderer;
	readonly #verbose: boolean;
	readonly #entries: Array<{
		title: string;
		work: (task: TaskContext) => Promise<unknown>;
	}> = [];
	readonly #outcomes: TaskOutcome[] = [];

	constructor(colors: Colors, renderer: Renderer, options: TasksOptions = {}) {
		this.#colors = colors;
		this.#renderer = renderer;
		this.#verbose = options.verbose === true;
	}

	add(title: string, work: (task: TaskContext) => Promise<unknown>): this {
		this.#entries.push({ title, work });
		return this;
	}

	/** Results in declaration order, including the task that failed. */
	get outcomes(): TaskOutcome[] {
		return [...this.#outcomes];
	}

	async run(): Promise<TaskOutcome[]> {
		for (const entry of this.#entries) {
			const startedAt = Date.now();
			const context = new TaskContext(
				this.#colors,
				this.#renderer,
				entry.title,
				this.#verbose,
			);
			let message = "";
			let failure: Error | undefined;

			try {
				const returned = await entry.work(context);
				failure =
					context.failure ?? (returned instanceof Error ? returned : undefined);
				if (failure === undefined) {
					message =
						returned === undefined ? context.lastMessage : String(returned);
				}
			} catch (error) {
				failure = error instanceof Error ? error : new Error(String(error));
			}

			const elapsed = this.#colors.dim(
				`(${formatDuration(Date.now() - startedAt)})`,
			);

			if (failure === undefined) {
				this.#outcomes.push({
					title: entry.title,
					state: "succeeded",
					message,
				});
				const detail = message === "" ? "" : ` ${this.#colors.dim(message)}`;
				this.#renderer.log(
					`${this.#colors.green(icons.tick)} ${entry.title}${detail} ${elapsed}`,
					"stdout",
				);
				continue;
			}

			this.#outcomes.push({
				title: entry.title,
				state: "failed",
				message: failure.message,
				error: failure,
			});
			this.#renderer.log(
				`${this.#colors.red(icons.cross)} ${entry.title} ${this.#colors.dim(failure.message)} ${elapsed}`,
				"stderr",
			);
			// Stop here: later steps normally build on this one.
			break;
		}

		return this.outcomes;
	}
}
