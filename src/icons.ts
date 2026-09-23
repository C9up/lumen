/**
 * The glyphs the widgets draw with, degraded where they would not render.
 *
 * A legacy Windows console draws a box instead of `✔`, which is worse than the
 * ASCII it replaced. Windows Terminal sets `WT_SESSION` and handles the full
 * set, so the fallback is scoped to the consoles that need it.
 */

export interface Icons {
	tick: string;
	cross: string;
	bullet: string;
	pointer: string;
	info: string;
	warning: string;
	squareSmallFilled: string;
	borderVertical: string;
	borderHorizontal: string;
	borderTopLeft: string;
	borderTopRight: string;
	borderBottomLeft: string;
	borderBottomRight: string;
}

const MODERN: Icons = {
	tick: "✔",
	cross: "✖",
	bullet: "●",
	pointer: "❯",
	info: "ℹ",
	warning: "⚠",
	squareSmallFilled: "◼",
	borderVertical: "│",
	borderHorizontal: "─",
	borderTopLeft: "╭",
	borderTopRight: "╮",
	borderBottomLeft: "╰",
	borderBottomRight: "╯",
};

const FALLBACK: Icons = {
	tick: "√",
	cross: "×",
	bullet: "*",
	pointer: ">",
	info: "i",
	warning: "!!",
	squareSmallFilled: "[#]",
	borderVertical: "|",
	borderHorizontal: "-",
	borderTopLeft: "+",
	borderTopRight: "+",
	borderBottomLeft: "+",
	borderBottomRight: "+",
};

/** Pick the set for a platform. Exported so a test can ask for either. */
export function iconsFor(
	platform: string = process.platform,
	env: Record<string, string | undefined> = process.env,
): Icons {
	return platform === "win32" && env.WT_SESSION === undefined
		? FALLBACK
		: MODERN;
}

export const icons: Icons = iconsFor();
