import type { EventSource, EventType, Side } from "./event.js";
import type { Result } from "./result.js";

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
// `mamma` is a frequent mistype/mishearing of `nanna` (same shape, m↔n) — treat
// it as a sleep keyword so "inizio mamma 3.32" logs a nap, not a feed.
const SLEEP = /\b(nanna|mamma|dorme|dormit\w*|sonnellino|sleep)\b/;
// Text is normalized (accent-stripped, lowercased) before matching, so
// `pipì`→`pipi`, `popò`→`popo`, `pupù`→`pupu`. Word-stems (`\w*`) cover
// conjugations while avoiding false positives like `piscina` (pool), `cacao`,
// `caccia` (hunt), `cagnolino`, `popolo`.
const PEE = /\b(pipi|plin|pisci[oa]\w*)\b/;
const POOP = /\b(cacca|cacchin\w*|cacat\w*|caga\w*|pupu|popo|feci|poop)\b/;
const START = /\b(inizio|inizia|start|comincia)\b/;
const END = /\b(fine|finit[ao]|stop|end|basta)\b/;
const SIDE_DX = /\b(dx|destra|destro|right)\b/;
const SIDE_SX = /\b(sx|sinistra|sinistro|left)\b/;
// Words that don't drive parsing but still mark a message as *meant for the
// bot*. Deliberately broader than the parse regexes (e.g. `pappa`/`mangia`
// aren't feed keywords) — see `hasBabySignal`.
const EXTRA_SIGNAL = /\b(mangia\w*|pappa|biberon|seno)\b/;

/**
 * True when the (already-normalized) text contains any baby-domain vocabulary.
 * Callers use it to keep the "non ho capito" hint for genuine-but-unparseable
 * attempts while staying silent on unrelated group chatter.
 */
export const hasBabySignal = (t: string): boolean =>
	EAT.test(t) ||
	SLEEP.test(t) ||
	PEE.test(t) ||
	POOP.test(t) ||
	START.test(t) ||
	END.test(t) ||
	SIDE_DX.test(t) ||
	SIDE_SX.test(t) ||
	EXTRA_SIGNAL.test(t);

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

/** True iff the two strings are within Levenshtein edit distance 1. */
const withinDistanceOne = (a: string, b: string): boolean => {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > 1) return false;
	if (a.length === b.length) {
		let diffs = 0;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i] && ++diffs > 1) return false;
		}
		return true; // exactly one substitution (0 handled above)
	}
	// lengths differ by 1: is `short` obtainable by deleting one char from `long`?
	const short = a.length < b.length ? a : b;
	const long = a.length < b.length ? b : a;
	let i = 0;
	let j = 0;
	let skipped = false;
	while (i < short.length && j < long.length) {
		if (short[i] === long[j]) {
			i++;
			j++;
		} else {
			if (skipped) return false;
			skipped = true;
			j++;
		}
	}
	return true;
};

// Common Italian words within 1 edit of a keyword that must NOT be typo-matched
// (same first letter, so the first-letter guard doesn't exclude them).
const FUZZY_STOP = new Set([
	"nonna", // ~ nanna
	"nonno",
	"caccia", // ~ cacca
	"pupa", // ~ pupu
	"cacao", // (already distance ≥2, listed for clarity)
	"piscina",
]);

// Curated, distinctive keywords per type for typo tolerance. Short/common words
// with high collision risk are intentionally left out (they still match exactly
// via the regexes above).
const FUZZY_TYPES: ReadonlyArray<readonly [EventType, readonly string[]]> = [
	["eat", ["poppata", "allattamento", "poppa"]],
	["sleep", ["nanna", "sonnellino", "dorme"]],
	["pee", ["pipi", "piscio", "pisciata"]],
	["poop", ["cacca", "cacata", "popo", "pupu"]],
];

/**
 * Typo-tolerant type detection for a single token. Requires: length ≥ 4, not a
 * stop-word, same first letter as the keyword, and Levenshtein ≤ 1. Returns the
 * type only when EXACTLY one category is in range — an ambiguous token like
 * `pipo` (1 edit from both `pipi` and `popo`) yields `undefined` rather than a guess.
 */
const fuzzyType = (token: string): EventType | undefined => {
	if (token.length < 4 || FUZZY_STOP.has(token)) return undefined;
	const hits = new Set<EventType>();
	for (const [type, words] of FUZZY_TYPES) {
		for (const w of words) {
			if (w[0] === token[0] && withinDistanceOne(token, w)) {
				hits.add(type);
				break;
			}
		}
	}
	return hits.size === 1 ? [...hits][0] : undefined;
};

/**
 * Rules parser over already-normalized text. `confidence` is 1 when a type is
 * found or an explicit `end` is present; otherwise 0 (caller falls back to Gemini).
 * When the exact/stem regexes miss a type, a Levenshtein-≤1 fallback tolerates typos.
 */
export const parseRules = (text: string): ParsedTokens => {
	let type = detectType(text);
	const time = detectTime(text);
	const hasEnd = END.test(text);
	const hasStart = START.test(text);

	// Typo tolerance: only when the exact/stem pass found no type.
	if (type === undefined) {
		for (const token of text.split(/\s+/)) {
			const fuzzy = fuzzyType(token);
			if (fuzzy) {
				type = fuzzy;
				break;
			}
		}
	}

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
