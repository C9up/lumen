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
import { stripAnsi } from "./colors.js";

/**
 * Code point ranges that take TWO columns (East Asian Wide and Fullwidth,
 * plus the emoji blocks that render wide everywhere).
 *
 * KNOWN LIMIT — this is the common set, not the full Unicode EastAsianWidth
 * table. A rare wide code point outside these ranges is measured as one column
 * and shifts its row by one. Widening the table is additive; pulling in a
 * dependency to carry the whole of it is not worth the install weight for a
 * CLI.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x1100, 0x115f], // Hangul Jamo
	[0x2329, 0x232a], // angle brackets
	[0x2e80, 0x303e], // CJK radicals … symbols
	[0x3041, 0x33ff], // Hiragana … CJK compatibility
	[0x3400, 0x4dbf], // CJK extension A
	[0x4e00, 0x9fff], // CJK unified ideographs
	[0xa000, 0xa4cf], // Yi
	[0xa960, 0xa97f], // Hangul Jamo extended-A
	[0xac00, 0xd7a3], // Hangul syllables
	[0xf900, 0xfaff], // CJK compatibility ideographs
	[0xfe10, 0xfe19], // vertical forms
	[0xfe30, 0xfe6f], // CJK compatibility forms
	[0xff00, 0xff60], // fullwidth forms
	[0xffe0, 0xffe6], // fullwidth signs
	[0x1f300, 0x1f64f], // emoji: symbols and people
	[0x1f680, 0x1f6ff], // emoji: transport
	[0x1f900, 0x1f9ff], // emoji: supplemental
	[0x20000, 0x2fffd], // CJK extension B+
	[0x30000, 0x3fffd], // CJK extension G+
];

/**
 * Code points that take NO column: combining marks, variation selectors and
 * the zero-width joiner that glues an emoji sequence together.
 */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x0300, 0x036f], // combining diacritical marks
	[0x0483, 0x0489],
	[0x0591, 0x05bd],
	[0x0610, 0x061a],
	[0x064b, 0x065f],
	[0x0e31, 0x0e31],
	[0x0e34, 0x0e3a],
	[0x1ab0, 0x1aff], // combining diacritical marks extended
	[0x1dc0, 0x1dff], // combining diacritical marks supplement
	[0x200b, 0x200f], // zero-width space … RTL mark
	[0x20d0, 0x20ff], // combining marks for symbols
	[0xfe00, 0xfe0f], // variation selectors
	[0xfe20, 0xfe2f], // combining half marks
	[0xfeff, 0xfeff], // BOM
];

function inRanges(
	code: number,
	ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
	return ranges.some(([start, end]) => code >= start && code <= end);
}

/** How many columns one code point occupies. */
function codePointWidth(code: number): number {
	// C0/C1 controls draw nothing (a tab is expanded before it gets here).
	if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;
	if (inRanges(code, ZERO_WIDTH_RANGES)) return 0;
	if (inRanges(code, WIDE_RANGES)) return 2;
	return 1;
}

/**
 * The number of terminal columns this string occupies, escape codes excluded.
 */
export function stringWidth(text: string): number {
	let width = 0;
	for (const character of stripAnsi(text)) {
		const code = character.codePointAt(0);
		if (code === undefined) continue;
		width += codePointWidth(code);
	}
	return width;
}

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
		let current = "";
		for (const word of paragraph.split(/\s+/).filter((part) => part !== "")) {
			const candidate = current === "" ? word : `${current} ${word}`;
			if (stringWidth(candidate) > available && current !== "") {
				lines.push(current);
				current = word;
				continue;
			}
			current = candidate;
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
	if (position === "start")
		return `${char}${sliceToWidth(text, budget, "end")}`;
	if (position === "end")
		return `${sliceToWidth(text, budget, "start")}${char}`;
	const left = Math.ceil(budget / 2);
	return `${sliceToWidth(text, left, "start")}${char}${sliceToWidth(text, budget - left, "end")}`;
}

/** Take `width` columns from one end, never splitting a code point. */
function sliceToWidth(
	text: string,
	width: number,
	from: "start" | "end",
): string {
	const characters = [...stripAnsi(text)];
	const ordered = from === "start" ? characters : [...characters].reverse();
	const taken: string[] = [];
	let used = 0;
	for (const character of ordered) {
		const code = character.codePointAt(0);
		const size = code === undefined ? 0 : codePointWidth(code);
		if (used + size > width) break;
		used += size;
		taken.push(character);
	}
	return from === "start" ? taken.join("") : taken.reverse().join("");
}
