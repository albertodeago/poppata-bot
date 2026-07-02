import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event";
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
} from "../../../src/domain/report";
import type { TimeWindow } from "../../../src/domain/time";

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
});
