/**
 * The logger's vocabulary.
 *
 * The labels and their colours are a contract across every package: `[ warn ]`
 * must look the same whether it comes from a migration, the dev server or an
 * application command. Asserted in raw mode, where a colour reads as
 * `yellow(warn)` instead of a soup of escape codes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { rawColors } from "../../src/colors.js";
import { Action, Logger, Spinner } from "../../src/logger.js";
import { ConsoleRenderer, MemoryRenderer } from "../../src/renderers.js";

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

	it("takes an hrtime tuple, which is what upstream's example passes", () => {
		// Subtracted from a number, a tuple gives NaN — and the line reads
		// `(NaNm NaNs)`, which points at nothing.
		const { logger, renderer } = build();
		logger.success("migrated", { startTime: process.hrtime() });
		expect(renderer.getLogs()[0]?.message).toMatch(/dim\(\(\d+ms\)\)$/);
	});

	it("takes an hrtime bigint too", () => {
		const { logger, renderer } = build();
		logger.success("migrated", { startTime: process.hrtime.bigint() });
		expect(renderer.getLogs()[0]?.message).toMatch(/dim\(\(\d+ms\)\)$/);
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

	it("always logs, as upstream does — the command gates it on its own flag", () => {
		// A command ported from upstream calls debug() behind its own
		// `--verbose`; an extra DEBUG gate made that output vanish.
		delete process.env.DEBUG;
		const { logger, renderer } = build();
		logger.debug("detail");
		expect(renderer.getLogs()).toEqual([
			{ message: "[ cyan(debug) ] detail", stream: "stdout" },
		]);
	});

	it("is silenced per call like every other level", () => {
		const { logger, renderer } = build();
		logger.debug("detail", { silent: true });
		expect(renderer.getLogs()).toEqual([]);
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

describe("lumen > Spinner state", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("animates once however many times start() is called", () => {
		// A second start() used to create a second interval and keep only the
		// last handle: stop() cleared that one, the first redrew forever.
		vi.useFakeTimers();
		const frames: string[] = [];
		const spinner = new Spinner(() => "installing", new MemoryRenderer()).tap(
			(line) => frames.push(line),
		);
		spinner.start();
		spinner.start();
		vi.advanceTimersByTime(Spinner.INTERVAL * 3);
		expect(frames).toHaveLength(4);
		spinner.stop();
		const atStop = frames.length;
		vi.advanceTimersByTime(Spinner.INTERVAL * 10);
		expect(frames).toHaveLength(atStop);
	});

	it("draws nothing on update() once stopped, or before it started", () => {
		vi.useFakeTimers();
		const frames: string[] = [];
		const spinner = new Spinner(() => "a", new MemoryRenderer()).tap((line) =>
			frames.push(line),
		);
		spinner.update("too early");
		expect(frames).toEqual([]);
		spinner.start();
		spinner.stop();
		spinner.update("too late");
		vi.advanceTimersByTime(Spinner.INTERVAL * 5);
		expect(frames).toEqual(["a .  "]);
	});

	it("does the same without a terminal to animate", () => {
		const renderer = new MemoryRenderer();
		const spinner = new Spinner(() => "a", renderer);
		spinner.update("too early");
		spinner.start();
		spinner.start();
		spinner.stop();
		spinner.update("too late");
		expect(renderer.getLogs().map((entry) => entry.message)).toEqual(["a"]);
	});

	it("settles on the full frame when it stops on a terminal", () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		class Recording extends ConsoleRenderer {
			override logUpdate(message: string): void {
				calls.push(`update ${message}`);
			}
			override logUpdatePersist(): void {
				calls.push("persist");
			}
		}
		const wasTTY = process.stdout.isTTY;
		process.stdout.isTTY = true;
		try {
			const spinner = new Spinner(() => "a", new Recording()).start();
			vi.advanceTimersByTime(Spinner.INTERVAL);
			spinner.stop();
		} finally {
			process.stdout.isTTY = wasTTY;
		}
		expect(calls).toEqual([
			"update a .  ",
			"update a .. ",
			"update a ...",
			"persist",
		]);
	});

	it("cannot be restarted once stopped", () => {
		vi.useFakeTimers();
		const frames: string[] = [];
		const spinner = new Spinner(() => "a", new MemoryRenderer()).tap((line) =>
			frames.push(line),
		);
		spinner.start();
		spinner.stop();
		spinner.start();
		vi.advanceTimersByTime(Spinner.INTERVAL * 5);
		expect(frames).toEqual(["a .  "]);
	});
});

describe("lumen > the silent option", () => {
	it("silences every level, fatal included", () => {
		// A `--quiet` flag threaded through `silent` must not still print a
		// fatal message and its whole stack.
		const { logger, renderer } = build();
		const options = { silent: true };
		logger.success("a", options);
		logger.info("b", options);
		logger.warning("c", options);
		logger.error("d", options);
		logger.error(new Error("e"), options);
		logger.fatal("f", options);
		logger.fatal(new Error("g"), options);
		logger.debug("h", options);
		logger.await("i", options).start().stop();
		expect(renderer.getLogs()).toEqual([]);
	});
});
