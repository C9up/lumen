/**
 * Where a line goes.
 *
 * Splitting this from the widgets is what makes the whole package testable:
 * the same `logger.success(…)` writes to the terminal in normal mode and into
 * an array in raw mode, and no widget knows which.
 */

import { stderr, stdout } from "node:process";

/** Which stream a line targets. Kept even in memory, so a test can assert it. */
export type Stream = "stdout" | "stderr";

export interface CapturedLog {
	message: string;
	stream: Stream;
}

export interface Renderer {
	log(message: string, stream?: Stream): void;
	/** Overwrite the line written last — for animations. */
	logUpdate(message: string): void;
	/** Stop overwriting: the last animated line becomes permanent. */
	logUpdatePersist(): void;
	getLogs(): CapturedLog[];
	flushLogs(): void;
}

/** Writes to the process streams. */
export class ConsoleRenderer implements Renderer {
	log(message: string, stream: Stream = "stdout"): void {
		const target = stream === "stderr" ? stderr : stdout;
		target.write(`${message}\n`);
	}

	logUpdate(message: string): void {
		// Carriage return + erase-line, rather than a line per frame: an
		// animation must not turn a transcript into a thousand lines.
		stdout.write(`\r\u001B[2K${message}`);
	}

	logUpdatePersist(): void {
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
