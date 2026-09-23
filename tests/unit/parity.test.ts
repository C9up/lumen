/**
 * The parts that exist so a caller can drive the output themselves.
 *
 * Everything here answers the same need: the widgets own the terminal by
 * default, and sometimes the caller does. `prepare*` builds a line without
 * writing it, `tap` takes over a spinner's frames, `onUpdate` and `tasks()`
 * expose a run as data, `dummy()` silences a logger whose output would land in
 * the middle of someone else's frame.
 */

import { describe, expect, it } from "vitest";
import { Box } from "../../src/box.js";
import { ansiColors, rawColors, silentColors } from "../../src/colors.js";
import { stringWidth } from "../../src/helpers.js";
import { Action, Logger, Spinner } from "../../src/logger.js";
import { MemoryRenderer } from "../../src/renderers.js";
import { InvalidColumnError, Table } from "../../src/table.js";
import { Tasks } from "../../src/tasks.js";

const renderer = (): MemoryRenderer => new MemoryRenderer();

describe("lumen > building a line without writing it", () => {
	it("prepares every level and writes nothing", () => {
		const target = renderer();
		const logger = new Logger(rawColors(), target);
		expect(logger.prepareSuccess("a")).toBe("[ green(success) ] a");
		expect(logger.prepareInfo("b")).toBe("[ blue(info) ] b");
		expect(logger.prepareWarning("c")).toBe("[ yellow(warn) ] c");
		expect(logger.prepareError(new Error("d"))).toBe("[ red(error) ] d");
		expect(logger.prepareDebug("e")).toBe("[ cyan(debug) ] e");
		// Nothing reached the renderer — that is the whole point.
		expect(target.getLogs()).toEqual([]);
	});

	it("keeps the stack on a prepared fatal", () => {
		const logger = new Logger(rawColors(), renderer());
		const error = new Error("boom");
		error.stack = "Error: boom\n    at one";
		expect(logger.prepareFatal(error)).toBe(
			"[ red(error) ] boom\n      dim(at one)",
		);
	});

	it("prepares the three action outcomes", () => {
		const target = renderer();
		const action = new Action("creating config/auth.ts", rawColors(), target);
		expect(action.prepareSucceeded()).toBe(
			"green(DONE:   ) creating config/auth.ts",
		);
		expect(action.prepareSkipped("already there")).toBe(
			"cyan(SKIPPED:) creating config/auth.ts dim((already there))",
		);
		expect(action.prepareFailed("nope")).toContain("red(FAILED: )");
		expect(target.getLogs()).toEqual([]);
	});
});

describe("lumen > Logger extras", () => {
	it("discards everything through dummy()", () => {
		// Inside a task callback the task widget owns the terminal; a stray line
		// lands in the middle of its redraw.
		const target = renderer();
		const logger = new Logger(rawColors(), target);
		const quiet = logger.dummy();
		quiet.success("swallowed");
		expect(target.getLogs()).toEqual([]);
		expect(quiet.getLogs()).toEqual(["[ green(success) ] swallowed"]);
	});

	it("writes a bare line to either stream, and drives the update line", () => {
		const target = renderer();
		const logger = new Logger(silentColors(), target);
		logger.log("data");
		logger.logError("problem");
		logger.logUpdate("working");
		logger.logUpdatePersist();
		expect(target.getLogs()).toEqual([
			{ message: "data", stream: "stdout" },
			{ message: "problem", stream: "stderr" },
			{ message: "working", stream: "stdout" },
		]);
	});
});

describe("lumen > Spinner.tap", () => {
	it("hands the frames to the caller instead of the renderer", () => {
		const target = renderer();
		const lines: string[] = [];
		const spinner = new Spinner(() => "working", target).tap((line) => {
			lines.push(line);
		});
		spinner.start();
		spinner.stop();
		// The caller got the frame; the renderer was not touched.
		expect(lines).toEqual(["working .  "]);
		expect(target.getLogs()).toEqual([]);
	});
});

describe("lumen > Table.columnWidths", () => {
	it("uses the given widths instead of measuring", () => {
		// The width is the whole column, padding included — what `colWidths`
		// means upstream.
		const table = new Table(silentColors(), renderer());
		table.columnWidths([10]).row(["a", "b"]).row(["cc", "d"]);
		expect(table.prepare()[0]).toBe("┌──────────┬─────┐");
	});

	it("wraps to a width smaller than the content rather than widening back", () => {
		// The caller asked for a shape; silently undoing it defeats asking.
		const table = new Table(silentColors(), renderer());
		table.columnWidths([7]).row(["a-long-cell", "b"]);
		const lines = table.prepare();
		expect(lines[0]).toBe("┌───────┬─────┐");
		// The cell did not widen the column; it wrapped inside it.
		expect(lines.length).toBeGreaterThan(3);
	});

	it("refuses a width that is not a column count", () => {
		const table = new Table(silentColors(), renderer());
		expect(() => table.columnWidths([-1])).toThrow(InvalidColumnError);
	});

	it("takes fullWidth(false) back", () => {
		const table = new Table(silentColors(), renderer());
		table.row(["a", "b"]).fullWidth().fullWidth(false);
		// Two columns of one character, four of padding each, three borders.
		expect(stringWidth(table.prepare()[0] ?? "")).toBe(13);
	});
});

describe("lumen > swapping colours and renderer on a widget", () => {
	it("lets a widget built elsewhere be re-pointed", () => {
		const target = renderer();
		const box = new Box(ansiColors(), renderer())
			.useColors(rawColors())
			.useRenderer(target)
			.add("x");
		box.render();
		expect(box.getColors()).not.toBe(ansiColors());
		expect(box.getRenderer()).toBe(target);
		expect(target.getLogs()[0]?.message).toContain("dim(╭)");
	});
});

describe("lumen > a run as data", () => {
	it("exposes every task, its state and its duration", async () => {
		const tasks = new Tasks(rawColors(), renderer());
		tasks
			.add("first", async (task) => task.markAsSucceeded("done"))
			.add("second", async () => undefined);

		// Before the run: declared, idle, nothing measured.
		expect(tasks.tasks().map((task) => task.getState())).toEqual([
			"idle",
			"idle",
		]);
		expect(tasks.getState()).toBe("idle");
		expect(tasks.tasks()[0]?.getDuration()).toBeNull();

		const outcomes = await tasks.run();

		expect(tasks.getState()).toBe("succeeded");
		expect(tasks.tasks().map((task) => task.getState())).toEqual([
			"succeeded",
			"succeeded",
		]);
		expect(outcomes[0]?.duration).toMatch(/^\d+ms$/);
		expect(tasks.tasks()[0]?.getSuccessMessage()).toBe("done");
		expect(tasks.tasks()[0]?.getLastLoggedLine()).toContain("green(✔) first");
	});

	it("reports a failure through markAsFailed and stops", async () => {
		const tasks = new Tasks(rawColors(), renderer());
		let ranSecond = false;
		await tasks
			.add("first", async (task) => task.markAsFailed(new Error("no disk")))
			.add("second", async () => {
				ranSecond = true;
			})
			.run();

		expect(ranSecond).toBe(false);
		expect(tasks.getState()).toBe("failed");
		expect(tasks.tasks()[0]?.getError()).toBeInstanceOf(Error);
		// Declared but never reached: still idle, not silently "succeeded".
		expect(tasks.tasks()[1]?.getState()).toBe("idle");
	});

	it("notifies a listener as the task moves", async () => {
		// The seam for a renderer of your own.
		const seen: Array<[string, string | null]> = [];
		const tasks = new Tasks(rawColors(), renderer());
		tasks.add("sync", async (task) => {
			task.update("42 files");
			return "done";
		});
		tasks.tasks()[0]?.onUpdate((task) => {
			seen.push([task.getState(), task.getSuccessMessage()]);
		});

		await tasks.run();

		expect(seen).toEqual([
			["running", null],
			["running", "42 files"],
			["succeeded", "done"],
		]);
	});

	it("adds a step only when the condition says so", async () => {
		const tasks = new Tasks(rawColors(), renderer());
		tasks
			.addIf(true, "kept", async () => undefined)
			.addIf(false, "dropped", async () => undefined)
			.addUnless(true, "also dropped", async () => undefined)
			.addUnless(false, "also kept", async () => undefined);

		expect(tasks.tasks().map((task) => task.title)).toEqual([
			"kept",
			"also kept",
		]);
	});
});

describe("lumen > the switches upstream exposes", () => {
	it("builds a message and writes nothing when it is silent", async () => {
		// A `--quiet` flag threaded through, rather than a second logger.
		const { Logger } = await import("../../src/logger.js");
		const target = renderer();
		const logger = new Logger(rawColors(), target);
		logger.success("a", { silent: true });
		logger.warning("b", { silent: true });
		logger.error("c", { silent: true });
		logger.await("d", { silent: true }).start().stop();
		expect(target.getLogs()).toEqual([]);

		logger.success("visible");
		expect(target.getLogs()).toHaveLength(1);
	});

	it("drops the task glyphs when icons are off", async () => {
		const { Tasks } = await import("../../src/tasks.js");
		const target = renderer();
		await new Tasks(rawColors(), target, { icons: false })
			.add("one", async () => "done")
			.run();
		const line = target.getLogs()[0]?.message ?? "";
		expect(line).not.toContain("✔");
		expect(line.startsWith("one ")).toBe(true);
	});

	it("drops the instructions pointer when icons are off", () => {
		const plain = new Box(rawColors(), renderer(), {
			pointer: true,
			icons: false,
		})
			.add("cd my-app")
			.prepare()
			.join("\n");
		expect(plain).not.toContain("❯");
		expect(plain).toContain("cd my-app");
	});
});
