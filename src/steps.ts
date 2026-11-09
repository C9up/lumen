/**
 * A numbered list of things to do next.
 *
 * What a scaffolder prints once it is done — the steps the human still has to
 * take. Unlike {@link Tasks}, nothing here is executed: it is a static list.
 */

import { sanitize } from "./ansi.js";
import type { Colors } from "./colors.js";
import type { Renderer } from "./renderers.js";

export class Steps {
	#colors: Colors;
	#renderer: Renderer;
	readonly #steps: Array<{ title: string; content?: string }> = [];
	readonly #raw: boolean;

	constructor(
		colors: Colors,
		renderer: Renderer,
		options: { raw?: boolean } = {},
	) {
		this.#colors = colors;
		this.#renderer = renderer;
		// Raw mode (tests) drops the layout — indent and blank separators —
		// and keeps the content, as upstream.
		this.#raw = options.raw === true;
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

	add(title: string, content?: string): this {
		this.#steps.push({
			title: sanitize(title),
			// The content's own lines are kept: they are split into rows below.
			content:
				content === undefined
					? undefined
					: sanitize(content, { keepNewlines: true }),
		});
		return this;
	}

	prepare(): string[] {
		const lines: string[] = [];
		this.#steps.forEach((step, index) => {
			lines.push(
				`${this.#colors.cyan(`${index + 1}.`)} ${this.#colors.bold(step.title)}`,
			);
			if (step.content !== undefined) {
				// Indented under the counter, so a multi-line explanation stays
				// visibly attached to its step.
				for (const line of step.content.split("\n")) {
					lines.push(this.#raw ? line : `   ${line}`);
				}
			}
			if (index < this.#steps.length - 1 && !this.#raw) lines.push("");
		});
		return lines;
	}

	render(): void {
		for (const line of this.prepare()) this.#renderer.log(line, "stdout");
	}
}
