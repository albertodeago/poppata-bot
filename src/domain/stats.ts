import type { ChatLanguage } from "./chatConfig.js";
import type { BabyEvent } from "./event.js";
import { aggregate, aggregateWeekly } from "./report.js";
import { bucketWindows, type Frame } from "./time.js";
import type { WeightReading } from "./weight.js";

export interface TopicSeries {
	/** per-bucket value: a count, or milliseconds for sleep */
	buckets: number[];
	labels: string[];
	/** window total: a count, or milliseconds for sleep */
	total: number;
	/** per-day average over the frame (count/day, or ms/day for sleep) */
	avgPerDay: number;
}

export interface EatSeries extends TopicSeries {
	feedCount: number;
	bottleCount: number;
	bottleMl: number;
	avgFeedMs: number;
	feedDx: number;
	feedSx: number;
}

export interface SleepSeries extends TopicSeries {
	longestSleepMs: number;
}

export interface FrameStats {
	labels: string[];
	eat: EatSeries;
	sleep: SleepSeries;
	pee: TopicSeries;
	poo: TopicSeries;
}

export interface WeightPoint {
	day: string;
	kg: number;
}

export interface StatsPayload {
	babyName?: string;
	language: ChatLanguage;
	generatedAt: string;
	day: FrameStats;
	week: FrameStats;
	month: FrameStats;
	weight: WeightPoint[];
	openSession?: "eat" | "sleep";
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const DAYS: Record<Frame, number> = { day: 1, week: 7, month: 30 };

const frameStats = (
	events: BabyEvent[],
	frame: Frame,
	now: Date,
): FrameStats => {
	const buckets = bucketWindows(now, frame);
	const labels = buckets.map((b) => b.label);
	const per = buckets.map((b) =>
		aggregate(events, { start: b.start, end: b.end }),
	);
	const whole = aggregateWeekly(events, {
		start: buckets[0]?.start ?? now,
		end: now,
	});
	const days = DAYS[frame];

	const eatTotal = whole.feedCount + whole.bottleCount;
	const eat: EatSeries = {
		buckets: per.map((s) => s.feedCount + s.bottleCount),
		labels,
		total: eatTotal,
		avgPerDay: round1(eatTotal / days),
		feedCount: whole.feedCount,
		bottleCount: whole.bottleCount,
		bottleMl: whole.bottleMl,
		avgFeedMs: whole.avgFeedMs,
		feedDx: whole.feedDx,
		feedSx: whole.feedSx,
	};
	const sleep: SleepSeries = {
		buckets: per.map((s) => s.sleepMs),
		labels,
		total: whole.sleepMs,
		avgPerDay: Math.round(whole.sleepMs / days),
		longestSleepMs: whole.longestSleepMs,
	};
	const pee: TopicSeries = {
		buckets: per.map((s) => s.peeCount),
		labels,
		total: whole.peeCount,
		avgPerDay: round1(whole.peeCount / days),
	};
	const poo: TopicSeries = {
		buckets: per.map((s) => s.poopCount),
		labels,
		total: whole.poopCount,
		avgPerDay: round1(whole.poopCount / days),
	};
	return { labels, eat, sleep, pee, poo };
};

export const buildStatsPayload = (input: {
	events: BabyEvent[];
	weights: WeightReading[];
	babyName?: string;
	language?: ChatLanguage;
	now: Date;
}): StatsPayload => {
	const { events, weights, babyName, language = "it", now } = input;
	const weight: WeightPoint[] = weights.map((r) => ({
		day: r.day,
		kg: Math.round(r.grams / 10) / 100,
	}));
	const open = events.find(
		(e) => (e.type === "eat" || e.type === "sleep") && e.endedAt === undefined,
	);
	return {
		...(babyName ? { babyName } : {}),
		language,
		generatedAt: now.toISOString(),
		day: frameStats(events, "day", now),
		week: frameStats(events, "week", now),
		month: frameStats(events, "month", now),
		weight,
		...(open ? { openSession: open.type as "eat" | "sleep" } : {}),
	};
};
