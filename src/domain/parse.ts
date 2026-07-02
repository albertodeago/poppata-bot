import type { EventSource, EventType, Side } from "./event";
import type { Result } from "./result";

export type Action = "start" | "end" | "instant";

export interface Intent {
	type: EventType;
	action: Action;
	side?: Side;
	/** Resolved absolute instant. */
	at: Date;
	source: EventSource;
	confidence: number;
}

/** Rules-parser output, before time resolution. */
export interface ParsedTokens {
	type?: EventType;
	action?: Action;
	side?: Side;
	hour?: number;
	minute: number;
	hasTime: boolean;
	confidence: number;
}

/** Shape the LLM fallback must return (Plan 2 supplies the Gemini adapter). */
export interface GeminiParse {
	type: EventType;
	action: Action;
	side?: Side;
	hour?: number;
	minute?: number;
	confidence: number;
}

export interface ParserEnv {
	parser: {
		/** Returns null when the model can't parse the message. */
		parse(text: string): Promise<Result<GeminiParse | null>>;
	};
}

export const normalize = (text: string): string =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();

const EAT = /\b(poppata|allatta(?:mento)?|tetta|latte|poppa)\b/;
const SLEEP = /\b(nanna|dorme|dormit\w*|sonnellino|sleep)\b/;
const PEE = /\b(pipi|plin)\b/;
const POOP = /\b(cacca|pupu|feci|poop)\b/;
const START = /\b(inizio|inizia|start|comincia)\b/;
const END = /\b(fine|finit[ao]|stop|end|basta)\b/;
const SIDE_DX = /\b(dx|destra|right)\b/;
const SIDE_SX = /\b(sx|sinistra|left)\b/;

const detectType = (t: string): EventType | undefined => {
	if (EAT.test(t)) return "eat";
	if (SLEEP.test(t)) return "sleep";
	if (PEE.test(t)) return "pee";
	if (POOP.test(t)) return "poop";
	return undefined;
};

const detectTime = (
	t: string,
): { hour: number; minute: number } | undefined => {
	const withMin = t.match(/(\d{1,2})[.:h](\d{1,2})/);
	if (withMin?.[1] && withMin[2]) {
		return { hour: Number(withMin[1]), minute: Number(withMin[2]) };
	}
	const bare = t.match(/\b(\d{1,2})\b/);
	if (bare?.[1]) return { hour: Number(bare[1]), minute: 0 };
	return undefined;
};

/**
 * Rules parser over already-normalized text. `confidence` is 1 when a type is
 * found or an explicit `end` is present; otherwise 0 (caller falls back to Gemini).
 */
export const parseRules = (text: string): ParsedTokens => {
	const type = detectType(text);
	const time = detectTime(text);
	const hasEnd = END.test(text);
	const hasStart = START.test(text);

	let action: Action | undefined;
	if (type === "pee" || type === "poop") action = "instant";
	else if (hasEnd) action = "end";
	else if (hasStart) action = "start";
	else if (type === "eat" || type === "sleep") action = "start";

	const side: Side | undefined = SIDE_DX.test(text)
		? "dx"
		: SIDE_SX.test(text)
			? "sx"
			: undefined;

	const confident = type !== undefined || action === "end";

	const tokens: ParsedTokens = {
		minute: time?.minute ?? 0,
		hasTime: time !== undefined,
		confidence: confident ? 1 : 0,
	};
	if (type) tokens.type = type;
	if (action) tokens.action = action;
	if (side) tokens.side = side;
	if (time) {
		tokens.hour = time.hour;
		tokens.minute = time.minute;
	}
	return tokens;
};
