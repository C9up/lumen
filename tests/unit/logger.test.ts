/**
 * The logger's vocabulary.
 *
 * The labels and their colours are a contract across every package: `[ warn ]`
 * must look the same whether it comes from a migration, the dev server or an
 * application command. Asserted in raw mode, where a colour reads as
 * `yellow(warn)` instead of a soup of escape codes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { rawColors } from "../../src/colors.js";
import { Action, Logger, Spinner } from "../../src/logger.js";
import { MemoryRenderer } from "../../src/renderers.js";

function build(options = {}): { logger: Logger; renderer: MemoryRenderer } {
	const renderer = new MemoryRenderer();
	return { logger: new Logger(rawColors(), renderer, options), renderer };
}

describe("lumen > Logger levels", () => {
	it("gives every level its label and colour", () => {
		const { logger, renderer } = build();
		logger.success("a");
		logger.info("b");
		logger.warning("c");
		logger.error("d");
		expect(renderer.getLogs().map((entry) => entry.message)).toEqual([
			"[ green(success) ] a",
			"[ blue(info) ] b",
			"[ yellow(warn) ] c",
			"[ red(error) ] d",
		]);
	});

	it("sends alerts to stderr so data output stays pipeable", () => {
		// A warning inside `ream list --json | jq` is a broken pipeline.
		const { logger, renderer } = build();
		logger.success("ok");
		logger.warning("careful");
		logger.error("boom");
		expect(renderer.getLogs().map((entry) => entry.stream)).toEqual([
			"stdout",
			"stderr",
			"stderr",
		]);
	});

	it("accepts an Error where a message is expected", () => {
		const { logger, renderer } = build();
		logger.error(new Error("went wrong"));
		expect(renderer.getLogs()[0]?.message).toBe("[ red(error) ] went wrong");
	});

	it("prints the stack under a fatal, indented and dimmed", () => {
		const { logger, renderer } = build();
		const error = new Error("boom");
		error.stack = "Error: boom\n    at one\n    at two";
		logger.fatal(error);
		expect(renderer.getLogs()[0]?.message).toBe(
			"[ red(error) ] boom\n      dim(at one)\n      dim(at two)",
		);
	});
});

describe("lumen > Logger decorations", () => {
	it("dims the prefix and interpolates %time%", () => {
		const { logger, renderer } = build();
		logger.info("served", { prefix: "%time% ream" });
		const message = renderer.getLogs()[0]?.message ?? "";
		expect(message).toMatch(
			/^dim\(\[\d{4}-\d{2}-\d{2}T[\d:.]+Z ream]\) \[ blue\(info\) ] served$/,
		);
	});

	it("puts the suffix in parentheses after the message", () => {
		const { logger, renderer } = build();
		logger.success("wrote 3 files", { suffix: "resources/views" });
		expect(renderer.getLogs()[0]?.message).toBe(
			"[ green(success) ] wrote 3 files dim(yellow((resources/views)))",
		);
	});

	it("appends how long the work took", () => {
		const { logger, renderer } = build();
		logger.success("migrated", { startTime: Date.now() - 1500 });
		expect(renderer.getLogs()[0]?.message).toMatch(/dim\(\(1\.5\ds\)\)$/);
	});

	it("keeps a sticky prefix on every message until it changes", () => {
		const { logger, renderer } = build();
		logger.prefix("worker").info("a");
		logger.info("b");
		// A per-message prefix wins over the sticky one.
		logger.info("c", { prefix: "other" });
		expect(renderer.getLogs().map((entry) => entry.message)).toEqual([
			"dim([worker]) [ blue(info) ] a",
			"dim([worker]) [ blue(info) ] b",
			"dim([other]) [ blue(info) ] c",
		]);
	});

	it("dims the message and the label when asked", () => {
		const { logger, renderer } = build({ dim: true });
		logger.info("context");
		expect(renderer.getLogs()[0]?.message).toBe(
			"[ dim(blue(info)) ] dim(context)",
		);
	});

	it("hands a child the same colours and renderer", () => {
		const { logger, renderer } = build();
		logger.child({ dim: true }).info("quiet");
		expect(renderer.getLogs()[0]?.message).toBe(
			"[ dim(blue(info)) ] dim(quiet)",
		);
	});
});

describe("lumen > Logger.debug", () => {
	const before = process.env.DEBUG;
	afterEach(() => {
		if (before === undefined) delete process.env.DEBUG;
		else process.env.DEBUG = before;
	});

	it("stays silent unless DEBUG is set", () => {
		delete process.env.DEBUG;
		const { logger, renderer } = build();
		logger.debug("noisy");
		expect(renderer.getLogs()).toEqual([]);

		process.env.DEBUG = "ream:*";
		logger.debug("noisy");
		expect(renderer.getLogs()[0]?.message).toBe("[ cyan(debug) ] noisy");
	});
});

describe("lumen > Action", () => {
	it("aligns the three outcomes on the same column", () => {
		const renderer = new MemoryRenderer();
		const colors = rawColors();
		new Action("one", colors, renderer).succeeded();
		new Action("two", colors, renderer).skipped("already there");
		const messages = renderer.getLogs().map((entry) => entry.message);
		// `DONE:` is padded out to the width of `SKIPPED:`, so a column of
		// actions lines up.
		expect(messages[0]).toBe("green(DONE:   ) one");
		expect(messages[1]).toBe("cyan(SKIPPED:) two dim((already there))");
	});

	it("reports a failure on stderr, with the stack indented", () => {
		const renderer = new MemoryRenderer();
		const error = new Error("nope");
		error.stack = "Error: nope\n    at here";
		new Action("three", rawColors(), renderer).failed(error);
		const entry = renderer.getLogs()[0];
		expect(entry?.stream).toBe("stderr");
		expect(entry?.message).toBe(
			"red(FAILED: ) three\n      red(Error: nope)\n      red(at here)",
		);
	});

	it("appends the duration only when asked", () => {
		const renderer = new MemoryRenderer();
		new Action("four", rawColors(), renderer).displayDuration().succeeded();
		expect(renderer.getLogs()[0]?.message).toMatch(/ dim\(\(\d+ms\)\)$/);
	});
});

describe("lumen > Spinner", () => {
	it("prints once instead of animating when there is no terminal to animate", () => {
		// One line per frame would be noise in a log and unassertable here.
		const renderer = new MemoryRenderer();
		const spinner = new Spinner(() => "working", renderer).start();
		spinner.update("still working");
		spinner.stop();
		expect(renderer.getLogs().map((entry) => entry.message)).toEqual([
			"working",
			"still working",
		]);
	});

	it("is built by the logger with the await label", () => {
		const { logger, renderer } = build();
		logger.await("fetching", { suffix: "npm" }).start().stop();
		expect(renderer.getLogs()[0]?.message).toBe(
			"[ cyan(wait) ] fetching dim(yellow((npm)))",
		);
	});
});
