/**
 * A numbered list of things to do next.
 *
 * What a scaffolder prints once it is done — the steps the human still has to
 * take. Unlike {@link Tasks}, nothing here is executed: it is a static list.
 */

import type { Colors } from "./colors.js";
import type { Renderer } from "./renderers.js";

export class Steps {
	readonly #colors: Colors;
	readonly #renderer: Renderer;
	readonly #steps: Array<{ title: string; content?: string }> = [];

	constructor(colors: Colors, renderer: Renderer) {
		this.#colors = colors;
		this.#renderer = renderer;
	}

	add(title: string, content?: string): this {
		this.#steps.push({ title, content });
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
				for (const line of step.content.split("\n")) lines.push(`   ${line}`);
			}
			if (index < this.#steps.length - 1) lines.push("");
		});
		return lines;
	}

	render(): void {
		for (const line of this.prepare()) this.#renderer.log(line, "stdout");
	}
}
