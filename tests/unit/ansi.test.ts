/**
 * Escape sequences beyond colour.
 *
 * A hyperlink (OSC 8) or a cursor move (CSI) occupies no column, exactly like
 * a colour code, so measuring and cutting have to see through all of them —
 * the grammar upstream strips with ansi-regex. Expected values below were
 * produced by running strip-ansi 7.2.0 / ansi-regex 6.6.0, string-width 8.3.0
 * and cli-truncate 5.2.0 on the same inputs.
 */

import { describe, expect, it } from "vitest";
import { ansiColors, silentColors, stripAnsi } from "../../src/colors.js";
import { stringWidth, truncate } from "../../src/helpers.js";
import { MemoryRenderer } from "../../src/renderers.js";
import { Table } from "../../src/table.js";

const link = "\u001B]8;;https://x.test\u001B\\docs\u001B]8;;\u001B\\";
const red = (text: string): string => `\u001B[31m${text}\u001B[39m`;

describe("lumen > stripAnsi", () => {
	it("strips every sequence ansi-regex knows", () => {
		expect(stripAnsi(link)).toBe("docs");
		expect(stripAnsi("\u001B[1Ka\u001B[2J\u001B[H")).toBe("a");
		expect(stripAnsi("y\u009B31mz")).toBe("yz");
		expect(stripAnsi("a\u001BPq#0\u001B\\b")).toBe("ab");
		expect(stripAnsi("a\u001B7b\u001B8c")).toBe("abc");
		expect(stripAnsi(red("x"))).toBe("x");
	});

	it("leaves an ESC that introduces nothing", () => {
		expect(stripAnsi("a\u001Bxb")).toBe("a\u001Bxb");
	});

	it("runs in linear time on unterminated introducers", () => {
		for (const unit of ["\u001B[", "\u001B]", "\u009D", "\u001BP"]) {
			const hostile = unit.repeat(500_000);
			const started = performance.now();
			stripAnsi(hostile);
			expect(performance.now() - started).toBeLessThan(1000);
		}
		const started = performance.now();
		stripAnsi(`\u001B]8;;${"a".repeat(1_000_000)}`);
		expect(performance.now() - started).toBeLessThan(1000);
	});
});

describe("lumen > stringWidth beyond colour", () => {
	it("measures a hyperlink as its label", () => {
		expect(stringWidth(link)).toBe(4);
	});

	it("gives a cursor sequence no width", () => {
		expect(stringWidth("\u001B[1Ka")).toBe(1);
	});

	it("keeps a table holding a hyperlink aligned", () => {
		// What a `ui.write()`-built line or a caller's own layout relies on:
		// the helper measures what the terminal draws.
		const lines = [`│ ${link} │`, "│ docs │"];
		expect(stringWidth(lines[0] ?? "")).toBe(stringWidth(lines[1] ?? ""));
	});
});

describe("lumen > truncate keeps the caller's styles", () => {
	it("cuts inside a colour and closes it after the marker", () => {
		expect(truncate([red("hello world")], { maxWidth: 6 })).toEqual([
			"\u001B[31mhello…\u001B[39m",
		]);
	});

	it("reopens the colour on a cut from the start", () => {
		expect(
			truncate([red("hello world")], { maxWidth: 6, position: "start" }),
		).toEqual(["\u001B[31m…world\u001B[39m"]);
	});

	it("closes and reopens around a cut in the middle", () => {
		expect(
			truncate([red("hello world")], { maxWidth: 6, position: "middle" }),
		).toEqual(["\u001B[31mhel\u001B[39m…\u001B[31mld\u001B[39m"]);
	});

	it("keeps the plain text before a coloured part", () => {
		expect(truncate([`ab${red("cdef")}gh`], { maxWidth: 4 })).toEqual([
			"ab\u001B[31mc…\u001B[39m",
		]);
	});

	it("closes a hyperlink it cut", () => {
		expect(
			truncate(
				["\u001B]8;;https://x.test\u0007documentation\u001B]8;;\u0007"],
				{
					maxWidth: 5,
				},
			),
		).toEqual(["\u001B]8;;https://x.test\u0007docu\u001B]8;;\u0007…"]);
	});
});

describe("lumen > Table hard-wraps around escape codes", () => {
	it("never splits a colour code across two lines", () => {
		const colors = ansiColors();
		const table = new Table(colors, new MemoryRenderer());
		table.columnWidths([7]).row([colors.green("abcdefghij")]);
		const lines = table.prepare();
		const body = lines.slice(1, -1);
		expect(body).toHaveLength(4);
		// Every line is the same width, and each carries the whole sequence:
		// a split one would print `[32m` as text.
		for (const line of body) {
			expect(stringWidth(line)).toBe(9);
			expect(stripAnsi(line)).not.toContain("[");
		}
		expect(body[0]).toContain("\u001B[32mabc\u001B[39m");
		expect(body[1]).toContain("\u001B[32mdef\u001B[39m");
	});

	it("still cuts plain text into pieces of the column's width", () => {
		const table = new Table(silentColors(), new MemoryRenderer());
		table.columnWidths([6]).row(["abcdefg"]);
		expect(table.prepare().slice(1, -1)).toEqual([
			"│  ab  │",
			"│  cd  │",
			"│  ef  │",
			"│  g   │",
		]);
	});
});
