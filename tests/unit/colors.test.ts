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

	it("restores the OUTER colour after a nested one ends", () => {
		// The case a per-style close code does not cover: both foregrounds end
		// with 39, so the inner yellow's close would cancel the red that is
		// still meant to be running. An external audit caught this one.
		const colors = ansiColors();
		const nested = colors.red(`a ${colors.yellow("b")} c`);
		expect(nested).toBe(
			"\u001B[31ma \u001B[33mb\u001B[39m\u001B[31m c\u001B[39m",
		);
		// What it looks like: red, red, then red again after the yellow.
		expect(stripAnsi(nested)).toBe("a b c");
	});

	it("restores an outer BACKGROUND the same way", () => {
		const colors = ansiColors();
		const nested = colors.bgBlue(`x ${colors.bgRed("y")} z`);
		expect(nested).toContain("\u001B[49m\u001B[44m z");
	});

	it("repairs every occurrence, not only the first", () => {
		const colors = ansiColors();
		const nested = colors.red(`${colors.yellow("a")}-${colors.yellow("b")}-c`);
		expect(nested.split("\u001B[39m\u001B[31m")).toHaveLength(3);
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
	const xterm = { TERM: "xterm-256color" };
	// Flags are passed explicitly: the runner's own argv must not decide.
	const none: string[] = [];

	it("follows the stream and the terminal when nothing overrides them", () => {
		expect(supportsColor(tty, xterm, none)).toBe(true);
		expect(supportsColor(pipe, xterm, none)).toBe(false);
		// A terminal that says nothing about itself gets nothing.
		expect(supportsColor(tty, {}, none)).toBe(false);
		expect(supportsColor(tty, { COLORTERM: "truecolor" }, none)).toBe(true);
	});

	it("honours NO_COLOR for any non-empty value", () => {
		expect(supportsColor(tty, { ...xterm, NO_COLOR: "1" }, none)).toBe(false);
		expect(supportsColor(tty, { ...xterm, NO_COLOR: "x" }, none)).toBe(false);
		// Empty is not set, per no-color.org.
		expect(supportsColor(tty, { ...xterm, NO_COLOR: "" }, none)).toBe(true);
	});

	it("lets FORCE_COLOR win over NO_COLOR, both ways", () => {
		expect(supportsColor(pipe, { FORCE_COLOR: "1", NO_COLOR: "1" }, none)).toBe(
			true,
		);
		expect(supportsColor(tty, { ...xterm, FORCE_COLOR: "0" }, none)).toBe(
			false,
		);
		expect(supportsColor(tty, { ...xterm, FORCE_COLOR: "false" }, none)).toBe(
			false,
		);
	});

	it("parses FORCE_COLOR the way supports-color does", () => {
		// Empty and "true" mean on; Node documents the empty form too.
		expect(supportsColor(pipe, { FORCE_COLOR: "" }, none)).toBe(true);
		expect(supportsColor(pipe, { FORCE_COLOR: "true" }, none)).toBe(true);
		expect(supportsColor(pipe, { FORCE_COLOR: "3" }, none)).toBe(true);
		// Unparsable is ignored, not read as "on".
		expect(supportsColor(pipe, { FORCE_COLOR: "abc" }, none)).toBe(false);
		expect(supportsColor(tty, { ...xterm, FORCE_COLOR: "abc" }, none)).toBe(
			true,
		);
	});

	it("refuses a dumb terminal unless forced", () => {
		expect(supportsColor(tty, { TERM: "dumb" }, none)).toBe(false);
		expect(supportsColor(tty, { TERM: "dumb", FORCE_COLOR: "1" }, none)).toBe(
			true,
		);
	});

	it("never colours a redirected stream because the job runs in CI", () => {
		// `ream cmd > out.txt` inside a GitHub job wrote escape codes into
		// the file: the CI list is consulted only for a terminal.
		const github = { CI: "true", GITHUB_ACTIONS: "true" };
		expect(supportsColor(pipe, github, none)).toBe(false);
		expect(supportsColor(pipe, { CI: "1", GITLAB_CI: "1" }, none)).toBe(false);
		expect(supportsColor(tty, github, none)).toBe(true);
		expect(supportsColor(tty, { CI: "1", GITEA_ACTIONS: "1" }, none)).toBe(
			true,
		);
		expect(supportsColor(tty, { CI: "1", CI_NAME: "codeship" }, none)).toBe(
			true,
		);
		// An unknown CI stays plain, even on a terminal.
		expect(supportsColor(tty, { ...xterm, CI: "true" }, none)).toBe(false);
	});

	it("colours Azure Pipelines, which has no terminal", () => {
		expect(supportsColor(pipe, { TF_BUILD: "1", AGENT_NAME: "a" }, none)).toBe(
			true,
		);
	});

	it("honours the --color and --no-color flags before a `--`", () => {
		expect(supportsColor(pipe, {}, ["node", "cmd", "--color"])).toBe(true);
		expect(supportsColor(pipe, {}, ["node", "cmd", "--color=always"])).toBe(
			true,
		);
		expect(supportsColor(tty, xterm, ["node", "cmd", "--no-color"])).toBe(
			false,
		);
		expect(supportsColor(tty, xterm, ["node", "cmd", "--color=never"])).toBe(
			false,
		);
		// After `--` it is an argument of something else.
		expect(supportsColor(pipe, {}, ["node", "cmd", "--", "--color"])).toBe(
			false,
		);
		// The environment wins over a flag, as supports-color has it.
		expect(
			supportsColor(pipe, { FORCE_COLOR: "0" }, ["node", "cmd", "--color"]),
		).toBe(false);
	});
});
