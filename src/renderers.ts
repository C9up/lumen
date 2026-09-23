/**
 * Where a line goes.
 *
 * Splitting this from the widgets is what makes the whole package testable:
 * the same `logger.success(…)` writes to the terminal in normal mode and into
 * an array in raw mode, and no widget knows which.
 */

import { stderr, stdout } from "node:process";
import { stripAnsi, supportsColor } from "./colors.js";

/** Which stream a line targets. Kept even in memory, so a test can assert it. */
export type Stream = "stdout" | "stderr";

export interface CapturedLog {
	message: string;
	stream: Stream;
}

export interface Renderer {
	log(message: string, stream?: Stream): void;
	/** The same, on stderr. Upstream keeps the two apart; so does this. */
	logError(message: string): void;
	/** Overwrite the line written last — for animations. */
	logUpdate(message: string): void;
	/** Stop overwriting: the last animated line becomes permanent. */
	logUpdatePersist(): void;
	getLogs(): CapturedLog[];
	flushLogs(): void;
}

/** Writes to the process streams. */
export class ConsoleRenderer implements Renderer {
	/**
	 * Asked ONCE per stream, not once per line — and per STREAM, because the
	 * two are redirected independently.
	 *
	 * NAMED DEVIATION — upstream decides colour from stdout alone, so a
	 * command run as `cmd 2> log` writes escape codes into that file: every
	 * warning and every error goes to stderr. Deciding per stream costs one
	 * boolean and closes it.
	 */
	readonly #colour: Record<Stream, boolean>;

	constructor() {
		this.#colour = {
			stdout: supportsColor(stdout),
			stderr: supportsColor(stderr),
		};
	}

	log(message: string, stream: Stream = "stdout"): void {
		const target = stream === "stderr" ? stderr : stdout;
		target.write(`${this.#colour[stream] ? message : stripAnsi(message)}\n`);
	}

	logError(message: string): void {
		this.log(message, "stderr");
	}

	logUpdate(message: string): void {
		// Carriage return + erase-line, rather than a line per frame: an
		// animation must not turn a transcript into a thousand lines.
		//
		// Only where there is a cursor to rewind, though. Written to a pipe or
		// a log file, those control codes are literal bytes in the output —
		// which is what the animation was trying to avoid.
		if (stdout.isTTY !== true) {
			this.log(message);
			return;
		}
		stdout.write(
			`\r\u001B[2K${this.#colour.stdout ? message : stripAnsi(message)}`,
		);
	}

	logUpdatePersist(): void {
		// Nothing to end when nothing was overwritten in place.
		if (stdout.isTTY !== true) return;
		stdout.write("\n");
	}

	/** Nothing is kept: it went to the terminal. */
	getLogs(): CapturedLog[] {
		return [];
	}

	flushLogs(): void {}
}

/** Keeps every line in memory instead of printing it. */
export class MemoryRenderer implements Renderer {
	readonly #logs: CapturedLog[] = [];

	log(message: string, stream: Stream = "stdout"): void {
		this.#logs.push({ message, stream });
	}

	logError(message: string): void {
		this.log(message, "stderr");
	}

	/**
	 * An animation frame is a line like any other here. There is no cursor to
	 * rewind, and a test that asserts on frames wants to see them.
	 */
	logUpdate(message: string): void {
		this.log(message);
	}

	logUpdatePersist(): void {}

	getLogs(): CapturedLog[] {
		return [...this.#logs];
	}

	flushLogs(): void {
		this.#logs.length = 0;
	}
}
