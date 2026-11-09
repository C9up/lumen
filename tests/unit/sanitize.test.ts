/**
 * Untrusted text reaching the terminal.
 *
 * A file name, a database value or an error message is DATA, and every widget
 * prints data. Written verbatim, an OSC 52 in it writes the operator's
 * clipboard, an OSC 0 retitles the window, a CSI 2J wipes the screen and a CR
 * or LF overwrites the `[ error ]` label or forges a `[ success ]` line. The
 * widgets render every such control visibly instead, while keeping the colour
 * (SGR) a caller deliberately put on a cell.
 */

import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/ansi.js";
import { Box } from "../../src/box.js";
import { ansiColors, rawColors, silentColors } from "../../src/colors.js";
import { stringWidth } from "../../src/helpers.js";
import { Action, Logger, Spinner } from "../../src/logger.js";
import { MemoryRenderer } from "../../src/renderers.js";
import { Steps } from "../../src/steps.js";
import { Table } from "../../src/table.js";
import { Tasks } from "../../src/tasks.js";

const ATTACKS = {
	clipboard: "users\u001B]52;c;Y3VybCBldmlsLnNofHNo\u0007",
	title: "t\u001B]0;pwned title\u0007",
	hyperlink: "\u001B]8;;https://evil.example\u001B\\safe.txt\u001B]8;;\u001B\\",
	clear: "x\u001B[2J\u001B[H",
	c1: "y\u009B31mC1-CSI\u009B0m",
	carriageReturn: "ok\rFAKE",
	backspace: "abc\b\b\bXYZ",
	bell: "bell\u0007",
	lineSeparator: "a\u2028b",
	bidi: "file\u202Etxt.exe",
	dcs: "d\u001BPq#0\u001B\\",
};

/**
 * Nothing in the text acts on the terminal: the only ESC left introduces an
 * SGR (colour) sequence, and no other control survives.
 */
const SGR_SOURCE = String.raw`\u001B\[[0-9;]*m`;
const ACTIVE_SOURCE = String.raw`[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]`;

function expectInert(text: string): void {
	const withoutSgr = text.replace(new RegExp(SGR_SOURCE, "g"), "");
	expect(withoutSgr).not.toMatch(new RegExp(ACTIVE_SOURCE));
}

function count(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

function messages(renderer: MemoryRenderer): string[] {
	return renderer.getLogs().map((entry) => entry.message);
}

describe("lumen > sanitize", () => {
	it("renders every control visibly", () => {
		expect(sanitize(ATTACKS.clipboard)).toBe(
			"users\\x1b]52;c;Y3VybCBldmlsLnNofHNo\\x07",
		);
		expect(sanitize(ATTACKS.c1)).toBe("y\\x9b31mC1-CSI\\x9b0m");
		expect(sanitize(ATTACKS.carriageReturn)).toBe("ok\\x0dFAKE");
		expect(sanitize(ATTACKS.backspace)).toBe("abc\\x08\\x08\\x08XYZ");
		expect(sanitize(ATTACKS.lineSeparator)).toBe("a\\u2028b");
		expect(sanitize(ATTACKS.bidi)).toBe("file\\u202etxt.exe");
		expect(sanitize("del\u007F")).toBe("del\\x7f");
		for (const attack of Object.values(ATTACKS)) expectInert(sanitize(attack));
	});

	it("escapes a newline unless the caller splits lines itself", () => {
		expect(sanitize("bob\n[ success ] applied")).toBe(
			"bob\\x0a[ success ] applied",
		);
		expect(sanitize("one\ntwo", { keepNewlines: true })).toBe("one\ntwo");
		// A CR is never a line break of its own: it rewinds over the label.
		expect(sanitize("one\r\ntwo", { keepNewlines: true })).toBe(
			"one\\x0d\ntwo",
		);
	});

	it("keeps a tab and printable text untouched", () => {
		expect(sanitize("a\tb — é 日本 🚀")).toBe("a\tb — é 日本 🚀");
	});

	it("keeps colour, and closes whatever the text left open", () => {
		const colors = ansiColors();
		const green = colors.green("ok");
		expect(sanitize(green)).toBe(green);
		// A value that opens `conceal` and never closes it would hide every
		// line printed after it.
		expect(sanitize("\u001B[8mhidden")).toBe("\u001B[8mhidden\u001B[28m");
		expect(sanitize("\u001B[1;31mloud")).toBe(
			"\u001B[1;31mloud\u001B[39m\u001B[22m",
		);
		expect(sanitize("\u001B[38;5;196mred")).toBe(
			"\u001B[38;5;196mred\u001B[39m",
		);
		expect(sanitize("\u001B[31ma\u001B[0mb")).toBe("\u001B[31ma\u001B[0mb");
	});

	it("runs in linear time on hostile input", () => {
		const hostile = "\u001B[".repeat(500_000);
		const started = performance.now();
		const out = sanitize(hostile);
		expect(performance.now() - started).toBeLessThan(1000);
		expectInert(out);
	});
});

describe("lumen > widgets neutralise untrusted text", () => {
	it("table cells and head, bordered", () => {
		const table = new Table(silentColors(), new MemoryRenderer());
		table.head(["Name\u001B]0;head\u0007", "Value"]);
		for (const attack of Object.values(ATTACKS)) table.row([attack, "1"]);
		const lines = table.prepare();
		for (const line of lines) expectInert(line);
		// Escaped text is measured as what it now is, so the border holds.
		const widths = new Set(lines.map((line) => stringWidth(line)));
		expect(widths.size).toBe(1);
		expect(lines.join("\n")).toContain("users\\x1b]52;c;");
	});

	it("table cells in raw mode", () => {
		const table = new Table(rawColors(), new MemoryRenderer(), { raw: true });
		table.row([ATTACKS.title, ATTACKS.carriageReturn]);
		const [line] = table.prepare();
		expect(line).toBe("t\\x1b]0;pwned title\\x07|ok\\x0dFAKE");
		// The data accessor still hands back what was given.
		expect(table.getRows()).toEqual([[ATTACKS.title, ATTACKS.carriageReturn]]);
	});

	it("a coloured cell stays coloured", () => {
		const colors = ansiColors();
		const table = new Table(colors, new MemoryRenderer());
		table.row([colors.green("applied"), "1"]);
		expect(table.prepare().join("\n")).toContain("\u001B[32mapplied\u001B[39m");
	});

	it("contains a style a cell leaves open to that cell's lines", () => {
		const colors = ansiColors();
		const table = new Table(colors, new MemoryRenderer());
		table.row(["\u001B[8mone\ntwo", "x"]).row(["after", "y"]);
		const lines = table.prepare();
		// Every rendered line closes what it opened: nothing bleeds into the
		// border, the next cell or the next row.
		for (const line of lines) {
			expect(count(line, "\u001B[28m")).toBe(count(line, "\u001B[8m"));
		}
		expect(lines[2]).toContain("\u001B[8mtwo");
	});

	it("logger message, prefix and suffix", () => {
		const renderer = new MemoryRenderer();
		const logger = new Logger(rawColors(), renderer);
		logger.error("cannot open uploads/evil\r[ success ] all files verified");
		logger.warning("name=bob\n[ success ] migration applied");
		logger.info(ATTACKS.clipboard, {
			prefix: ATTACKS.title,
			suffix: ATTACKS.clear,
		});
		const lines = messages(renderer);
		expect(lines).toEqual([
			"[ red(error) ] cannot open uploads/evil\\x0d[ success ] all files verified",
			"[ yellow(warn) ] name=bob\\x0a[ success ] migration applied",
			"dim([t\\x1b]0;pwned title\\x07]) [ blue(info) ] users\\x1b]52;c;Y3VybCBldmlsLnNofHNo\\x07 dim(yellow((x\\x1b[2J\\x1b[H)))",
		]);
		// One message, one line: nothing forged under it.
		for (const line of lines) expect(line.split("\n")).toHaveLength(1);
	});

	it("logger sticky prefix and suffix", () => {
		const renderer = new MemoryRenderer();
		const logger = new Logger(rawColors(), renderer);
		logger.prefix("w\u0007").suffix("s\r").info("m");
		expect(messages(renderer)).toEqual([
			"dim([w\\x07]) [ blue(info) ] m dim(yellow((s\\x0d)))",
		]);
	});

	it("an Error's message and stack under fatal", () => {
		const renderer = new MemoryRenderer();
		const logger = new Logger(rawColors(), renderer);
		const error = new Error("bad\u001B]52;c;eA==\u0007");
		error.stack = "Error: bad\n    at \u001B[2Jhere";
		logger.fatal(error);
		expect(messages(renderer)).toEqual([
			"[ red(error) ] bad\\x1b]52;c;eA==\\x07\n      dim(at \\x1b[2Jhere)",
		]);
	});

	it("action title, skip reason and failure", () => {
		const renderer = new MemoryRenderer();
		const colors = rawColors();
		new Action(ATTACKS.title, colors, renderer).succeeded();
		new Action("a", colors, renderer).skipped(ATTACKS.carriageReturn);
		const error = new Error("x");
		error.stack = "Error: x\u0007\n    at \u001B[Hy";
		new Action("b", colors, renderer).failed(error);
		new Action("c", colors, renderer).failed("plain\rstring");
		const lines = messages(renderer);
		for (const line of lines) expectInert(line);
		expect(lines[0]).toBe("green(DONE:   ) t\\x1b]0;pwned title\\x07");
		expect(lines[1]).toBe("cyan(SKIPPED:) a dim((ok\\x0dFAKE))");
		expect(lines[2]).toBe(
			"red(FAILED: ) b\n      red(Error: x\\x07)\n      red(at \\x1b[Hy)",
		);
		expect(lines[3]).toBe("red(FAILED: ) c\n      red(plain\\x0dstring)");
	});

	it("spinner text", () => {
		const renderer = new MemoryRenderer();
		const spinner = new Spinner(() => ATTACKS.title, renderer).start();
		spinner.update("next\r[ success ]");
		spinner.stop();
		expect(messages(renderer)).toEqual([
			"t\\x1b]0;pwned title\\x07",
			"next\\x0d[ success ]",
		]);
	});

	it("box heading and lines", () => {
		const renderer = new MemoryRenderer();
		const box = new Box(silentColors(), renderer, { pointer: true });
		box.heading(ATTACKS.title).add(ATTACKS.clipboard).add("two\nlines");
		const lines = box.prepare();
		for (const line of lines) expectInert(line);
		// A newline inside one entry would break the frame; it is shown instead.
		expect(lines.some((line) => line.includes("two\\x0alines"))).toBe(true);
		expect(new Set(lines.map((line) => stringWidth(line))).size).toBe(1);
	});

	it("steps title and content, content keeping its lines", () => {
		const renderer = new MemoryRenderer();
		const steps = new Steps(rawColors(), renderer);
		steps.add(ATTACKS.clear, `${ATTACKS.c1}\nsecond`);
		expect(steps.prepare()).toEqual([
			"cyan(1.) bold(x\\x1b[2J\\x1b[H)",
			"   y\\x9b31mC1-CSI\\x9b0m",
			"   second",
		]);
	});

	it("task title, progress, success and failure messages", async () => {
		const renderer = new MemoryRenderer();
		await new Tasks(rawColors(), renderer, { verbose: true })
			.add(ATTACKS.title, async (task) => {
				task.update("50%\r[ done ]");
				return "ok\u001B[2J";
			})
			.add("second", async () => new Error("no\u0007\nwhere"))
			.run();
		const lines = messages(renderer);
		for (const line of lines) {
			expectInert(line);
			expect(line.split("\n")).toHaveLength(1);
		}
		expect(lines).toEqual([
			"  dim(t\\x1b]0;pwned title\\x07: 50%\\x0d[ done ])",
			expect.stringMatching(
				/^green\(✔\) t\\x1b]0;pwned title\\x07 dim\(ok\\x1b\[2J\) dim\(\(\d+ms\)\)$/,
			),
			expect.stringMatching(
				/^red\(✖\) second dim\(no\\x07\\x0awhere\) dim\(\(\d+ms\)\)$/,
			),
		]);
	});

	it("leaves logger.log as the explicit raw escape hatch", () => {
		// A caller printing its own escape sequences on purpose — a hyperlink,
		// a cursor move — goes through log(), which writes what it is given.
		const renderer = new MemoryRenderer();
		new Logger(rawColors(), renderer).log("\u001B]8;;https://x\u001B\\x");
		expect(messages(renderer)).toEqual(["\u001B]8;;https://x\u001B\\x"]);
	});
});
