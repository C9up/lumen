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
	/**
	 * How many ROWS this cell spans.
	 *
	 * It keeps its column busy in the rows below, so their cells shift right,
	 * and its own text is laid out across the combined height of every row it
	 * covers.
	 */
	rowSpan?: number;
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

		const grid = layout(all);
		const columns = grid.columns;
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

		const widths = this.#resolveWidths(grid, columns);
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
		const headRows = this.#headCells.length > 0 ? 1 : 0;
		const blocks = this.#renderGrid(grid, widths, chars, paint, headRows);
		if (headRows === 1) {
			lines.push(...(blocks[0] ?? []));
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
		for (const block of blocks.slice(headRows)) lines.push(...block);
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
	#resolveWidths(grid: Grid, columns: number): number[] {
		const measured = Array.from({ length: columns }, (_, index) => {
			const fixed = this.#widths[index];
			if (fixed !== undefined) return fixed;
			let widest = 0;
			for (const placed of grid.placed) {
				// A spanning cell contributes to no single column: sizing one
				// from it would make that column as wide as several.
				if (placed.colSpan !== 1 || placed.column !== index) continue;
				widest = Math.max(widest, stringWidth(placed.cell.content));
			}
			return widest + PADDING * 2;
		});

		// A spanning cell measured nothing, so its columns may be too narrow
		// for it. Widen them until it fits — truncating it instead would hide
		// content the caller never asked to drop, and cli-table3 grows too.
		for (const placed of grid.placed) {
			if (placed.colSpan === 1) continue;
			if (this.#widths.length > 0) continue; // explicit widths are the caller's
			const needed = stringWidth(placed.cell.content) + PADDING * 2;
			const have = spanWidth(measured, placed.column, placed.colSpan);
			if (have >= needed) continue;
			let missing = needed - have;
			// Spread it, one column at a time, so no single column absorbs all
			// of it and the table stays balanced.
			for (let i = 0; missing > 0; i = (i + 1) % placed.colSpan) {
				const at = placed.column + i;
				const width = measured[at];
				if (width === undefined) break;
				measured[at] = width + 1;
				missing -= 1;
			}
		}

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
	 * Every row, as a block of lines.
	 *
	 * Rendered from the GRID rather than row by row, because a cell with a
	 * `rowSpan` belongs to several rows at once: its text is laid out across
	 * their combined height, and the rows below it skip the column it holds.
	 */
	#renderGrid(
		grid: Grid,
		widths: number[],
		chars: TableChars,
		paint: (glyph: string) => string,
		headRows: number,
	): string[][] {
		// Each cell's text, wrapped to the width it actually spans.
		const laid = new Map<Placed, string[]>();
		for (const placed of grid.placed) {
			const width = spanWidth(widths, placed.column, placed.colSpan);
			const inner = Math.max(1, width - PADDING * 2);
			const isHead = placed.row < headRows;
			const content = isHead
				? this.#colors.bold(placed.cell.content)
				: placed.cell.content;
			const wrapped = wrap([content], {
				startColumn: 0,
				endColumn: inner,
			}).join("\n");
			// Soft wrapping keeps a word that is longer than the line intact,
			// which is right for prose and wrong inside a border: the cell
			// would push through it. Anything still too wide is cut.
			laid.set(
				placed,
				wrapped.split("\n").flatMap((line) => hardWrap(line, inner)),
			);
		}

		// Row heights: the tallest single-row cell starting there, then any
		// spanning cell that still does not fit pushes its last row down.
		const heights = Array.from({ length: grid.rows }, (_, row) => {
			let tallest = 1;
			for (const placed of grid.placed) {
				if (placed.row !== row || placed.rowSpan !== 1) continue;
				tallest = Math.max(tallest, laid.get(placed)?.length ?? 1);
			}
			return tallest;
		});
		for (const placed of grid.placed) {
			if (placed.rowSpan === 1) continue;
			const covered = heights
				.slice(placed.row, placed.row + placed.rowSpan)
				.reduce((total, height) => total + height, 0);
			const needed = laid.get(placed)?.length ?? 1;
			const last = placed.row + placed.rowSpan - 1;
			const current = heights[last];
			if (needed > covered && current !== undefined) {
				heights[last] = current + (needed - covered);
			}
		}

		// Where each row's text starts inside a cell that began above it.
		const offsets = heights.map((_, row) =>
			heights.slice(0, row).reduce((total, height) => total + height, 0),
		);

		return heights.map((height, row) => {
			const out: string[] = [];
			for (let line = 0; line < height; line += 1) {
				const parts: string[] = [];
				let column = 0;
				while (column < grid.columns) {
					const placed = grid.owner[row]?.[column];
					if (placed === undefined) {
						// Nothing claims this slot: an empty cell of one column.
						parts.push(" ".repeat(widths[column] ?? 0));
						column += 1;
						continue;
					}
					if (placed.column !== column) {
						// Already emitted as part of a spanning cell.
						column += 1;
						continue;
					}
					const width = spanWidth(widths, placed.column, placed.colSpan);
					const inner = Math.max(1, width - PADDING * 2);
					const lines = laid.get(placed) ?? [];
					const within =
						(offsets[row] ?? 0) - (offsets[placed.row] ?? 0) + line;
					const total = heights
						.slice(placed.row, placed.row + placed.rowSpan)
						.reduce((sum, value) => sum + value, 0);
					const text = pick(lines, within, total, placed.cell.vAlign ?? "top");
					parts.push(
						" ".repeat(PADDING) +
							align(text, inner, placed.cell.hAlign ?? "left") +
							" ".repeat(PADDING),
					);
					column += placed.colSpan;
				}
				out.push(
					paint(chars.left) +
						parts.join(paint(chars.middle)) +
						paint(chars.right),
				);
			}
			return out;
		});
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

/** One cell, once it knows where it sits. */
interface Placed {
	cell: TableCell;
	row: number;
	column: number;
	colSpan: number;
	rowSpan: number;
}

/** Every cell, placed, plus who owns each slot. */
interface Grid {
	columns: number;
	rows: number;
	placed: Placed[];
	/** `owner[row][column]`, or undefined where nothing reaches. */
	owner: Array<Array<Placed | undefined>>;
}

/**
 * Place every cell, left to right, skipping slots a row above still holds.
 *
 * This is the whole of `rowSpan`: a cell that spans rows keeps its column
 * busy below, so the next row's cells land one column further right than
 * their position in the array suggests.
 */
function layout(rows: TableCell[][]): Grid {
	const owner: Array<Array<Placed | undefined>> = rows.map(() => []);
	const placed: Placed[] = [];
	let columns = 0;

	rows.forEach((cells, row) => {
		let column = 0;
		for (const cell of cells) {
			// Walk past anything a spanning cell above already claimed.
			while (owner[row]?.[column] !== undefined) column += 1;

			const colSpan = Math.max(1, cell.colSpan ?? 1);
			const rowSpan = Math.max(1, cell.rowSpan ?? 1);
			const entry: Placed = { cell, row, column, colSpan, rowSpan };
			placed.push(entry);

			for (let r = row; r < row + rowSpan && r < rows.length; r += 1) {
				const line = owner[r];
				if (line === undefined) continue;
				for (let c = column; c < column + colSpan; c += 1) line[c] = entry;
			}
			column += colSpan;
			columns = Math.max(columns, column);
		}
	});

	return { columns, rows: rows.length, placed, owner };
}

/** The width a cell occupies, the borders it swallows included. */
function spanWidth(widths: number[], column: number, span: number): number {
	return (
		widths
			.slice(column, column + span)
			.reduce((total, width) => total + width, 0) +
		(span - 1)
	);
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
