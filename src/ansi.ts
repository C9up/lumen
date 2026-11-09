/**
 * Escape sequences: telling the colour lumen adds apart from the control
 * sequences untrusted text could smuggle in.
 *
 * Every widget prints DATA — a file name, a database value, an error message.
 * Written verbatim, an OSC 52 in it writes the operator's clipboard, an OSC 0
 * retitles the window, a CSI 2J wipes the screen, and a CR or LF rewinds over
 * the `[ error ]` label or forges a `[ success ]` line under it.
 *
 * NAMED DEVIATION — upstream prints every widget's text as given. Here each
 * widget passes caller text through {@link sanitize} before adding its own
 * styling, and `logger.log()` / `ui.write()` stay the raw escape hatch.
 */

/** One SGR (colour/style) sequence: `ESC [ params m`. Nothing else is kept. */
const SGR = String.raw`\u001B\[([0-9;:]*)m`;

/**
 * Every code point that acts on a terminal instead of drawing: C0 but TAB
 * (and LF, in the variant that keeps lines), DEL, C1 — whose U+009B and
 * U+009D are CSI and OSC on terminals that honour 8-bit controls — the
 * Unicode line and paragraph separators, and the bidirectional overrides that
 * make a name read differently from what it is.
 */
const CONTROLS = String.raw`\u0000-\u0008\u000B-\u001F\u007F-\u009F  ‪-‮⁦-⁩`;

const UNSAFE = new RegExp(`${SGR}|[\\u000A${CONTROLS}]`, "g");
const UNSAFE_BUT_NEWLINE = new RegExp(`${SGR}|[${CONTROLS}]`, "g");

export interface SanitizeOptions {
	/**
	 * Leave `\n` alone, for a widget that splits its text into lines itself —
	 * a table cell, a step's content. Everywhere else a newline would forge a
	 * line the reader attributes to lumen, so it is shown instead.
	 */
	keepNewlines?: boolean;
}

/**
 * Make text safe to print: every control is rendered visibly (`\x1b`,
 * `\x0d`, ` `), so nothing in it can act on the terminal, while the
 * colour a caller put on it on purpose — `colors.green(cell)` — survives.
 *
 * Escaped rather than rejected: this is text a human reads, not a format a
 * parser splits on, so showing the byte keeps the information and refusing it
 * would turn a strange file name into a crashed command. The backslash itself
 * is left alone for the same reason — nothing parses the output back, and a
 * Windows path must not double every separator.
 *
 * A style the text opens and never closes is closed at its end: a value
 * holding `ESC[8m` (conceal) would otherwise hide every line printed after it.
 *
 * Linear: one pass, one quantifier that cannot backtrack.
 */
export function sanitize(text: string, options: SanitizeOptions = {}): string {
	const styles = new SgrStyles();
	const pattern = options.keepNewlines === true ? UNSAFE_BUT_NEWLINE : UNSAFE;
	const out = text.replace(pattern, (match) => {
		if (match.length > 1) {
			styles.apply(match.slice(2, -1));
			return match;
		}
		return visible(match.charCodeAt(0));
	});
	return `${out}${styles.close()}`;
}

function visible(code: number): string {
	return code < 0x100
		? `\\x${code.toString(16).padStart(2, "0")}`
		: `\\u${code.toString(16).padStart(4, "0")}`;
}

/** The code that ends each style, by the code that starts it. */
const CLOSERS = new Map<number, number>([
	[1, 22],
	[2, 22],
	[3, 23],
	[4, 24],
	[21, 24],
	[5, 25],
	[6, 25],
	[7, 27],
	[8, 28],
	[9, 29],
	[53, 55],
]);
for (let code = 30; code <= 37; code += 1) CLOSERS.set(code, 39);
for (let code = 90; code <= 97; code += 1) CLOSERS.set(code, 39);
for (let code = 40; code <= 47; code += 1) CLOSERS.set(code, 49);
for (let code = 100; code <= 107; code += 1) CLOSERS.set(code, 49);

/** Codes that end a style rather than start one. */
const ENDINGS = new Set([22, 23, 24, 25, 27, 28, 29, 39, 49, 55, 59]);

/** The extended colours, which carry their value in the next parameters. */
const EXTENDED = new Map([
	[38, 39],
	[48, 49],
	[58, 59],
]);

/**
 * The styles currently open, following the SGR sequences of a text.
 *
 * Keyed by the sequence that closes a style, so a second colour replaces the
 * first instead of stacking — the terminal has one foreground, not two. A code
 * this table does not know is closed with a full reset: over-closing is
 * cosmetic, under-closing is how a style leaks into the next line.
 */
export class SgrStyles {
	readonly #open = new Map<string, string>();

	/** Track one sequence, given its parameters (`1;31` for `ESC[1;31m`). */
	apply(params: string): void {
		const parts = params === "" ? ["0"] : params.split(";");
		for (let index = 0; index < parts.length; index += 1) {
			const part = parts[index] ?? "";
			const code = Number.parseInt(part.split(":")[0] ?? "", 10);
			if (Number.isNaN(code) || code === 0) {
				this.#open.clear();
				continue;
			}
			const extendedClose = EXTENDED.get(code);
			if (extendedClose !== undefined) {
				// `38;5;n` and `38;2;r;g;b` spread over the next parameters;
				// `38:5:n` holds them in one.
				let taken = 0;
				if (!part.includes(":")) {
					const mode = parts[index + 1];
					taken = mode === "5" ? 2 : mode === "2" ? 4 : 0;
				}
				const sequence = parts.slice(index, index + 1 + taken).join(";");
				this.#set(extendedClose, sequence);
				index += taken;
				continue;
			}
			if (ENDINGS.has(code)) {
				this.#open.delete(`\u001B[${code}m`);
				continue;
			}
			this.#set(CLOSERS.get(code) ?? 0, part);
		}
	}

	/** The sequence that ends every open style, innermost first. */
	close(): string {
		return [...this.#open.keys()].reverse().join("");
	}

	/** The sequence that starts every open style again. */
	reopen(): string {
		return [...this.#open.values()].join("");
	}

	#set(closeCode: number, params: string): void {
		const key = `\u001B[${closeCode}m`;
		// Re-inserted so the close order follows the open order.
		this.#open.delete(key);
		this.#open.set(key, `\u001B[${params}m`);
	}
}

const SGR_SEQUENCE = new RegExp(SGR, "g");

/**
 * Make each line close the styles it opened, and reopen on the next line the
 * ones still running.
 *
 * A coloured cell wrapped over two lines opens its colour on the first and
 * closes it on the second; printed as is, the colour runs into the border and
 * the next cell of the first line. Each line carries its own styles instead —
 * what cli-table3 does when it wraps.
 */
export function containStyles(lines: readonly string[]): string[] {
	const styles = new SgrStyles();
	return lines.map((line) => {
		const start = styles.reopen();
		for (const match of line.matchAll(SGR_SEQUENCE)) {
			styles.apply(match[1] ?? "");
		}
		return `${start}${line}${styles.close()}`;
	});
}

/*
 * The escape-sequence grammar, ported from ansi-regex 6.6.0 (what upstream's
 * strip-ansi and string-width use). Every alternative starts at an introducer
 * and every payload stops at the next one, so a string of unterminated
 * introducers is scanned once, not once per introducer.
 */
// ESC followed by a backslash, or the 8-bit ST.
const ST = String.raw`(?:\u001B\\|\u009C)`;
const STRING_CONTROLS = String.raw`\u0018\u001A\u001B\u0080-\u009F`;
const OSC = String.raw`(?:\u001B\]|\u009D)[^\u0007${STRING_CONTROLS}]*(?:\u0007|${ST})`;
const CONTROL_STRING = String.raw`(?:\u001B[PX^_k]|[\u0090\u0098\u009E\u009F])[^${STRING_CONTROLS}]*${ST}`;
const LINUX_PALETTE = String.raw`\u001B\](?:P[\dA-Fa-f]{7}|R)(?:\u0007|${ST})?`;
const CSI = String.raw`(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]`;
const ESCAPE = String.raw`\u001B(?:[ -/]+[0-~]|[\dA-PR-TZcf-oq-uy=><~|}])`;
const ANSI = `${LINUX_PALETTE}|${OSC}|${CONTROL_STRING}|${CSI}|${ESCAPE}`;

const ANSI_GLOBAL = new RegExp(ANSI, "g");

/**
 * Drop every escape sequence, leaving the visible text.
 *
 * Needed wherever a width is measured: a cell coloured green, or a hyperlink,
 * carries codes that occupy no columns, and counting them shifts every column
 * after it. Colour alone is not enough — an OSC 8 link counted as visible text
 * pushed a table border twenty-four columns right.
 */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_GLOBAL, "");
}

/** A run of text, or one escape sequence. */
export interface AnsiToken {
	escape: boolean;
	text: string;
}

/** The text cut into escape sequences and the runs between them. */
export function ansiTokens(text: string): AnsiToken[] {
	const tokens: AnsiToken[] = [];
	let last = 0;
	for (const match of text.matchAll(ANSI_GLOBAL)) {
		const at = match.index;
		if (at > last) tokens.push({ escape: false, text: text.slice(last, at) });
		tokens.push({ escape: true, text: match[0] });
		last = at + match[0].length;
	}
	if (last < text.length)
		tokens.push({ escape: false, text: text.slice(last) });
	return tokens;
}

/** The parameters of an SGR sequence, or undefined for anything else. */
export function sgrParams(sequence: string): string | undefined {
	if (!sequence.startsWith("\u001B[") || !sequence.endsWith("m")) {
		return undefined;
	}
	const params = sequence.slice(2, -1);
	return /^[0-9;:]*$/.test(params) ? params : undefined;
}

/**
 * An OSC 8 hyperlink: the sequence that closes it when it opens one, an empty
 * string when it IS the closing one, undefined when it is not a hyperlink.
 */
export function hyperlinkCloser(sequence: string): string | undefined {
	const body = sequence.startsWith("\u001B]")
		? sequence.slice(2)
		: sequence.startsWith("\u009D")
			? sequence.slice(1)
			: undefined;
	if (body === undefined || !body.startsWith("8;")) return undefined;
	const terminator = body.endsWith("\u0007")
		? "\u0007"
		: body.endsWith("\u009C")
			? "\u009C"
			: "\u001B\\";
	const url = body.slice(0, body.length - terminator.length).split(";")[2];
	return url === undefined || url === "" ? "" : `\u001B]8;;${terminator}`;
}
