import type { BabyEvent } from "./event";
import { formatDuration, type TimeWindow } from "./time";

export interface DailyStats {
	sleepMs: number;
	eatMs: number;
	feedCount: number;
	feedDx: number;
	feedSx: number;
	peeCount: number;
	poopCount: number;
	openExcluded: boolean;
}

export interface WeeklyStats extends DailyStats {
	avgFeedMs: number;
	longestSleepMs: number;
	avgFeedGapMs: number;
}

const overlapMs = (startedAt: Date, endedAt: Date, w: TimeWindow): number => {
	const start = Math.max(startedAt.getTime(), w.start.getTime());
	const end = Math.min(endedAt.getTime(), w.end.getTime());
	return Math.max(0, end - start);
};

const inWindow = (at: Date, w: TimeWindow): boolean =>
	at.getTime() >= w.start.getTime() && at.getTime() < w.end.getTime();

export const aggregate = (events: BabyEvent[], w: TimeWindow): DailyStats => {
	const s: DailyStats = {
		sleepMs: 0,
		eatMs: 0,
		feedCount: 0,
		feedDx: 0,
		feedSx: 0,
		peeCount: 0,
		poopCount: 0,
		openExcluded: false,
	};

	for (const e of events) {
		if (e.type === "pee") {
			if (inWindow(e.startedAt, w)) s.peeCount++;
			continue;
		}
		if (e.type === "poop") {
			if (inWindow(e.startedAt, w)) s.poopCount++;
			continue;
		}
		// eat / sleep
		if (e.endedAt === undefined) {
			s.openExcluded = true;
			continue;
		}
		const ms = overlapMs(e.startedAt, e.endedAt, w);
		if (ms <= 0) continue;
		if (e.type === "sleep") {
			s.sleepMs += ms;
		} else {
			s.eatMs += ms;
			s.feedCount++;
			if (e.side === "dx") s.feedDx++;
			else if (e.side === "sx") s.feedSx++;
		}
	}
	return s;
};

export const aggregateWeekly = (
	events: BabyEvent[],
	w: TimeWindow,
): WeeklyStats => {
	const base = aggregate(events, w);

	const feeds = events
		.filter(
			(e) =>
				e.type === "eat" &&
				e.endedAt !== undefined &&
				overlapMs(e.startedAt, e.endedAt, w) > 0,
		)
		.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

	const avgFeedMs =
		base.feedCount > 0 ? Math.round(base.eatMs / base.feedCount) : 0;

	let longestSleepMs = 0;
	for (const e of events) {
		if (e.type === "sleep" && e.endedAt !== undefined) {
			const ms = overlapMs(e.startedAt, e.endedAt, w);
			if (ms > longestSleepMs) longestSleepMs = ms;
		}
	}

	let avgFeedGapMs = 0;
	if (feeds.length >= 2) {
		let total = 0;
		for (let i = 1; i < feeds.length; i++) {
			const prev = feeds[i - 1];
			const cur = feeds[i];
			if (prev && cur) {
				total += cur.startedAt.getTime() - prev.startedAt.getTime();
			}
		}
		avgFeedGapMs = Math.round(total / (feeds.length - 1));
	}

	return { ...base, avgFeedMs, longestSleepMs, avgFeedGapMs };
};

const footer = (s: DailyStats): string =>
	s.openExcluded
		? "\n\n⚠️ Una sessione era ancora aperta e non è stata conteggiata."
		: "";

export const formatDaily = (s: DailyStats, title: string): string => {
	const lines = [
		title,
		"",
		`😴 Sonno: ${formatDuration(s.sleepMs)}`,
		`🍼 Poppate: ${formatDuration(s.eatMs)} (${s.feedCount} — dx ${s.feedDx}, sx ${s.feedSx})`,
		`💧 Pipì: ${s.peeCount}`,
		`💩 Cacca: ${s.poopCount}`,
	];
	return lines.join("\n") + footer(s);
};

export const formatWeekly = (s: WeeklyStats, title: string): string => {
	const lines = [
		title,
		"",
		`😴 Sonno: ${formatDuration(s.sleepMs)} (più lungo: ${formatDuration(s.longestSleepMs)})`,
		`🍼 Poppate: ${formatDuration(s.eatMs)} (${s.feedCount} — dx ${s.feedDx}, sx ${s.feedSx})`,
		`   media poppata: ${formatDuration(s.avgFeedMs)}, intervallo medio: ${formatDuration(s.avgFeedGapMs)}`,
		`💧 Pipì: ${s.peeCount}`,
		`💩 Cacca: ${s.poopCount}`,
	];
	return lines.join("\n") + footer(s);
};
