/**
 * A bordered box: `sticker()` for a highlighted block, `instructions()` for a
 * list of steps, each marked with a pointer.
 *
 * It is what a CLI reaches for when something must not scroll past unread —
 * "your app key was written here", "that command does not exist, did you
 * mean…". The border is a callback so the caller can colour it by severity
 * without the box knowing what severity means.
 */

import type { Colors } from "./colors.js";
import { stringWidth, terminalWidth } from "./helpers.js";
import { icons } from "./icons.js";
import type { Renderer } from "./renderers.js";

/** Called for every border glyph, so a box can be red, dim, or anything. */
export type BorderPainter = (character: string, colors: Colors) => string;

export class Box {
	readonly #colors: Colors;
	readonly #renderer: Renderer;
	readonly #withPointer: boolean;
	readonly #lines: string[] = [];
	#heading: string | undefined;
	#fullScreen = false;
	#paint: BorderPainter = (character, colors) => colors.dim(character);

	constructor(
		colors: Colors,
		renderer: Renderer,
		options: { pointer?: boolean } = {},
	) {
		this.#colors = colors;
		this.#renderer = renderer;
		this.#withPointer = options.pointer ?? false;
	}

	heading(text: string): this {
		this.#heading = text;
		return this;
	}

	add(line: string): this {
		this.#lines.push(line);
		return this;
	}

	/** Stretch the box to the terminal width instead of hugging its content. */
	fullScreen(): this {
		this.#fullScreen = true;
		return this;
	}

	drawBorder(painter: BorderPainter): this {
		this.#paint = painter;
		return this;
	}

	/** The rendered lines, without writing them. */
	prepare(): string[] {
		if (this.#lines.length === 0 && this.#heading === undefined) return [];

		const body = this.#lines.map((line) =>
			// An empty line stays empty: a pointer on nothing is a stray glyph.
			this.#withPointer && line !== ""
				? `${this.#colors.dim(icons.pointer)} ${line}`
				: line,
		);
		const content =
			this.#heading === undefined ? body : [this.#heading, ...body];
		const widest = Math.max(...content.map(stringWidth));
		// Padding is asymmetric on purpose: text hugging the right border reads
		// as a mistake, and the extra room is where a wrapped word lands.
		const inner = this.#fullScreen
			? Math.max(widest, terminalWidth() - LEFT_PADDING - RIGHT_PADDING - 2)
			: widest;
		const width = inner + LEFT_PADDING + RIGHT_PADDING;

		const edge = (left: string, fill: string, right: string): string =>
			`${this.#paint(left, this.#colors)}${this.#paint(fill, this.#colors).repeat(width)}${this.#paint(right, this.#colors)}`;

		const row = (text: string): string => {
			const slack = inner - stringWidth(text);
			return [
				this.#paint(icons.borderVertical, this.#colors),
				" ".repeat(LEFT_PADDING),
				text,
				" ".repeat(Math.max(0, slack) + RIGHT_PADDING),
				this.#paint(icons.borderVertical, this.#colors),
			].join("");
		};

		const lines = [
			edge(icons.borderTopLeft, icons.borderHorizontal, icons.borderTopRight),
		];
		lines.push(row(""));
		if (this.#heading !== undefined) {
			lines.push(row(this.#colors.bold(this.#heading)));
			lines.push(row(""));
		}
		for (const line of body) lines.push(row(line));
		lines.push(row(""));
		lines.push(
			edge(
				icons.borderBottomLeft,
				icons.borderHorizontal,
				icons.borderBottomRight,
			),
		);
		return lines;
	}

	render(stream: "stdout" | "stderr" = "stdout"): void {
		for (const line of this.prepare()) this.#renderer.log(line, stream);
	}
}

const LEFT_PADDING = 4;
const RIGHT_PADDING = 8;
