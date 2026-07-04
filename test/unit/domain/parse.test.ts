import { describe, expect, it } from "vitest";
import {
	hasBabySignal,
	normalize,
	parseRules,
} from "../../../src/domain/parse.js";

describe("[PARSE] normalize", () => {
	it("lowercases, trims, strips accents", () => {
		expect(normalize("  Pipì  ")).toBe("pipi");
		expect(normalize("Pupù")).toBe("pupu");
	});
});

describe("[PARSE] parseRules", () => {
	const cases: Array<{
		input: string;
		expect: Partial<ReturnType<typeof parseRules>>;
	}> = [
		{
			input: "inizio poppata dx 9.15",
			expect: {
				type: "eat",
				action: "start",
				side: "dx",
				hour: 9,
				minute: 15,
				hasTime: true,
				confidence: 1,
			},
		},
		{
			input: "fine 9.40",
			expect: {
				action: "end",
				hour: 9,
				minute: 40,
				hasTime: true,
				confidence: 1,
			},
		},
		{
			input: "fine poppata",
			expect: { type: "eat", action: "end", hasTime: false, confidence: 1 },
		},
		{
			input: "pipi",
			expect: { type: "pee", action: "instant", hasTime: false, confidence: 1 },
		},
		{
			input: "cacca",
			expect: {
				type: "poop",
				action: "instant",
				hasTime: false,
				confidence: 1,
			},
		},
		{
			input: "nanna 10",
			expect: {
				type: "sleep",
				action: "start",
				hour: 10,
				minute: 0,
				hasTime: true,
				confidence: 1,
			},
		},
		// "mamma" is a common mistype/misheard "nanna" → treat as sleep
		{
			input: "inizio mamma 3.32",
			expect: {
				type: "sleep",
				action: "start",
				hour: 3,
				minute: 32,
				hasTime: true,
				confidence: 1,
			},
		},
		{
			input: "mamma",
			expect: { type: "sleep", action: "start", hasTime: false, confidence: 1 },
		},
		{
			input: "poppata sinistra",
			expect: { type: "eat", action: "start", side: "sx", confidence: 1 },
		},
		{
			input: "poppata destro",
			expect: { type: "eat", action: "start", side: "dx", confidence: 1 },
		},
		{
			input: "poppata sinistro",
			expect: { type: "eat", action: "start", side: "sx", confidence: 1 },
		},
		{
			input: "allattamento 21:30",
			expect: {
				type: "eat",
				action: "start",
				hour: 21,
				minute: 30,
				hasTime: true,
			},
		},
		{
			input: "piscio",
			expect: { type: "pee", action: "instant", confidence: 1 },
		},
		{
			input: "pisciata",
			expect: { type: "pee", action: "instant", confidence: 1 },
		},
		{
			input: "popò",
			expect: { type: "poop", action: "instant", confidence: 1 },
		},
		{
			input: "cagare",
			expect: { type: "poop", action: "instant", confidence: 1 },
		},
		{
			input: "cacata",
			expect: { type: "poop", action: "instant", confidence: 1 },
		},
		// typo tolerance (Levenshtein ≤ 1)
		{
			input: "pili",
			expect: { type: "pee", action: "instant", confidence: 1 },
		},
		{
			input: "popata",
			expect: { type: "eat", action: "start", confidence: 1 },
		},
		{
			input: "caca",
			expect: { type: "poop", action: "instant", confidence: 1 },
		},
		{
			input: "inisio poppata dx 9.15",
			expect: { type: "eat", action: "start", side: "dx", confidence: 1 },
		},
		// typo ambiguity + stop-words must NOT be guessed
		{ input: "pipo", expect: { confidence: 0 } }, // 1 edit from pipi AND popo
		{ input: "popi", expect: { confidence: 0 } }, // idem
		{ input: "nonna", expect: { confidence: 0 } }, // stop-word (~ nanna)
		// false-positive guards (must NOT be parsed as pee/poop)
		{ input: "andiamo in piscina", expect: { confidence: 0 } },
		{ input: "un po di cacao", expect: { confidence: 0 } },
		{ input: "ho visto un cane cagnolino", expect: { confidence: 0 } },
		{ input: "ciao come stai", expect: { confidence: 0 } },
	];

	for (const c of cases) {
		it(`parses: "${c.input}"`, () => {
			const got = parseRules(normalize(c.input));
			expect(got).toMatchObject(c.expect);
		});
	}
});

describe("[PARSE] hasBabySignal", () => {
	// Baby-vocabulary present (including words the parser itself doesn't act on).
	for (const input of [
		"poppata",
		"nanna 22",
		"pipi",
		"cacca",
		"dx 9",
		"ha mangiato tanto",
		"che pappa buona",
		"gli ho dato il biberon",
		"attaccato al seno",
	]) {
		it(`true: "${input}"`, () => {
			expect(hasBabySignal(normalize(input))).toBe(true);
		});
	}

	// Unrelated chatter — no signal, should stay silent.
	for (const input of [
		"ciao come stai",
		"buonanotte a tutti",
		"hey dude hows going",
		"ci vediamo dopo",
	]) {
		it(`false: "${input}"`, () => {
			expect(hasBabySignal(normalize(input))).toBe(false);
		});
	}
});
