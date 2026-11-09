/**
 * Measuring and laying out text.
 *
 * Every misalignment this package could produce starts here: a width measured
 * with `String.length` counts escape codes that draw nothing and counts a CJK
 * glyph as one column when it takes two.
 */

import { describe, expect, it } from "vitest";
import { ansiColors, silentColors } from "../../src/colors.js";
import { justify, stringWidth, truncate, wrap } from "../../src/helpers.js";
import { MemoryRenderer } from "../../src/renderers.js";
import { Table } from "../../src/table.js";

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

describe("lumen > stringWidth matches what the terminal draws", () => {
	// Every expected value is what string-width 8.3.0 — upstream's measure —
	// returns for the same input.
	const cases: Array<[string, string, number]> = [
		["check mark", "✅", 2],
		["cross", "❌", 2],
		["star", "⭐", 2],
		["watch", "⌚", 2],
		["melting face (U+1FAE0)", "\u{1FAE0}", 2],
		["thumbs up + skin tone", "\u{1F44D}\u{1F3FD}", 2],
		["family ZWJ sequence", "\u{1F468}‍\u{1F469}‍\u{1F467}", 2],
		["rainbow flag ZWJ", "\u{1F3F3}\u{FE0F}‍\u{1F308}", 2],
		["regional indicator flag", "🇫🇷", 2],
		["keycap", "1⃣", 2],
		["heart with VS16", "❤️", 2],
		["heart, text presentation", "❤", 1],
		["Hangul jamo L+V", "가", 2],
		["unmatched leading jamo", "ᄀ가", 4],
		["halfwidth katakana + sound mark", "ｶﾞ", 2],
		["Devanagari spacing mark", "कि", 2],
		["Thai combining vowel", "กั", 1],
		["ideographic space", "　", 2],
		["CJK extension B", "\u{20000}", 2],
		["zero width space", "​", 0],
		["soft hyphen", "­", 0],
		["box drawing and arrows", "│→…", 3],
		["lumen's own icons", "✔✖❯", 3],
		["tab", "a\tb", 2],
	];

	for (const [label, text, expected] of cases) {
		it(label, () => {
			expect(stringWidth(text)).toBe(expected);
		});
	}

	it("keeps a table of status glyphs aligned", () => {
		const table = new Table(silentColors(), new MemoryRenderer());
		table
			.head(["Status", "File"])
			.row(["✅", "a.ts"])
			.row(["\u{1F44D}\u{1F3FD}", "b.ts"])
			.row(["\u{1F468}‍\u{1F469}‍\u{1F467}", "c.ts"])
			.row(["ok", "d.ts"]);
		// Spelled out rather than measured: measuring with the function under
		// test would agree with itself however wrong it was.
		expect(table.prepare().slice(3, 6)).toEqual([
			"│  ✅      │  a.ts  │",
			"│  \u{1F44D}\u{1F3FD}      │  b.ts  │",
			"│  \u{1F468}\u200D\u{1F469}\u200D\u{1F467}      │  c.ts  │",
		]);
	});

	it("never cuts an emoji sequence in two", () => {
		const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
		const [cut] = truncate([`${family}${family}${family}`], { maxWidth: 5 });
		expect(cut).toBe(`${family}${family}…`);
		const table = new Table(silentColors(), new MemoryRenderer());
		table.columnWidths([6]).row([`${family}${family}`]);
		expect(table.prepare().slice(1, -1)).toEqual([
			`│  ${family}  │`,
			`│  ${family}  │`,
		]);
	});
});
