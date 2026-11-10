/**
 * Colours, as an interface with three implementations.
 *
 * The split is the point. A terminal that understands escape codes gets them;
 * one that does not gets the text untouched; a TEST gets the transformations
 * spelled out — `dim(yellow(2 files))` — so an expected line stays a string a
 * human can read and diff, instead of a soup of escape sequences.
 *
 * Deciding WHICH of the three is a separate question, answered once by
 * {@link supportsColor} when the UI is built, never per message.
 */

import { platform, stdout } from "node:process";

export { stripAnsi } from "./ansi.js";

/**
 * Every style, with the code that opens it and the one that closes it.
 *
 * Both halves matter: closing with a blanket reset (`\u001B[0m`) drops the
 * styles a nested call was still holding, so `red("a " + dim("b") + " c")`
 * loses its red after the dim. Closing `dim` with `22` leaves the red standing.
 */
const STYLES = {
	reset: [0, 0],
	bold: [1, 22],
	dim: [2, 22],
	italic: [3, 23],
	underline: [4, 24],
	inverse: [7, 27],
	hidden: [8, 28],
	strikethrough: [9, 29],
	black: [30, 39],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	blue: [34, 39],
	magenta: [35, 39],
	cyan: [36, 39],
	white: [37, 39],
	gray: [90, 39],
	grey: [90, 39],
	bgBlack: [40, 49],
	bgRed: [41, 49],
	bgGreen: [42, 49],
	bgYellow: [43, 49],
	bgBlue: [44, 49],
	bgMagenta: [45, 49],
	bgCyan: [46, 49],
	bgWhite: [47, 49],
} as const satisfies Record<string, readonly [number, number]>;

export type StyleName = keyof typeof STYLES;

/** The style names, in declaration order. */
export const STYLE_NAMES: readonly StyleName[] =
	Object.keys(STYLES).filter(isStyleName);

/**
 * A chain of styles that renders text.
 *
 * Called with text it renders and the chain is spent; called with nothing it
 * hands back the chain, so both spellings work:
 *
 *   colors.dim.yellow("2 files")
 *   colors.dim().yellow("2 files")
 *
 * NAMED DEVIATION — upstream only supports the second. The property form is
 * here because the chain is immutable either way, and `colors.dim.yellow(x)`
 * is what people keep writing.
 */
export interface Colors {
	(): Colors;
	(text: string | number): string;
	readonly reset: Colors;
	readonly bold: Colors;
	readonly dim: Colors;
	readonly italic: Colors;
	readonly underline: Colors;
	readonly inverse: Colors;
	readonly hidden: Colors;
	readonly strikethrough: Colors;
	readonly black: Colors;
	readonly red: Colors;
	readonly green: Colors;
	readonly yellow: Colors;
	readonly blue: Colors;
	readonly magenta: Colors;
	readonly cyan: Colors;
	readonly white: Colors;
	readonly gray: Colors;
	readonly grey: Colors;
	readonly bgBlack: Colors;
	readonly bgRed: Colors;
	readonly bgGreen: Colors;
	readonly bgYellow: Colors;
	readonly bgBlue: Colors;
	readonly bgMagenta: Colors;
	readonly bgCyan: Colors;
	readonly bgWhite: Colors;
}

/** How a chain turns into a string once it is given text. */
type Renderer = (applied: readonly StyleName[], text: string) => string;

function isStyleName(value: string): value is StyleName {
	return Object.hasOwn(STYLES, value);
}

/**
 * The accessors were just defined, so this always holds. It is a guard rather
 * than a cast because a cast is how a wrong assumption becomes a runtime
 * surprise three files away.
 */
function carriesStyles(value: unknown): value is Colors {
	return typeof value === "function" && "red" in value && "bgWhite" in value;
}

function buildChain(applied: readonly StyleName[], render: Renderer): Colors {
	const callable = (text?: string | number): unknown =>
		text === undefined
			? buildChain(applied, render)
			: render(applied, String(text));

	// A chain is immutable, so each child is built once and handed back on
	// every later access: rebuilt each time, `colors.dim(x)` defined 28
	// accessors per call, and a box of 300 000 lines took seconds.
	const children = new Map<StyleName, Colors>();
	const descriptors: PropertyDescriptorMap = {};
	for (const style of STYLE_NAMES) {
		descriptors[style] = {
			configurable: true,
			enumerable: true,
			get: () => {
				let child = children.get(style);
				if (child === undefined) {
					child = buildChain([...applied, style], render);
					children.set(style, child);
				}
				return child;
			},
		};
	}
	Object.defineProperties(callable, descriptors);

	if (!carriesStyles(callable)) {
		throw new Error("unreachable: the style accessors were just defined");
	}
	return callable;
}

/** Escape codes. What a terminal that supports them gets. */
export function ansiColors(): Colors {
	return buildChain([], (applied, text) => {
		if (applied.length === 0) return text;
		// Applied inside-out, one style at a time, because each one has to
		// repair what a NESTED call closed.
		//
		// `red("a " + yellow("b") + " c")` is the case: yellow ends with 39,
		// which resets the foreground — including the red that was still
		// meant to be running. Closing each style with its own code is not
		// enough here, since both use 39. So before wrapping, every
		// occurrence of THIS style's close code inside the text is followed
		// by its open code again: the inner colour ends, the outer one
		// resumes. It is what chalk does, and there is no cheaper fix that
		// keeps nesting correct.
		let out = text;
		for (const style of [...applied].reverse()) {
			const [openCode, closeCode] = STYLES[style];
			const open = `\u001B[${openCode}m`;
			const close = `\u001B[${closeCode}m`;
			if (out.includes(close)) out = out.replaceAll(close, `${close}${open}`);
			out = `${open}${out}${close}`;
		}
		return out;
	});
}

/** No transformation at all. What a pipe, a log file or a dumb terminal gets. */
export function silentColors(): Colors {
	return buildChain([], (_applied, text) => text);
}

/**
 * The transformations, spelled out: `dim(yellow(2 files))`.
 *
 * For tests. An assertion then reads as the intent — "this was dimmed" —
 * and a change of palette shows up as a diff instead of as a wall of `\u001B`.
 */
export function rawColors(): Colors {
	return buildChain([], (applied, text) =>
		applied.reduceRight((inner, style) => `${style}(${inner})`, text),
	);
}

/** A stream we can ask about colour support. */
export interface ColorStream {
	isTTY?: boolean;
}

/** Is `--flag` on the command line, before any `--`? supports-color's rule. */
function hasFlag(flag: string, argv: readonly string[]): boolean {
	const position = argv.indexOf(`--${flag}`);
	const terminator = argv.indexOf("--");
	return position !== -1 && (terminator === -1 || position < terminator);
}

/** 0 for off, a level for on, undefined when the flags say nothing. */
function flagLevel(argv: readonly string[]): number | undefined {
	const off = ["no-color", "no-colors", "color=false", "color=never"];
	if (off.some((flag) => hasFlag(flag, argv))) return 0;
	const on = ["color", "colors", "color=true", "color=always"];
	if (on.some((flag) => hasFlag(flag, argv))) return 1;
	return undefined;
}

/**
 * `FORCE_COLOR`, parsed as supports-color parses it: empty or `true` is on,
 * `false` is off, 0–3 is a level, anything else is ignored rather than read
 * as "on" merely for being set.
 */
function envLevel(env: Record<string, string | undefined>): number | undefined {
	const force = env.FORCE_COLOR;
	if (force === undefined) return undefined;
	if (force === "true" || force === "") return 1;
	if (force === "false") return 0;
	const level = Math.min(Number.parseInt(force, 10), 3);
	return [0, 1, 2, 3].includes(level) ? level : undefined;
}

function isSet(env: Record<string, string | undefined>, name: string): boolean {
	return env[name] !== undefined;
}

/**
 * Should this stream get escape codes?
 *
 * Asked ONCE, when the UI is built, and decided as supports-color 10.2.2
 * (upstream's) decides it: `FORCE_COLOR`, then the `--color`/`--no-color`
 * flags; then a stream that is not a terminal gets nothing — the CI list is
 * consulted only after that, so `cmd > out.txt` inside a GitHub job writes
 * plain text; then what the terminal says about itself.
 *
 * NAMED DEVIATION — `NO_COLOR` (no-color.org), which supports-color ignores,
 * turns colour off unless `FORCE_COLOR` or a flag explicitly asked for it.
 */
export function supportsColor(
	stream: ColorStream = stdout,
	env: Record<string, string | undefined> = process.env,
	argv: readonly string[] = process.argv,
): boolean {
	const forced = envLevel(env) ?? flagLevel(argv);
	if (forced === 0) return false;
	const depth = ["color=16m", "color=full", "color=truecolor", "color=256"];
	if (depth.some((flag) => hasFlag(flag, argv))) return true;
	if (
		forced === undefined &&
		env.NO_COLOR !== undefined &&
		env.NO_COLOR !== ""
	) {
		return false;
	}
	// Azure Pipelines renders colour without giving the agent a terminal.
	if (isSet(env, "TF_BUILD") && isSet(env, "AGENT_NAME")) return true;
	if (stream.isTTY !== true && forced === undefined) return false;

	const minimum = (forced ?? 0) > 0;
	const term = env.TERM ?? "";
	if (term === "dumb") return minimum;
	if (platform === "win32") return true;
	if (isSet(env, "CI")) {
		const known = [
			"GITHUB_ACTIONS",
			"GITEA_ACTIONS",
			"CIRCLECI",
			"TRAVIS",
			"APPVEYOR",
			"GITLAB_CI",
			"BUILDKITE",
			"DRONE",
		];
		if (known.some((name) => isSet(env, name))) return true;
		if (env.CI_NAME === "codeship") return true;
		return minimum;
	}
	const teamcity = env.TEAMCITY_VERSION;
	if (teamcity !== undefined) {
		return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(teamcity);
	}
	if (env.COLORTERM === "truecolor") return true;
	if (["xterm-kitty", "xterm-ghostty", "wezterm"].includes(term)) return true;
	if (
		env.TERM_PROGRAM === "iTerm.app" ||
		env.TERM_PROGRAM === "Apple_Terminal"
	) {
		return true;
	}
	if (/-256(color)?$/i.test(term)) return true;
	if (
		/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(term)
	) {
		return true;
	}
	if (isSet(env, "COLORTERM")) return true;
	return minimum;
}
