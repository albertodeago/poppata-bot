import { describe, expect, it } from "vitest";
import { normalize, parseRules } from "../../../src/domain/parse";

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
		{
			input: "poppata sinistra",
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
		{ input: "ciao come stai", expect: { confidence: 0 } },
	];

	for (const c of cases) {
		it(`parses: "${c.input}"`, () => {
			const got = parseRules(normalize(c.input));
			expect(got).toMatchObject(c.expect);
		});
	}
});
