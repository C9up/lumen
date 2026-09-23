/**
 * A bordered table.
 *
 * Upstream draws one with `cli-table3`; this draws the same shape with no
 * dependency — box-drawing characters, a dim border, two spaces of padding on
 * each side, and word wrapping inside a column.
 *
 * Widths are measured with {@link stringWidth}, never `String.length`: a cell
 * coloured green carries escape codes that occupy no columns, and a CJK or
 * emoji cell occupies two per glyph. Get that wrong and the border of every
 * row below the offending cell is out of line.
 */

import type { Colors } from "./colors.js";
import { stringWidth, terminalWidth, wrap } from "./helpers.js";
import type { Renderer } from "./renderers.js";

/** One cell, with the layout hints upstream accepts. */
export interface TableCell {
	content: string;
	hAlign?: "left" | "right" | "center";
	/** Where the text sits when the row is taller than this cell. */
	vAlign?: "top" | "center" | "bottom";
	/** How many columns this cell spans. */
	colSpan?: number;
}

export type TableInput = string | TableCell;

/**
 * A row.
 *
 * Either the cells, or ONE `{ heading: [cells] }` pair — the vertical shape
 * upstream accepts, where the key becomes the row's own heading on the left.
 */
export type TableRow =
	| readonly TableInput[]
	| Record<string, readonly TableInput[]>;

/**
 * The border glyphs, named as upstream names them so a `chars` override
 * written for it works here.
 */
export interface TableChars {
	top: string;
	"top-mid": string;
	"top-left": string;
	"top-right": string;
	bottom: string;
	"bottom-mid": string;
	"bottom-left": string;
	"bottom-right": string;
	left: string;
	"left-mid": string;
	mid: string;
	"mid-mid": string;
	right: string;
	"right-mid": string;
	middle: string;
}

const DEFAULT_CHARS: TableChars = {
	top: "─",
	"top-mid": "┬",
	"top-left": "┌",
	"top-right": "┐",
	bottom: "─",
	"bottom-mid": "┴",
	"bottom-left": "└",
	"bottom-right": "┘",
	left: "│",
	"left-mid": "├",
	mid: "─",
	"mid-mid": "┼",
	right: "│",
	"right-mid": "┤",
	middle: "│",
};

export interface TableOptions {
	/**
	 * Print the cells joined by `|`, with no border and no colour.
	 *
	 * What a test asserts on. Set for you when the UI is in raw mode.
	 */
	raw?: boolean;
	/** Override any of the border glyphs. */
	chars?: Partial<TableChars>;
}

/** Raised when a table is asked for a shape it does not have. */
export class InvalidColumnError extends Error {
	readonly code = "E_LUMEN_INVALID_COLUMN";
	constructor(message: string) {
		super(message);
		this.name = "InvalidColumnError";
	}
}

/** Two spaces each side, as upstream sets on cli-table3. */
const PADDING = 2;

export class Table {
	#colors: Colors;
	#renderer: Renderer;
	readonly #options: TableOptions;
	#headCells: TableCell[] = [];
	readonly #rows: TableCell[][] = [];
	#full = false;
	#fluidColumn = 0;
	#widths: number[] = [];

	constructor(colors: Colors, renderer: Renderer, options: TableOptions = {}) {
		this.#colors = colors;
		this.#renderer = renderer;
		this.#options = options;
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

	head(columns: readonly TableInput[]): this {
		this.#headCells = columns.map(toCell);
		return this;
	}

	row(cells: TableRow): this {
		this.#rows.push(toRow(cells));
		return this;
	}

	/** The rows as they were given, unpadded — for assertions. */
	getRows(): string[][] {
		return this.#rows.map((row) => row.map((cell) => cell.content));
	}

	getHead(): string[] {
		return this.#headCells.map((cell) => cell.content);
	}

	/**
	 * Stretch to the terminal width, one column absorbing the slack. Falls back
	 * to content width when the width is unknown — a pipe has no columns.
	 */
	fullWidth(renderFullWidth = true): this {
		this.#full = renderFullWidth;
		return this;
	}

	/** Which column absorbs the slack. Defaults to the first. */
	fluidColumnIndex(index: number): this {
		// A negative or fractional index would make `fullWidth()` silently do
		// nothing — the kind of failure that is noticed three screens later.
		if (!Number.isInteger(index) || index < 0) {
			throw new InvalidColumnError(
				`fluidColumnIndex(${index}) is not a column position.`,
			);
		}
		this.#fluidColumn = index;
		return this;
	}

	/**
	 * Fix the column widths instead of measuring the content.
	 *
	 * The width is the whole column, padding included — the same thing
	 * `colWidths` means upstream.
	 */
	columnWidths(widths: readonly number[]): this {
		for (const width of widths) {
			if (!Number.isInteger(width) || width < 0) {
				throw new InvalidColumnError(
					`columnWidths received ${width}, which is not a column count.`,
				);
			}
		}
		this.#widths = [...widths];
		return this;
	}

	/** The rendered lines, without writing them. */
	prepare(): string[] {
		const all =
			this.#headCells.length > 0
				? [this.#headCells, ...this.#rows]
				: this.#rows;
		if (all.length === 0) return [];

		const columns = Math.max(...all.map((row) => spannedWidth(row)));
		// Checked before the raw short-circuit: a table asked to stretch on a
		// column it does not have is a mistake whichever mode it renders in,
		// and a test running in raw mode is exactly where it should surface.
		if (this.#full && this.#fluidColumn >= columns) {
			throw new InvalidColumnError(
				`fluidColumnIndex(${this.#fluidColumn}) is out of range — the table has ${columns} column(s).`,
			);
		}

		if (this.#options.raw === true) {
			// One line per row, cells joined — nothing to align, nothing to
			// colour, everything to assert on.
			return all.map((row) => row.map((cell) => cell.content).join("|"));
		}

		const widths = this.#resolveWidths(all, columns);
		const chars = { ...DEFAULT_CHARS, ...this.#options.chars };
		const paint = (glyph: string): string => this.#colors.dim(glyph);

		const lines: string[] = [
			border(
				widths,
				chars.top,
				chars["top-left"],
				chars["top-mid"],
				chars["top-right"],
				paint,
			),
		];
		if (this.#headCells.length > 0) {
			lines.push(
				...this.#renderRow(this.#headCells, widths, chars, paint, true),
			);
			lines.push(
				border(
					widths,
					chars.mid,
					chars["left-mid"],
					chars["mid-mid"],
					chars["right-mid"],
					paint,
				),
			);
		}
		for (const row of this.#rows) {
			lines.push(...this.#renderRow(row, widths, chars, paint, false));
		}
		lines.push(
			border(
				widths,
				chars.bottom,
				chars["bottom-left"],
				chars["bottom-mid"],
				chars["bottom-right"],
				paint,
			),
		);
		return lines;
	}

	render(): void {
		for (const line of this.prepare()) this.#renderer.log(line, "stdout");
	}

	/** Column widths, padding included. */
	#resolveWidths(all: TableCell[][], columns: number): number[] {
		const measured = Array.from({ length: columns }, (_, index) => {
			const fixed = this.#widths[index];
			if (fixed !== undefined) return fixed;
			let widest = 0;
			for (const row of all) {
				// A spanning cell contributes to no single column: sizing one
				// from it would make that column as wide as several.
				for (const [cell, at, span] of positioned(row)) {
					if (span !== 1 || at !== index) continue;
					widest = Math.max(widest, stringWidth(cell.content));
				}
			}
			return widest + PADDING * 2;
		});

		if (!this.#full) return measured;
		// The borders take one column each, plus one on the far right.
		const used =
			measured.reduce((total, width) => total + width, 0) + columns + 1;
		const available = terminalWidth();
		const fluid = measured[this.#fluidColumn];
		if (available > used && fluid !== undefined) {
			measured[this.#fluidColumn] = fluid + (available - used);
		}
		return measured;
	}

	/**
	 * One row, which may be several lines: a cell wider than its column wraps,
	 * and every cell is then padded to the tallest.
	 */
	#renderRow(
		row: TableCell[],
		widths: number[],
		chars: TableChars,
		paint: (glyph: string) => string,
		isHead: boolean,
	): string[] {
		const cells = [...positioned(row)].map(([cell, at, span]) => {
			// A spanning cell owns its columns AND the borders between them.
			const width =
				widths.slice(at, at + span).reduce((total, w) => total + w, 0) +
				(span - 1);
			const inner = Math.max(1, width - PADDING * 2);
			const content = isHead ? this.#colors.bold(cell.content) : cell.content;
			const wrapped = wrap([content], {
				startColumn: 0,
				endColumn: inner,
			}).join("\n");
			// Soft wrapping keeps a word that is longer than the line intact,
			// which is right for prose and wrong inside a border: the cell
			// would push through it. Anything still too wide is cut.
			const lines = wrapped
				.split("\n")
				.flatMap((line) => hardWrap(line, inner));
			return { cell, width, inner, lines };
		});

		const height = Math.max(...cells.map((entry) => entry.lines.length));
		const out: string[] = [];
		for (let line = 0; line < height; line += 1) {
			const parts = cells.map((entry) => {
				const text = pick(
					entry.lines,
					line,
					height,
					entry.cell.vAlign ?? "top",
				);
				return (
					" ".repeat(PADDING) +
					align(text, entry.inner, entry.cell.hAlign ?? "left") +
					" ".repeat(PADDING)
				);
			});
			out.push(
				paint(chars.left) +
					parts.join(paint(chars.middle)) +
					paint(chars.right),
			);
		}
		return out;
	}
}

/** Cut a line into pieces no wider than `width`, never splitting a glyph. */
function hardWrap(line: string, width: number): string[] {
	if (stringWidth(line) <= width) return [line];
	const pieces: string[] = [];
	let current = "";
	for (const character of line) {
		if (stringWidth(current + character) > width) {
			pieces.push(current);
			current = character;
			continue;
		}
		current += character;
	}
	if (current !== "") pieces.push(current);
	return pieces;
}

/** Walk a row, yielding each cell with the column it starts at and its span. */
function* positioned(row: TableCell[]): Generator<[TableCell, number, number]> {
	let at = 0;
	for (const cell of row) {
		const span = Math.max(1, cell.colSpan ?? 1);
		yield [cell, at, span];
		at += span;
	}
}

/** How many columns a row occupies, spans included. */
function spannedWidth(row: TableCell[]): number {
	return row.reduce((total, cell) => total + Math.max(1, cell.colSpan ?? 1), 0);
}

function border(
	widths: number[],
	fill: string,
	left: string,
	mid: string,
	right: string,
	paint: (glyph: string) => string,
): string {
	return paint(
		left + widths.map((width) => fill.repeat(width)).join(mid) + right,
	);
}

/** The line to show at `index` when the cell is shorter than the row. */
function pick(
	lines: string[],
	index: number,
	height: number,
	vAlign: "top" | "center" | "bottom",
): string {
	const offset =
		vAlign === "bottom"
			? height - lines.length
			: vAlign === "center"
				? Math.floor((height - lines.length) / 2)
				: 0;
	return lines[index - offset] ?? "";
}

/**
 * Flatten a row into cells.
 *
 * `{ Name: ["Ada"] }` becomes a bold heading cell followed by its values,
 * which is how upstream renders a keyed row.
 */
function toRow(row: TableRow): TableCell[] {
	if (Array.isArray(row)) return row.map(toCell);
	const entries = Object.entries(row as Record<string, readonly TableInput[]>);
	return entries.flatMap(([heading, cells]) => [
		toCell(heading),
		...cells.map(toCell),
	]);
}

function toCell(input: TableInput): TableCell {
	return typeof input === "string" ? { content: input } : { ...input };
}

/** Pad a cell to `width`, honouring its horizontal alignment. */
function align(
	content: string,
	width: number,
	hAlign: "left" | "right" | "center",
): string {
	const slack = Math.max(0, width - stringWidth(content));
	if (hAlign === "right") return " ".repeat(slack) + content;
	if (hAlign === "center") {
		const left = Math.floor(slack / 2);
		return " ".repeat(left) + content + " ".repeat(slack - left);
	}
	return content + " ".repeat(slack);
}
