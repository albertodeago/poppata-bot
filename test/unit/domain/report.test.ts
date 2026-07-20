import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event.js";
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
	formatSchedule,
	formatWeekly,
} from "../../../src/domain/report.js";
import type { TimeWindow } from "../../../src/domain/time.js";

const d = (iso: string) => new Date(iso);
const window: TimeWindow = {
	start: d("2026-07-01T00:00:00+02:00"),
	end: d("2026-07-02T00:00:00+02:00"),
};

const ev = (over: Partial<BabyEvent>): BabyEvent => ({
	id: Math.random().toString(),
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: d("2026-07-01T09:00:00+02:00"),
	source: "rules",
	rawText: "",
	messageId: 1,
	createdAt: d("2026-07-01T09:00:00+02:00"),
	...over,
});

describe("[REPORT] aggregate", () => {
	it("sums feeds/sleep/pee/poop within the window", () => {
		const events: BabyEvent[] = [
			ev({
				type: "eat",
				side: "dx",
				startedAt: d("2026-07-01T09:00:00+02:00"),
				endedAt: d("2026-07-01T09:30:00+02:00"),
			}),
			ev({
				type: "eat",
				side: "sx",
				startedAt: d("2026-07-01T12:00:00+02:00"),
				endedAt: d("2026-07-01T12:20:00+02:00"),
			}),
			ev({
				type: "sleep",
				startedAt: d("2026-07-01T14:00:00+02:00"),
				endedAt: d("2026-07-01T15:30:00+02:00"),
			}),
			ev({ type: "pee", startedAt: d("2026-07-01T10:00:00+02:00") }),
			ev({ type: "poop", startedAt: d("2026-07-01T11:00:00+02:00") }),
		];
		const s = aggregate(events, window);
		expect(s.eatMs).toBe(50 * 60_000);
		expect(s.feedCount).toBe(2);
		expect(s.feedDx).toBe(1);
		expect(s.feedSx).toBe(1);
		expect(s.sleepMs).toBe(90 * 60_000);
		expect(s.peeCount).toBe(1);
		expect(s.poopCount).toBe(1);
		expect(s.openExcluded).toBe(false);
	});

	it("sums bottle count and ml within the window", () => {
		const events: BabyEvent[] = [
			ev({
				type: "bottle",
				amountMl: 100,
				startedAt: d("2026-07-01T09:00:00+02:00"),
			}),
			ev({
				type: "bottle",
				amountMl: 90,
				startedAt: d("2026-07-01T13:00:00+02:00"),
			}),
			// outside the window → excluded
			ev({
				type: "bottle",
				amountMl: 60,
				startedAt: d("2026-07-02T09:00:00+02:00"),
			}),
		];
		const s = aggregate(events, window);
		expect(s.bottleCount).toBe(2);
		expect(s.bottleMl).toBe(190);
	});

	it("clips a session that crosses the window end", () => {
		const events = [
			ev({
				type: "sleep",
				startedAt: d("2026-07-01T23:00:00+02:00"),
				endedAt: d("2026-07-02T01:00:00+02:00"),
			}),
		];
		const s = aggregate(events, window);
		expect(s.sleepMs).toBe(60 * 60_000); // only the hour before midnight
	});

	it("flags and excludes an open session", () => {
		const events = [
			ev({ type: "sleep", startedAt: d("2026-07-01T23:00:00+02:00") }),
		];
		const s = aggregate(events, window);
		expect(s.sleepMs).toBe(0);
		expect(s.openExcluded).toBe(true);
	});
});

describe("[REPORT] aggregateWeekly", () => {
	it("computes avg feed duration, longest sleep and avg feed gap", () => {
		const weekWindow: TimeWindow = {
			start: d("2026-06-22T00:00:00+02:00"),
			end: d("2026-06-29T00:00:00+02:00"),
		};
		const events: BabyEvent[] = [
			ev({
				type: "eat",
				startedAt: d("2026-06-22T08:00:00+02:00"),
				endedAt: d("2026-06-22T08:20:00+02:00"),
			}),
			ev({
				type: "eat",
				startedAt: d("2026-06-22T11:00:00+02:00"),
				endedAt: d("2026-06-22T11:40:00+02:00"),
			}),
			ev({
				type: "sleep",
				startedAt: d("2026-06-22T14:00:00+02:00"),
				endedAt: d("2026-06-22T16:00:00+02:00"),
			}),
		];
		const s = aggregateWeekly(events, weekWindow);
		expect(s.avgFeedMs).toBe(30 * 60_000); // (20 + 40) / 2
		expect(s.longestSleepMs).toBe(120 * 60_000);
		expect(s.avgFeedGapMs).toBe(180 * 60_000); // 08:00 -> 11:00
	});
});

describe("[REPORT] formatDaily", () => {
	it("renders a title and footer flag when a session was open", () => {
		const s = aggregate(
			[ev({ type: "sleep", startedAt: d("2026-07-01T23:00:00+02:00") })],
			window,
		);
		const text = formatDaily(s, "📊 Ieri");
		expect(text).toContain("📊 Ieri");
		expect(text.toLowerCase()).toContain("aperta");
	});

	it("renders a bottle line with total ml and count", () => {
		const s = aggregate(
			[
				ev({
					type: "bottle",
					amountMl: 100,
					startedAt: d("2026-07-01T09:00:00+02:00"),
				}),
				ev({
					type: "bottle",
					amountMl: 90,
					startedAt: d("2026-07-01T13:00:00+02:00"),
				}),
			],
			window,
		);
		const text = formatDaily(s, "📊 Oggi");
		expect(text).toContain("🥛");
		expect(text).toContain("190 ml");
		expect(text).toContain("(2)");
	});

	it("renders English labels", () => {
		const s = aggregate(
			[
				ev({
					type: "bottle",
					amountMl: 100,
					startedAt: d("2026-07-01T09:00:00+02:00"),
				}),
			],
			window,
		);
		const text = formatDaily(s, "📊 Today", "en");
		expect(text).toContain("Sleep:");
		expect(text).toContain("Bottles: 100 ml");
	});
});

describe("[REPORT] formatWeekly", () => {
	it("renders a bottle line with total ml and count", () => {
		const s = aggregateWeekly(
			[
				ev({
					type: "bottle",
					amountMl: 120,
					startedAt: d("2026-07-01T09:00:00+02:00"),
				}),
			],
			window,
		);
		const text = formatWeekly(s, "📅 Settimana");
		expect(text).toContain("🥛");
		expect(text).toContain("120 ml");
		expect(text).toContain("(1)");
	});
});

describe("[REPORT] formatSchedule", () => {
	it("says the day is empty when there are no events", () => {
		const text = formatSchedule([], window);
		expect(text).toContain("Scaletta di oggi");
		expect(text).toContain("Nessun evento ancora oggi.");
	});

	it("lists events chronologically with feed side, sleep range and totals", () => {
		const events: BabyEvent[] = [
			ev({ type: "poop", startedAt: d("2026-07-01T09:40:00+02:00") }),
			ev({
				type: "eat",
				side: "dx",
				startedAt: d("2026-07-01T09:10:00+02:00"),
				endedAt: d("2026-07-01T09:35:00+02:00"),
			}),
			ev({
				type: "sleep",
				startedAt: d("2026-07-01T07:10:00+02:00"),
				endedAt: d("2026-07-01T09:00:00+02:00"),
			}),
		];
		const text = formatSchedule(events, window);
		// sorted: 7:10 sleep, 9:10 eat, 9:40 poop
		const iSleep = text.indexOf("7:10→9:00");
		const iEat = text.indexOf("9:10→9:35");
		const iPoop = text.indexOf("cacca");
		expect(iSleep).toBeGreaterThan(-1);
		expect(iSleep).toBeLessThan(iEat);
		expect(iEat).toBeLessThan(iPoop);
		expect(text).toContain("🍼");
		expect(text).toContain("dx");
		expect(text).toContain("(25m)");
		expect(text).toContain("<pre>");
		expect(text).toContain("Totali:");
		expect(text).toContain("🍼 1");
		expect(text).toContain("💩 1");
	});

	it("lists a bottle with its ml and includes it in the totals", () => {
		const events: BabyEvent[] = [
			ev({
				type: "bottle",
				amountMl: 100,
				startedAt: d("2026-07-01T09:20:00+02:00"),
			}),
		];
		const text = formatSchedule(events, window);
		expect(text).toContain("biberon");
		expect(text).toContain("100 ml");
		expect(text).toContain("🥛");
	});

	it("shows an open session as in-progress and excludes it from totals", () => {
		const events: BabyEvent[] = [
			ev({ type: "sleep", startedAt: d("2026-07-01T10:05:00+02:00") }),
		];
		const text = formatSchedule(events, window);
		expect(text).toContain("da 10:05 ⏳");
		expect(text).toContain("😴 0m"); // open session not counted in the total
	});
});
