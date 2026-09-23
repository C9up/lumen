/**
 * Table, Box, Steps and Tasks.
 *
 * What is under test is the layout — the part a human notices immediately and
 * no type system catches.
 */

import { describe, expect, it } from "vitest";
import { Box } from "../../src/box.js";
import { ansiColors, rawColors, silentColors } from "../../src/colors.js";
import { stringWidth } from "../../src/helpers.js";
import { iconsFor } from "../../src/icons.js";
import { MemoryRenderer } from "../../src/renderers.js";
import { Steps } from "../../src/steps.js";
import { InvalidColumnError, Table } from "../../src/table.js";
import { Tasks } from "../../src/tasks.js";

const renderer = (): MemoryRenderer => new MemoryRenderer();

describe("lumen > Table", () => {
	it("aligns columns on the visible width, colour included", () => {
		const colors = ansiColors();
		const table = new Table(colors, renderer());
		table.row([colors.green("ok"), "short"]).row(["longer", "x"]);
		const [first, second] = table.prepare();
		// Both rows put the second column at the same visible offset, although
		// the first cell of row one carries escape codes.
		expect(stringWidth(first?.split("short")[0] ?? "")).toBe(
			stringWidth(second?.split("x")[0] ?? ""),
		);
	});

	it("aligns a CJK cell on its real width", () => {
		const table = new Table(silentColors(), renderer());
		table.row(["日本", "a"]).row(["ab", "b"]);
		const [wide, narrow] = table.prepare();
		expect(stringWidth(wide ?? "")).toBe(stringWidth(narrow ?? ""));
	});

	it("draws a rule under the head", () => {
		const table = new Table(silentColors(), renderer());
		table.head(["Name", "Batch"]).row(["users", "1"]);
		expect(table.prepare()).toEqual([
			"Name   Batch",
			"─────  ─────",
			"users  1",
		]);
	});

	it("honours per-cell alignment", () => {
		const table = new Table(silentColors(), renderer());
		table.row([{ content: "7", hAlign: "right" }, "x"]).row(["1000", "y"]);
		expect(table.prepare()[0]).toBe("   7  x");
	});

	it("hands back the rows unpadded, for assertions", () => {
		const table = new Table(rawColors(), renderer());
		table.head(["A"]).row(["b"]);
		table.render();
		// Data, not layout: a test must not break because a column grew.
		expect(table.getHead()).toEqual(["A"]);
		expect(table.getRows()).toEqual([["b"]]);
	});

	it("refuses to stretch a column the table does not have", () => {
		const table = new Table(silentColors(), renderer());
		table.row(["a", "b"]).fullWidth().fluidColumnIndex(5);
		// Silently doing nothing is the failure noticed three screens later.
		expect(() => table.prepare()).toThrow(InvalidColumnError);
		expect(() => table.fluidColumnIndex(-1)).toThrow(/not a column position/);
	});

	it("renders nothing at all when it has no rows", () => {
		const target = renderer();
		new Table(silentColors(), target).render();
		expect(target.getLogs()).toEqual([]);
	});
});

describe("lumen > Box", () => {
	it("draws a border wide enough for its widest line", () => {
		const box = new Box(silentColors(), renderer());
		box.add("short").add("a much longer line");
		const lines = box.prepare();
		const widths = new Set(lines.map(stringWidth));
		// Every line of a box is the same width — that is what makes it a box.
		expect(widths.size).toBe(1);
		expect(lines[0]?.startsWith("╭")).toBe(true);
		expect(lines.at(-1)?.startsWith("╰")).toBe(true);
	});

	it("marks each line with a pointer only in instructions mode", () => {
		const plain = new Box(rawColors(), renderer()).add("do this").prepare();
		const pointed = new Box(rawColors(), renderer(), { pointer: true })
			.add("do this")
			.add("")
			.prepare();
		expect(plain.some((line) => line.includes("dim(❯)"))).toBe(false);
		expect(pointed.some((line) => line.includes("dim(❯) do this"))).toBe(true);
		// An empty line stays empty: a pointer on nothing is a stray glyph.
		expect(pointed.filter((line) => line.includes("❯"))).toHaveLength(1);
	});

	it("lets the caller paint the border, which is how an error box goes red", () => {
		const box = new Box(rawColors(), renderer())
			.drawBorder((character, colors) => colors.red(character))
			.add("Command not found");
		expect(box.prepare()[0]).toContain("red(╭)");
	});

	it("puts the heading above the body", () => {
		const box = new Box(rawColors(), renderer())
			.heading("Next steps")
			.add("run it");
		const lines = box.prepare().join("\n");
		expect(lines.indexOf("bold(Next steps)")).toBeLessThan(
			lines.indexOf("run it"),
		);
	});

	it("renders nothing when empty", () => {
		expect(new Box(silentColors(), renderer()).prepare()).toEqual([]);
	});
});

describe("lumen > Steps", () => {
	it("numbers the steps and indents their content", () => {
		const steps = new Steps(rawColors(), renderer());
		steps.add("Install", "pnpm install").add("Run");
		expect(steps.prepare()).toEqual([
			"cyan(1.) bold(Install)",
			"   pnpm install",
			"",
			"cyan(2.) bold(Run)",
		]);
	});
});

describe("lumen > Tasks", () => {
	it("reports each task and returns the outcomes in order", async () => {
		const target = renderer();
		const outcomes = await new Tasks(rawColors(), target)
			.add("first", async () => "done")
			.add("second", async () => undefined)
			.run();

		expect(outcomes.map((outcome) => [outcome.title, outcome.state])).toEqual([
			["first", "succeeded"],
			["second", "succeeded"],
		]);
		expect(target.getLogs()[0]?.message).toContain("green(✔) first dim(done)");
	});

	it("stops at the first failure — the rest usually depend on it", async () => {
		const target = renderer();
		let ranThird = false;
		const outcomes = await new Tasks(rawColors(), target)
			.add("first", async () => "ok")
			.add("second", async (task) => task.error("no disk space"))
			.add("third", async () => {
				ranThird = true;
			})
			.run();

		expect(ranThird).toBe(false);
		expect(outcomes.map((outcome) => outcome.state)).toEqual([
			"succeeded",
			"failed",
		]);
		expect(target.getLogs().at(-1)?.stream).toBe("stderr");
	});

	it("treats a thrown error the same as a reported one", async () => {
		const outcomes = await new Tasks(rawColors(), renderer())
			.add("boom", async () => {
				throw new Error("unhandled");
			})
			.run();
		expect(outcomes[0]?.state).toBe("failed");
		expect(outcomes[0]?.error?.message).toBe("unhandled");
	});

	it("keeps only the last progress message unless verbose", async () => {
		const quiet = renderer();
		await new Tasks(rawColors(), quiet)
			.add("download", async (task) => {
				task.update("10%");
				task.update("100%");
			})
			.run();
		// One line, not one per percent.
		expect(quiet.getLogs()).toHaveLength(1);
		expect(quiet.getLogs()[0]?.message).toContain("dim(100%)");

		const loud = renderer();
		await new Tasks(rawColors(), loud, { verbose: true })
			.add("download", async (task) => {
				task.update("10%");
				task.update("100%");
			})
			.run();
		expect(loud.getLogs()).toHaveLength(3);
	});
});

describe("lumen > icons", () => {
	it("degrades on a console that would draw a box instead of a glyph", () => {
		expect(iconsFor("linux", {}).tick).toBe("✔");
		expect(iconsFor("win32", {}).tick).toBe("√");
		// Windows Terminal handles the full set.
		expect(iconsFor("win32", { WT_SESSION: "1" }).tick).toBe("✔");
	});
});
