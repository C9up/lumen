/**
 * Where a line actually goes, and how long is "long".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "../../src/duration.js";
import { ConsoleRenderer } from "../../src/renderers.js";

describe("lumen > ConsoleRenderer", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("terminates every line, and sends errors to stderr", () => {
		const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const renderer = new ConsoleRenderer();

		renderer.log("hello");
		renderer.log("boom", "stderr");

		expect(out).toHaveBeenCalledWith("hello\n");
		expect(err).toHaveBeenCalledWith("boom\n");
	});

	it("rewinds the line instead of stacking one per frame", () => {
		const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const renderer = new ConsoleRenderer();

		renderer.logUpdate("working .");
		// Carriage return + erase-line: an animation must not turn a
		// transcript into a thousand lines.
		expect(out).toHaveBeenCalledWith("\r\u001B[2Kworking .");

		renderer.logUpdatePersist();
		expect(out).toHaveBeenLastCalledWith("\n");
	});

	it("keeps nothing — it went to the terminal", () => {
		const renderer = new ConsoleRenderer();
		renderer.flushLogs();
		expect(renderer.getLogs()).toEqual([]);
	});
});

describe("lumen > formatDuration", () => {
	it("picks the shortest form that is still precise", () => {
		expect(formatDuration(412)).toBe("412ms");
		expect(formatDuration(1500)).toBe("1.50s");
		expect(formatDuration(65_000)).toBe("1m 5s");
	});
});
