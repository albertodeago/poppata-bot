import { describe, expect, it } from "vitest";
import {
	formatHistory,
	parseGrams,
	type WeightReading,
} from "../../../src/domain/weight.js";

const reading = (day: string, grams: number): WeightReading => ({
	id: `w-${day}`,
	chatId: 1,
	day,
	grams,
	userId: 1,
	userName: "papà",
	createdAt: new Date(`${day}T09:00:00Z`),
});

describe("[WEIGHT] parseGrams", () => {
	it("accepts a plain integer and trims whitespace", () => {
		expect(parseGrams("3400")).toBe(3400);
		expect(parseGrams("  3400  ")).toBe(3400);
	});

	it("rejects empty, non-numeric, and decimals", () => {
		expect(parseGrams("")).toBeNull();
		expect(parseGrams("abc")).toBeNull();
		expect(parseGrams("12.5")).toBeNull();
		expect(parseGrams("-500")).toBeNull();
	});

	it("rejects out-of-band values (fat-finger typos)", () => {
		expect(parseGrams("340")).toBeNull(); // below MIN_GRAMS
		expect(parseGrams("340000")).toBeNull(); // above MAX_GRAMS
	});
});

describe("[WEIGHT] formatHistory", () => {
	it("shows the empty-state hint when there are no readings", () => {
		expect(formatHistory([])).toBe(
			"Nessun peso registrato. Scrivi /peso 3400 per registrarne uno.",
		);
	});

	it("shows a single reading with no delta", () => {
		expect(formatHistory([reading("2026-07-01", 3200)])).toBe(
			"⚖️ Peso\n1 lug  3200 g",
		);
	});

	it("appends a signed delta between consecutive readings", () => {
		const text = formatHistory([
			reading("2026-07-01", 3200),
			reading("2026-07-08", 3400),
		]);
		expect(text).toContain("1 lug  3200 g");
		expect(text).toContain("8 lug  3400 g  (+200)");
	});

	it("renders a negative delta on weight loss", () => {
		const text = formatHistory([
			reading("2026-07-01", 3400),
			reading("2026-07-08", 3280),
		]);
		expect(text).toContain("(-120)");
	});
});
