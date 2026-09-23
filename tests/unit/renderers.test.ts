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

	it("rewinds the line, but only where there is a cursor to rewind", () => {
		const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const wasTTY = process.stdout.isTTY;
		try {
			Object.defineProperty(process.stdout, "isTTY", {
				value: true,
				configurable: true,
			});
			const renderer = new ConsoleRenderer();

			renderer.logUpdate("working .");
			// Carriage return + erase-line: an animation must not turn a
			// transcript into a thousand lines.
			expect(out).toHaveBeenCalledWith("\r\u001B[2Kworking .");

			renderer.logUpdatePersist();
			expect(out).toHaveBeenLastCalledWith("\n");
		} finally {
			Object.defineProperty(process.stdout, "isTTY", {
				value: wasTTY,
				configurable: true,
			});
		}
	});

	it("writes a plain line instead, when the output is not a terminal", () => {
		// Those control codes are literal bytes in a pipe or a log file —
		// which is what the animation was trying to avoid in the first place.
		const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const renderer = new ConsoleRenderer();

		renderer.logUpdate("working .");
		renderer.logUpdatePersist();

		expect(out).toHaveBeenCalledTimes(1);
		expect(out).toHaveBeenCalledWith("working .\n");
	});

	it("strips colour from a stream that cannot show it", () => {
		// A command run as `cmd 2> log` sends every warning and error into
		// that file; upstream decides from stdout alone and writes escape
		// codes into it.
		//
		// Pinned through NO_COLOR rather than through the streams, so the
		// answer is the same on a developer's terminal and on a runner — the
		// CI rule would otherwise turn colour back on here.
		const previous = process.env.NO_COLOR;
		const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		try {
			process.env.NO_COLOR = "1";
			// Decided at construction, which is why it is built inside.
			new ConsoleRenderer().log("\u001B[31mboom\u001B[39m", "stderr");
			expect(err).toHaveBeenCalledWith("boom\n");
		} finally {
			if (previous === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = previous;
		}
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
