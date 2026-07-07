import { DateTime } from "luxon";

export const ZONE = "Europe/Rome";

export interface TimeWindow {
	start: Date;
	end: Date;
}

export const romeNow = (at: Date): DateTime =>
	DateTime.fromJSDate(at).setZone(ZONE);

/** Rome-local calendar day as yyyy-MM-dd (the storage key for a weight). */
export const romeDay = (at: Date): string => romeNow(at).toFormat("yyyy-MM-dd");

/**
 * Resolve a bare clock time to the absolute instant nearest to `arrival`
 * (am/pm disambiguation). hour >= 13 is taken as 24h; hour 0..12 also
 * considers the +12 candidate. Candidates are generated on the arrival day
 * and its neighbours; the nearest to arrival wins.
 */
export const resolveClock = (
	arrival: DateTime,
	hour: number,
	minute: number,
): DateTime => {
	const hours = hour >= 13 ? [hour] : [hour, hour + 12];
	const base = arrival.setZone(ZONE).startOf("day");

	let best = base;
	let bestDiff = Number.POSITIVE_INFINITY;
	for (const off of [-1, 0, 1]) {
		for (const h of hours) {
			const cand = base.plus({ days: off, hours: h, minutes: minute });
			const diff = Math.abs(cand.toMillis() - arrival.toMillis());
			if (diff < bestDiff) {
				bestDiff = diff;
				best = cand;
			}
		}
	}
	return best;
};

export const hhmm = (at: Date): string =>
	DateTime.fromJSDate(at).setZone(ZONE).toFormat("H:mm");

export const formatDuration = (ms: number): string => {
	const totalMin = Math.round(ms / 60_000);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	return `${m}m`;
};

export const currentDayWindow = (now: DateTime): TimeWindow => ({
	start: now.setZone(ZONE).startOf("day").toJSDate(),
	end: now.toJSDate(),
});

export const previousDayWindow = (now: DateTime): TimeWindow => {
	const start = now.setZone(ZONE).startOf("day").minus({ days: 1 });
	return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
};

export const currentWeekWindow = (now: DateTime): TimeWindow => ({
	start: now.setZone(ZONE).startOf("week").toJSDate(),
	end: now.toJSDate(),
});

export const previousWeekWindow = (now: DateTime): TimeWindow => {
	const start = now.setZone(ZONE).startOf("week").minus({ weeks: 1 });
	return { start: start.toJSDate(), end: start.plus({ weeks: 1 }).toJSDate() };
};

export type Frame = "day" | "week" | "month";

const WEEK_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

/** Sub-windows the Mini App charts plot, in Europe/Rome, deterministic in `now`.
 *  Buckets may extend past `now` (future buckets simply aggregate to zero). */
export const bucketWindows = (
	now: Date,
	frame: Frame,
): { start: Date; end: Date; label: string }[] => {
	const n = romeNow(now);
	if (frame === "day") {
		const base = n.startOf("day");
		return Array.from({ length: 8 }, (_, i) => {
			const s = base.plus({ hours: i * 3 });
			return {
				start: s.toJSDate(),
				end: s.plus({ hours: 3 }).toJSDate(),
				label: s.toFormat("HH"),
			};
		});
	}
	if (frame === "week") {
		const base = n.startOf("week"); // luxon: Monday
		return Array.from({ length: 7 }, (_, i) => {
			const s = base.plus({ days: i });
			return {
				start: s.toJSDate(),
				end: s.plus({ days: 1 }).toJSDate(),
				label: WEEK_LABELS[i] as string,
			};
		});
	}
	const base = n.startOf("day").minus({ days: 29 });
	return Array.from({ length: 30 }, (_, i) => {
		const s = base.plus({ days: i });
		return {
			start: s.toJSDate(),
			end: s.plus({ days: 1 }).toJSDate(),
			label: i % 5 === 0 ? s.toFormat("d") : "",
		};
	});
};
