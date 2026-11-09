/**
 * A bordered box: `sticker()` for a highlighted block, `instructions()` for a
 * list of steps, each marked with a pointer.
 *
 * It is what a CLI reaches for when something must not scroll past unread —
 * "your app key was written here", "that command does not exist, did you
 * mean…". The border is a callback so the caller can colour it by severity
 * without the box knowing what severity means.
 */

import { sanitize } from "./ansi.js";
import type { Colors } from "./colors.js";
import { stringWidth, terminalWidth } from "./helpers.js";
import { icons } from "./icons.js";
import type { Renderer } from "./renderers.js";

/** Called for every border glyph, so a box can be red, dim, or anything. */
export type BorderPainter = (character: string, colors: Colors) => string;

export class Box {
	#colors: Colors;
	#renderer: Renderer;
	readonly #withPointer: boolean;
	readonly #raw: boolean;
	/** Each line with its width, measured once when it is added. */
	readonly #lines: Array<{ text: string; width: number }> = [];
	#heading: { text: string; width: number } | undefined;
	/**
	 * Kept up to date by `add()` and `heading()`, as upstream does. Found at
	 * render time by spreading every line into `Math.max`, it overflowed the
	 * call stack past ~150 000 lines.
	 */
	#widest = 0;
	#fullScreen = false;
	#paint: BorderPainter = (character, colors) => colors.dim(character);

	constructor(
		colors: Colors,
		renderer: Renderer,
		options: { pointer?: boolean; icons?: boolean; raw?: boolean } = {},
	) {
		this.#colors = colors;
		this.#renderer = renderer;
		// `icons: false` drops the pointer for a terminal whose font has none —
		// the same switch upstream puts on instructions.
		this.#withPointer = (options.pointer ?? false) && options.icons !== false;
		// Raw mode (tests) gets the content without the frame, as upstream.
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

	heading(text: string): this {
		const safe = sanitize(text);
		this.#heading = { text: safe, width: stringWidth(safe) };
		this.#widest = Math.max(this.#widest, this.#heading.width);
		return this;
	}

	add(line: string): this {
		// One entry is one row: a newline in it would break the frame, so it
		// is shown like every other control.
		const safe = sanitize(line);
		// An empty line stays empty: a pointer on nothing is a stray glyph.
		const text =
			this.#withPointer && safe !== ""
				? `${this.#colors.dim(icons.pointer)} ${safe}`
				: safe;
		const width = stringWidth(text);
		this.#lines.push({ text, width });
		this.#widest = Math.max(this.#widest, width);
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
		if (this.#raw) {
			const body = this.#lines.map((line) => line.text);
			return this.#heading === undefined ? body : [this.#heading.text, ...body];
		}

		const widest = this.#widest;
		// Padding is asymmetric on purpose: text hugging the right border reads
		// as a mistake, and the extra room is where a wrapped word lands.
		const inner = this.#fullScreen
			? Math.max(widest, terminalWidth() - LEFT_PADDING - RIGHT_PADDING - 2)
			: widest;
		const width = inner + LEFT_PADDING + RIGHT_PADDING;

		const edge = (left: string, fill: string, right: string): string =>
			`${this.#paint(left, this.#colors)}${this.#paint(fill, this.#colors).repeat(width)}${this.#paint(right, this.#colors)}`;

		// Painted once: the painter is the caller's callback, and calling it
		// twice per row is the whole cost of a long box.
		const vertical = this.#paint(icons.borderVertical, this.#colors);
		const left = " ".repeat(LEFT_PADDING);
		const row = (text: string, textWidth: number): string =>
			`${vertical}${left}${text}${" ".repeat(Math.max(0, inner - textWidth) + RIGHT_PADDING)}${vertical}`;

		const lines = [
			edge(icons.borderTopLeft, icons.borderHorizontal, icons.borderTopRight),
		];
		lines.push(row("", 0));
		if (this.#heading !== undefined) {
			lines.push(
				row(this.#colors.bold(this.#heading.text), this.#heading.width),
			);
			lines.push(row("", 0));
		}
		for (const line of this.#lines) lines.push(row(line.text, line.width));
		lines.push(row("", 0));
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
