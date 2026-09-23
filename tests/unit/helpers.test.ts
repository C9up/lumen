/**
 * Measuring and laying out text.
 *
 * Every misalignment this package could produce starts here: a width measured
 * with `String.length` counts escape codes that draw nothing and counts a CJK
 * glyph as one column when it takes two.
 */

import { describe, expect, it } from "vitest";
import { ansiColors } from "../../src/colors.js";
import { justify, stringWidth, truncate, wrap } from "../../src/helpers.js";

describe("lumen > stringWidth", () => {
	it("ignores escape codes", () => {
		const colored = ansiColors().green("DONE");
		expect(colored.length).toBeGreaterThan(4);
		expect(stringWidth(colored)).toBe(4);
	});

	it("counts a CJK glyph as two columns", () => {
		expect(stringWidth("日本語")).toBe(6);
		expect(stringWidth("ｆｕｌｌ")).toBe(8);
	});

	it("counts an emoji as two columns", () => {
		expect(stringWidth("🚀")).toBe(2);
		// A code point above the BMP is one character, not two — iterating by
		// UTF-16 unit would count it twice.
		expect(stringWidth("a🚀b")).toBe(4);
	});

	it("gives a combining accent no width of its own", () => {
		// "é" decomposed: e + U+0301. It occupies one column, like the
		// precomposed form, and a table mixing both must still line up.
		expect(stringWidth("é")).toBe(1);
		expect(stringWidth("é")).toBe(1);
	});
});

describe("lumen > justify", () => {
	it("pads every column to the same width", () => {
		expect(justify(["a", "bbb"], { maxWidth: 5 })).toEqual(["a    ", "bbb  "]);
	});

	it("pads on the left when right-aligned", () => {
		expect(justify(["7", "42"], { maxWidth: 3, align: "right" })).toEqual([
			"  7",
			" 42",
		]);
	});

	it("leaves a column that is already wider alone", () => {
		// Truncating here would lose content the caller never asked to drop.
		expect(justify(["too long"], { maxWidth: 3 })).toEqual(["too long"]);
	});

	it("pads on the VISIBLE width, so colour does not shift a column", () => {
		const [padded] = justify([ansiColors().red("ab")], { maxWidth: 4 });
		expect(stringWidth(padded ?? "")).toBe(4);
	});
});

describe("lumen > wrap", () => {
	it("indents continuation lines to the start column", () => {
		const [wrapped] = wrap(["one two three four"], {
			startColumn: 4,
			endColumn: 14,
		});
		expect(wrapped).toBe("    one two\n    three four");
	});

	it("drops the indent of the first line when it already follows something", () => {
		const [wrapped] = wrap(["one two three"], {
			startColumn: 4,
			endColumn: 12,
			trimStart: true,
		});
		expect(wrapped).toBe("one two\n    three");
	});

	it("keeps an explicit newline instead of swallowing it", () => {
		const [wrapped] = wrap(["a\nb"], { startColumn: 0, endColumn: 40 });
		expect(wrapped).toBe("a\nb");
	});

	it("puts a word longer than the line on a line of its own", () => {
		// Never an infinite loop, and never silently cut: the word overflows.
		const [wrapped] = wrap(["hi supercalifragilistic"], {
			startColumn: 0,
			endColumn: 6,
		});
		expect(wrapped).toBe("hi\nsupercalifragilistic");
	});
});

describe("lumen > truncate", () => {
	it("leaves text that already fits", () => {
		expect(truncate(["abc"], { maxWidth: 5 })).toEqual(["abc"]);
	});

	it("cuts at the end by default, marking the cut", () => {
		expect(truncate(["abcdef"], { maxWidth: 4 })).toEqual(["abc…"]);
	});

	it("cuts at the start and in the middle on request", () => {
		expect(truncate(["abcdef"], { maxWidth: 4, position: "start" })).toEqual([
			"…def",
		]);
		expect(truncate(["abcdef"], { maxWidth: 5, position: "middle" })).toEqual([
			"ab…ef",
		]);
	});

	it("never splits a wide glyph in half", () => {
		// Half of a CJK glyph is not a character; the budget is spent in whole
		// code points or not at all.
		const [cut] = truncate(["日本語です"], { maxWidth: 5 });
		expect(cut).toBe("日本…");
		expect(stringWidth(cut ?? "")).toBeLessThanOrEqual(5);
	});

	it("degrades to the marker alone when there is no room", () => {
		expect(truncate(["abcdef"], { maxWidth: 1 })).toEqual(["…"]);
		expect(truncate(["abcdef"], { maxWidth: 0 })).toEqual([""]);
	});
});
