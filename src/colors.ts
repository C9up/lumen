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

import { stdout } from "node:process";

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

	const descriptors: PropertyDescriptorMap = {};
	for (const style of STYLE_NAMES) {
		descriptors[style] = {
			configurable: true,
			enumerable: true,
			get: () => buildChain([...applied, style], render),
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
		// Opened outside-in and closed inside-out, so a nested chain restores
		// what the outer one had rather than clearing everything.
		const open = applied.map((style) => `\u001B[${STYLES[style][0]}m`).join("");
		const close = [...applied]
			.reverse()
			.map((style) => `\u001B[${STYLES[style][1]}m`)
			.join("");
		return `${open}${text}${close}`;
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

/**
 * CI services that render escape codes in their log viewer.
 *
 * A CI that is NOT on this list gets no colour: an unknown log viewer showing
 * `[32m` on every line is worse than a plain transcript, and the operator has
 * `FORCE_COLOR` to say otherwise.
 */
const COLOUR_CAPABLE_CI = [
	"GITHUB_ACTIONS",
	"GITLAB_CI",
	"CIRCLECI",
	"TRAVIS",
	"BUILDKITE",
	"DRONE",
	"APPVEYOR",
];

/**
 * Should this stream get escape codes?
 *
 * Asked ONCE, when the UI is built. The order is the one users expect:
 * `NO_COLOR` wins over everything except an explicit `FORCE_COLOR`, because
 * the second is a deliberate override and the first is a default.
 */
export function supportsColor(
	stream: ColorStream = stdout,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const force = env.FORCE_COLOR;
	if (force !== undefined && force !== "") {
		// `FORCE_COLOR=0` is how the convention spells "off", so an env var set
		// to a falsy value must not read as "on" merely by existing.
		return force !== "0" && force !== "false";
	}
	// no-color.org: ANY non-empty value disables colour.
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
	if (env.TERM === "dumb") return false;
	if (env.CI !== undefined && env.CI !== "") {
		return COLOUR_CAPABLE_CI.some(
			(name) => env[name] !== undefined && env[name] !== "",
		);
	}
	return stream.isTTY === true;
}

/**
 * Drop the SGR escapes, leaving the visible text.
 *
 * Needed wherever a width is measured: a cell coloured green carries codes
 * that occupy no columns, and counting them shifts every column after it.
 */
export function stripAnsi(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
	return text.replace(/\u001B\[[0-9;]*m/g, "");
}
