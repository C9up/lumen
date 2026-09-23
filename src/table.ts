/**
 * A column-aligned table.
 *
 * Widths are measured with {@link stringWidth}, never `String.length`: a cell
 * coloured green carries escape codes that occupy no columns, and a CJK or
 * emoji cell occupies two per glyph. Get that wrong and every row under the
 * offending cell is ragged.
 */

import type { Colors } from "./colors.js";
import { stringWidth, terminalWidth } from "./helpers.js";
import type { Renderer } from "./renderers.js";

export interface TableCell {
	content: string;
	hAlign?: "left" | "right" | "center";
}

export type TableInput = string | TableCell;

/** Raised when a table is asked to stretch on a column it does not have. */
export class InvalidColumnError extends Error {
	readonly code = "E_LUMEN_INVALID_COLUMN";
	constructor(message: string) {
		super(message);
		this.name = "InvalidColumnError";
	}
}

export class Table {
	readonly #colors: Colors;
	readonly #renderer: Renderer;
	#headCells: TableCell[] = [];
	readonly #rows: TableCell[][] = [];
	#full = false;
	#fluidColumn = 0;

	constructor(colors: Colors, renderer: Renderer) {
		this.#colors = colors;
		this.#renderer = renderer;
	}

	head(columns: readonly TableInput[]): this {
		this.#headCells = columns.map(toCell);
		return this;
	}

	row(cells: readonly TableInput[]): this {
		this.#rows.push(cells.map(toCell));
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
	fullWidth(): this {
		this.#full = true;
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

	/** The rendered lines, without writing them. */
	prepare(): string[] {
		const all =
			this.#headCells.length > 0
				? [this.#headCells, ...this.#rows]
				: this.#rows;
		if (all.length === 0) return [];

		const columns = Math.max(...all.map((row) => row.length));
		const widths = Array.from({ length: columns }, (_, index) =>
			Math.max(...all.map((row) => stringWidth(row[index]?.content ?? ""))),
		);

		if (this.#full) {
			// Known only now: the column count comes from the rows.
			if (this.#fluidColumn >= columns) {
				throw new InvalidColumnError(
					`fluidColumnIndex(${this.#fluidColumn}) is out of range — the table has ${columns} column(s).`,
				);
			}
			const available = terminalWidth();
			const used =
				widths.reduce((total, width) => total + width, 0) + (columns - 1) * 2;
			// Only ever grows the fluid column; shrinking would truncate content.
			const fluid = widths[this.#fluidColumn];
			if (available > used && fluid !== undefined) {
				widths[this.#fluidColumn] = fluid + (available - used);
			}
		}

		const line = (cells: readonly TableCell[]): string =>
			cells
				.map((cell, index) => align(cell, widths[index] ?? 0))
				.join("  ")
				.trimEnd();

		const lines: string[] = [];
		if (this.#headCells.length > 0) {
			lines.push(
				line(
					this.#headCells.map((cell) => ({
						...cell,
						content: this.#colors.bold(cell.content),
					})),
				),
			);
			lines.push(widths.map((width) => "─".repeat(width)).join("  "));
		}
		for (const row of this.#rows) lines.push(line(row));
		return lines;
	}

	render(): void {
		for (const line of this.prepare()) this.#renderer.log(line, "stdout");
	}
}

function toCell(input: TableInput): TableCell {
	return typeof input === "string" ? { content: input } : { ...input };
}

/** Pad a cell to `width`, honouring its horizontal alignment. */
function align(cell: TableCell, width: number): string {
	const slack = Math.max(0, width - stringWidth(cell.content));
	if (cell.hAlign === "right") return " ".repeat(slack) + cell.content;
	if (cell.hAlign === "center") {
		const left = Math.floor(slack / 2);
		return " ".repeat(left) + cell.content + " ".repeat(slack - left);
	}
	return cell.content + " ".repeat(slack);
}
