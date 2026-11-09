/**
 * Measuring and laying out text in a terminal.
 *
 * Every column alignment in this package goes through {@link stringWidth}, and
 * it is not `String.length`: escape codes occupy no columns, a combining accent
 * occupies none either, and a CJK ideograph or an emoji occupies two. Measured
 * with `.length`, a table with one emoji in it is misaligned for every row
 * below — which is exactly the kind of bug nobody files and everybody sees.
 */

import { stdout } from "node:process";
import { ansiTokens, hyperlinkCloser, SgrStyles, sgrParams } from "./ansi.js";
import { graphemes, graphemeWidth, stringWidth } from "./width.js";

export { type SanitizeOptions, sanitize } from "./ansi.js";
export { stringWidth } from "./width.js";

/** Columns available, or 80 when the output is not a terminal. */
export function terminalWidth(): number {
	return stdout.columns ?? 80;
}

export interface JustifyOptions {
	/** Every column is padded out to this width. */
	maxWidth: number;
	align?: "left" | "right";
	/** What the empty space is filled with. Defaults to a space. */
	paddingChar?: string;
}

/**
 * Pad every column to the same width.
 *
 * A column already at or past `maxWidth` is returned untouched — widening the
 * table is the caller's decision, and silently truncating here would lose
 * content.
 */
export function justify(
	columns: readonly string[],
	options: JustifyOptions,
): string[] {
	const align = options.align ?? "left";
	const paddingChar = options.paddingChar ?? " ";
	return columns.map((column) => {
		const slack = options.maxWidth - stringWidth(column);
		if (slack <= 0) return column;
		const padding = paddingChar.repeat(slack);
		return align === "left" ? `${column}${padding}` : `${padding}${column}`;
	});
}

export interface WrapOptions {
	/** Column the text starts at; continuation lines are indented to it. */
	startColumn: number;
	/** Column the text must not pass. */
	endColumn: number;
	/** Drop the indent of the FIRST line — it already follows something. */
	trimStart?: boolean;
}

/**
 * Wrap text between two columns, indenting continuation lines to `startColumn`.
 *
 * This is what makes a long description in a command list stay inside its
 * column instead of wrapping back under the command name.
 */
export function wrap(
	columns: readonly string[],
	options: WrapOptions,
): string[] {
	return columns.map((column) => {
		const wrapped = wrapOne(column, options.startColumn, options.endColumn);
		return options.trimStart === true ? wrapped.trimStart() : wrapped;
	});
}

function wrapOne(text: string, startColumn: number, endColumn: number): string {
	const indent = " ".repeat(startColumn);
	const available = Math.max(1, endColumn - startColumn);
	const lines: string[] = [];
	// Paragraphs first: an explicit newline is the author's, and wrapping must
	// not swallow it.
	for (const paragraph of text.split("\n")) {
		// The width runs as a number, each word measured once: re-measuring
		// the line so far for every word made a long paragraph quadratic.
		let current = "";
		let currentWidth = 0;
		for (const word of paragraph.split(/\s+/)) {
			if (word === "") continue;
			const wordWidth = stringWidth(word);
			if (current === "") {
				current = word;
				currentWidth = wordWidth;
				continue;
			}
			if (currentWidth + 1 + wordWidth > available) {
				lines.push(current);
				current = word;
				currentWidth = wordWidth;
				continue;
			}
			current = `${current} ${word}`;
			currentWidth += 1 + wordWidth;
		}
		lines.push(current);
	}
	return lines.map((line) => `${indent}${line}`).join("\n");
}

export interface TruncateOptions {
	maxWidth: number;
	/** Replaces what was cut. Defaults to an ellipsis. */
	truncationChar?: string;
	position?: "start" | "middle" | "end";
}

/** Cut each column down to `maxWidth`, marking where the text was cut. */
export function truncate(
	columns: readonly string[],
	options: TruncateOptions,
): string[] {
	const char = options.truncationChar ?? "…";
	const position = options.position ?? "end";
	return columns.map((column) =>
		truncateOne(column, options.maxWidth, char, position),
	);
}

function truncateOne(
	text: string,
	maxWidth: number,
	char: string,
	position: "start" | "middle" | "end",
): string {
	if (stringWidth(text) <= maxWidth) return text;
	const markerWidth = stringWidth(char);
	// No room for anything but the marker — and not even that, at zero.
	if (maxWidth <= markerWidth) return maxWidth <= 0 ? "" : char;
	const budget = maxWidth - markerWidth;
	// The marker goes INSIDE the styles that end or start the cut, so a red
	// value cut short is followed by a red ellipsis — what cli-truncate does.
	if (position === "start") {
		const right = sliceToWidth(text, budget, "end");
		const at = leadingSgrEnd(right);
		return `${right.slice(0, at)}${char}${right.slice(at)}`;
	}
	if (position === "end") {
		const left = sliceToWidth(text, budget, "start");
		const at = trailingSgrStart(left);
		return `${left.slice(0, at)}${char}${left.slice(at)}`;
	}
	const left = Math.ceil(budget / 2);
	return `${sliceToWidth(text, left, "start")}${char}${sliceToWidth(text, budget - left, "end")}`;
}

/** One visible character or one escape sequence, with the columns it takes. */
interface Piece {
	text: string;
	width: number;
	escape: boolean;
}

function pieces(text: string): Piece[] {
	const out: Piece[] = [];
	for (const token of ansiTokens(text)) {
		if (token.escape) {
			out.push({ text: token.text, width: 0, escape: true });
			continue;
		}
		for (const segment of graphemes(token.text)) {
			out.push({ text: segment, width: graphemeWidth(segment), escape: false });
		}
	}
	return out;
}

/** The styles and the hyperlink a run of escape sequences leaves open. */
class OpenState {
	readonly styles = new SgrStyles();
	#link: { open: string; close: string } | undefined;

	track(sequence: string): void {
		const params = sgrParams(sequence);
		if (params !== undefined) {
			this.styles.apply(params);
			return;
		}
		const closer = hyperlinkCloser(sequence);
		if (closer === undefined) return;
		this.#link = closer === "" ? undefined : { open: sequence, close: closer };
	}

	reopen(): string {
		return `${this.styles.reopen()}${this.#link?.open ?? ""}`;
	}

	close(): string {
		return `${this.#link?.close ?? ""}${this.styles.close()}`;
	}
}

/**
 * Take `width` columns from one end, never splitting a code point, and keep
 * the escape sequences: whatever is open at the cut is closed after it (or
 * reopened before it), so a red value stays red — the slice-ansi contract.
 */
function sliceToWidth(
	text: string,
	width: number,
	from: "start" | "end",
): string {
	const all = pieces(text);
	if (from === "start") {
		const state = new OpenState();
		let out = "";
		let used = 0;
		for (const piece of all) {
			if (piece.escape) {
				state.track(piece.text);
				out += piece.text;
				continue;
			}
			if (used + piece.width > width) break;
			used += piece.width;
			out += piece.text;
		}
		return `${out}${state.close()}`;
	}

	// From the end: find where the kept tail starts, then replay what comes
	// before it to know which styles are running there.
	let start = all.length;
	let used = 0;
	for (let index = all.length - 1; index >= 0; index -= 1) {
		const piece = all[index];
		if (piece === undefined) continue;
		if (!piece.escape) {
			if (used + piece.width > width) break;
			used += piece.width;
		}
		start = index;
	}
	const state = new OpenState();
	for (const piece of all.slice(0, start)) {
		if (piece.escape) state.track(piece.text);
	}
	return `${state.reopen()}${all
		.slice(start)
		.map((piece) => piece.text)
		.join("")}`;
}

/** Where the run of SGR sequences ending the text starts. */
function trailingSgrStart(text: string): number {
	let start = text.length;
	while (start > 0 && text[start - 1] === "m") {
		const open = text.lastIndexOf("\u001B[", start - 1);
		if (open === -1 || sgrParams(text.slice(open, start)) === undefined) break;
		start = open;
	}
	return start;
}

/** Where the run of SGR sequences opening the text ends. */
function leadingSgrEnd(text: string): number {
	let end = 0;
	while (text.startsWith("\u001B[", end)) {
		const close = text.indexOf("m", end);
		if (close === -1 || sgrParams(text.slice(end, close + 1)) === undefined) {
			break;
		}
		end = close + 1;
	}
	return end;
}
