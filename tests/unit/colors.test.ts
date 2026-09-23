/**
 * Colours — the three implementations, and the one decision that picks them.
 *
 * The close codes are what this file really guards: a blanket reset looks
 * right in isolation and silently drops the outer style of every nested call.
 */

import { describe, expect, it } from "vitest";
import {
	ansiColors,
	rawColors,
	silentColors,
	stripAnsi,
	supportsColor,
} from "../../src/colors.js";

describe("lumen > colors", () => {
	it("opens and closes each style with its own code, so nesting survives", () => {
		const colors = ansiColors();
		const nested = colors.red(`a ${colors.dim("b")} c`);
		// dim closes with 22, NOT with a blanket reset — the red is still on
		// after it, and only 39 ends it.
		expect(nested).toBe("\u001B[31ma \u001B[2mb\u001B[22m c\u001B[39m");
		// Stripped, the visible text is intact.
		expect(stripAnsi(nested)).toBe("a b c");
	});

	it("closes a chain inside-out", () => {
		expect(ansiColors().bold.red("x")).toBe(
			"\u001B[1m\u001B[31mx\u001B[39m\u001B[22m",
		);
	});

	it("accepts both the property and the call spelling", () => {
		const colors = ansiColors();
		expect(colors.dim.yellow("x")).toBe(colors.dim().yellow("x"));
	});

	it("does not leak a chain from one call into the next", () => {
		// The chain is immutable, so reading `.dim` twice cannot accumulate.
		const colors = ansiColors();
		const dim = colors.dim;
		expect(dim("a")).toBe(dim("a"));
		expect(colors.green("b")).toBe("\u001B[32mb\u001B[39m");
	});

	it("silent returns the text untouched, numbers included", () => {
		const colors = silentColors();
		expect(colors.bgRed().white("  ERROR  ")).toBe("  ERROR  ");
		expect(colors.green(42)).toBe("42");
	});

	it("raw spells the transformations out, outermost last", () => {
		expect(rawColors().dim.yellow("2 files")).toBe("dim(yellow(2 files))");
	});

	it("renders nothing special when no style was applied", () => {
		expect(ansiColors()("plain")).toBe("plain");
		expect(rawColors()("plain")).toBe("plain");
	});
});

describe("lumen > supportsColor", () => {
	const tty = { isTTY: true };
	const pipe = { isTTY: false };

	it("follows the stream when nothing overrides it", () => {
		expect(supportsColor(tty, {})).toBe(true);
		expect(supportsColor(pipe, {})).toBe(false);
	});

	it("honours NO_COLOR for any non-empty value", () => {
		expect(supportsColor(tty, { NO_COLOR: "1" })).toBe(false);
		expect(supportsColor(tty, { NO_COLOR: "anything" })).toBe(false);
		// Empty is not set, per no-color.org.
		expect(supportsColor(tty, { NO_COLOR: "" })).toBe(true);
	});

	it("lets FORCE_COLOR win over NO_COLOR, both ways", () => {
		expect(supportsColor(pipe, { FORCE_COLOR: "1", NO_COLOR: "1" })).toBe(true);
		// Set to a falsy value it means OFF — existing is not the same as on.
		expect(supportsColor(tty, { FORCE_COLOR: "0" })).toBe(false);
		expect(supportsColor(tty, { FORCE_COLOR: "false" })).toBe(false);
	});

	it("refuses a dumb terminal", () => {
		expect(supportsColor(tty, { TERM: "dumb" })).toBe(false);
	});

	it("colours a CI it knows and stays plain on one it does not", () => {
		expect(supportsColor(pipe, { CI: "true", GITHUB_ACTIONS: "true" })).toBe(
			true,
		);
		// An unknown log viewer printing [32m on every line is worse than a
		// plain transcript; FORCE_COLOR is there to say otherwise.
		expect(supportsColor(pipe, { CI: "true" })).toBe(false);
		expect(supportsColor(tty, { CI: "true" })).toBe(false);
	});
});
