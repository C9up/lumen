/**
 * The UI and its modes.
 *
 * One object decides, once, whether output carries escape codes, goes to a
 * terminal, or is captured. Everything downstream writes the same code — which
 * is what keeps environment checks out of rendering.
 */

import { describe, expect, it } from "vitest";
import { MemoryRenderer } from "../../src/renderers.js";
import { lumen, Ui } from "../../src/ui.js";

describe("lumen > Ui modes", () => {
	it("captures instead of printing in raw mode, and spells colours out", () => {
		const ui = new Ui("raw");
		ui.logger.success("created");
		expect(ui.getLogs()).toEqual(["[ green(success) ] created"]);
		expect(ui.getCapturedLogs()).toEqual([
			{ message: "[ green(success) ] created", stream: "stdout" },
		]);
	});

	it("drops colour but still writes in silent mode", () => {
		const ui = new Ui("silent").useRenderer(new MemoryRenderer());
		ui.logger.warning("careful");
		expect(ui.getLogs()).toEqual(["[ warn ] careful"]);
	});

	it("clears what was captured when switching, so cases do not bleed", () => {
		const ui = new Ui("raw");
		ui.logger.info("from the first case");
		ui.switchMode("raw");
		expect(ui.getLogs()).toEqual([]);
	});

	it("takes the logger with it when the mode changes", () => {
		const ui = new Ui("normal");
		ui.switchMode("raw");
		ui.logger.info("after");
		// The logger was built before the switch and still lands in the new
		// renderer with the new colours.
		expect(ui.getLogs()).toEqual(["[ blue(info) ] after"]);
	});

	it("exposes the last table's data, head apart from the rows", () => {
		const ui = new Ui("raw");
		const table = ui.table();
		table.head(["Name"]).row(["users"]).render();
		expect(ui.getTableHead()).toEqual(["Name"]);
		expect(ui.getTableRows()).toEqual([["users"]]);

		// A second table replaces the first: an assertion is about what was
		// just rendered.
		ui.table().row(["other"]).render();
		expect(ui.getTableRows()).toEqual([["other"]]);
	});

	it("answers with nothing when no table was built", () => {
		const ui = new Ui("raw");
		expect(ui.getTableRows()).toEqual([]);
		expect(ui.getTableHead()).toEqual([]);
	});

	it("writes a bare line through the same sink as the widgets", () => {
		const ui = new Ui("raw");
		ui.write("plain", "stderr");
		expect(ui.getCapturedLogs()).toEqual([
			{ message: "plain", stream: "stderr" },
		]);
		ui.flushLogs();
		expect(ui.getLogs()).toEqual([]);
	});

	it("hands the widgets the current colours", () => {
		const ui = new Ui("raw");
		expect(ui.sticker().add("x").prepare()[0]).toContain("dim(╭)");
		expect(ui.steps().add("x").prepare()[0]).toBe("cyan(1.) bold(x)");
	});
});

describe("lumen > factory", () => {
	it("detects the mode when none is given", () => {
		// The test process is not a TTY, so colour would be noise in the
		// transcript.
		expect(lumen().mode).toBe("silent");
	});

	it("takes an explicit mode over the detection", () => {
		expect(lumen({ mode: "raw" }).mode).toBe("raw");
		expect(lumen({ mode: "normal" }).mode).toBe("normal");
	});

	it("passes the logger options through", () => {
		const ui = lumen({ mode: "raw", dim: true });
		ui.logger.info("context");
		expect(ui.getLogs()).toEqual(["[ dim(blue(info)) ] dim(context)"]);
	});
});
