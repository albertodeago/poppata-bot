import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event.js";
import { buildStatsPayload } from "../../../src/domain/stats.js";
import type { WeightReading } from "../../../src/domain/weight.js";

const d = (iso: string) => new Date(iso);
const now = d("2026-07-08T12:00:00+02:00"); // Wed

const ev = (over: Partial<BabyEvent>): BabyEvent => ({
	id: Math.random().toString(),
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: d("2026-07-08T09:00:00+02:00"),
	source: "rules",
	rawText: "",
	messageId: 1,
	createdAt: d("2026-07-08T09:00:00+02:00"),
	...over,
});

describe("[STATS] buildStatsPayload", () => {
	const events: BabyEvent[] = [
		ev({
			type: "eat",
			side: "dx",
			startedAt: d("2026-07-08T09:00:00+02:00"),
			endedAt: d("2026-07-08T09:30:00+02:00"),
		}),
		ev({
			type: "bottle",
			amountMl: 120,
			startedAt: d("2026-07-08T10:00:00+02:00"),
		}),
		ev({ type: "pee", startedAt: d("2026-07-08T07:00:00+02:00") }),
		ev({
			type: "sleep",
			startedAt: d("2026-07-08T01:00:00+02:00"),
			endedAt: d("2026-07-08T03:30:00+02:00"),
		}),
		ev({ type: "sleep", startedAt: d("2026-07-08T11:30:00+02:00") }), // open
	];
	const weights: WeightReading[] = [
		{
			id: "1",
			chatId: 1,
			day: "2026-07-01",
			grams: 5900,
			userId: 1,
			userName: "a",
			createdAt: d("2026-07-01T08:00:00+02:00"),
		},
		{
			id: "2",
			chatId: 1,
			day: "2026-07-05",
			grams: 6100,
			userId: 1,
			userName: "a",
			createdAt: d("2026-07-05T08:00:00+02:00"),
		},
	];
	const p = buildStatsPayload({
		events,
		weights,
		babyName: "Mochi",
		language: "en",
		now,
	});

	it("counts feeds (breast + bottle) per day bucket and in total", () => {
		// bucket index 3 == "09" window [09:00,12:00): one feed + one bottle
		expect(p.day.eat.buckets[3]).toBe(2);
		expect(p.day.eat.total).toBe(2);
		expect(p.day.eat.feedCount).toBe(1);
		expect(p.day.eat.bottleCount).toBe(1);
		expect(p.day.eat.bottleMl).toBe(120);
		expect(p.day.eat.feedDx).toBe(1);
		expect(p.day.eat.feedSx).toBe(0);
	});

	it("places pee in the correct 3h bucket", () => {
		expect(p.day.pee.buckets[2]).toBe(1); // "06" window [06:00,09:00)
		expect(p.day.pee.total).toBe(1);
	});

	it("splits a sleep across buckets by overlap and excludes the open one", () => {
		expect(p.day.sleep.buckets[0]).toBe(2 * 3_600_000); // 01:00–03:00
		expect(p.day.sleep.buckets[1]).toBe(30 * 60_000); // 03:00–03:30
		expect(p.day.sleep.total).toBe(150 * 60_000); // 2h30 closed; open excluded
		expect(p.openSession).toBe("sleep");
	});

	it("maps weight grams to kg", () => {
		expect(p.weight).toEqual([
			{ day: "2026-07-01", kg: 5.9 },
			{ day: "2026-07-05", kg: 6.1 },
		]);
	});

	it("carries the baby name, language, and a generatedAt stamp", () => {
		expect(p.babyName).toBe("Mochi");
		expect(p.language).toBe("en");
		expect(p.generatedAt).toBe(now.toISOString());
	});

	it("puts today's events in the week's Wednesday bucket", () => {
		expect(p.week.eat.buckets[2]).toBe(2); // Mer
	});
});
