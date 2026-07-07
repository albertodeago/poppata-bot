import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	bucketWindows,
	currentDayWindow,
	formatDuration,
	hhmm,
	previousDayWindow,
	previousWeekWindow,
	resolveClock,
	romeDay,
	romeNow,
	ZONE,
} from "../../../src/domain/time.js";

const rome = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

describe("[TIME] resolveClock", () => {
	it("morning arrival, bare hour 9 -> 09:00 same day", () => {
		const arrival = rome("2026-07-02T09:30");
		const r = resolveClock(arrival, 9, 15);
		expect(r.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-07-02 09:15");
	});

	it("evening arrival, bare hour 9 -> 21:00 (pm nearest)", () => {
		const arrival = rome("2026-07-02T20:50");
		const r = resolveClock(arrival, 9, 0);
		expect(r.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-07-02 21:00");
	});

	it("hour >= 13 taken as 24h", () => {
		const arrival = rome("2026-07-02T09:00");
		const r = resolveClock(arrival, 22, 0);
		expect(r.toFormat("HH:mm")).toBe("22:00");
	});

	it("just-after-midnight arrival, '23:50' resolves to previous day", () => {
		const arrival = rome("2026-07-03T00:20");
		const r = resolveClock(arrival, 23, 50);
		expect(r.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-07-02 23:50");
	});
});

describe("[TIME] formatDuration", () => {
	it("minutes only", () => expect(formatDuration(45 * 60_000)).toBe("45m"));
	it("hours and minutes", () =>
		expect(formatDuration(80 * 60_000)).toBe("1h 20m"));
	it("whole hours", () => expect(formatDuration(120 * 60_000)).toBe("2h"));
	it("zero", () => expect(formatDuration(0)).toBe("0m"));
});

describe("[TIME] hhmm", () => {
	it("formats a Date in Rome as H:mm", () => {
		const d = rome("2026-07-02T09:05").toJSDate();
		expect(hhmm(d)).toBe("9:05");
	});
});

describe("[TIME] windows", () => {
	it("previousDayWindow is yesterday 00:00..today 00:00", () => {
		const now = romeNow(rome("2026-07-02T09:00").toJSDate());
		const w = previousDayWindow(now);
		expect(DateTime.fromJSDate(w.start).setZone(ZONE).toISO()).toContain(
			"2026-07-01T00:00",
		);
		expect(DateTime.fromJSDate(w.end).setZone(ZONE).toISO()).toContain(
			"2026-07-02T00:00",
		);
	});

	it("currentDayWindow ends at now", () => {
		const nowJs = rome("2026-07-02T09:30").toJSDate();
		const w = currentDayWindow(romeNow(nowJs));
		expect(w.end.getTime()).toBe(nowJs.getTime());
		expect(DateTime.fromJSDate(w.start).setZone(ZONE).toFormat("HH:mm")).toBe(
			"00:00",
		);
	});

	it("previousWeekWindow spans the prior Monday..Monday (ISO)", () => {
		// 2026-07-02 is a Thursday; previous ISO week = Mon 2026-06-22 .. Mon 2026-06-29
		const now = romeNow(rome("2026-07-02T09:00").toJSDate());
		const w = previousWeekWindow(now);
		expect(
			DateTime.fromJSDate(w.start).setZone(ZONE).toFormat("yyyy-MM-dd"),
		).toBe("2026-06-22");
		expect(
			DateTime.fromJSDate(w.end).setZone(ZONE).toFormat("yyyy-MM-dd"),
		).toBe("2026-06-29");
	});
});

describe("[TIME] romeDay", () => {
	it("returns the Rome-local calendar day as yyyy-MM-dd", () => {
		expect(romeDay(new Date("2026-07-03T10:00:00Z"))).toBe("2026-07-03");
	});

	it("rolls to the next day past Rome midnight", () => {
		// 23:30 UTC = 01:30 the next day in Rome (summer, +02:00)
		expect(romeDay(new Date("2026-07-03T23:30:00Z"))).toBe("2026-07-04");
	});
});

describe("[TIME] bucketWindows", () => {
	const now = new Date("2026-07-08T12:00:00+02:00"); // Wed

	it("day → 8 three-hour buckets from Rome midnight", () => {
		const b = bucketWindows(now, "day");
		expect(b).toHaveLength(8);
		expect(b.map((x) => x.label)).toEqual([
			"00",
			"03",
			"06",
			"09",
			"12",
			"15",
			"18",
			"21",
		]);
		expect(b[0]?.start.toISOString()).toBe(
			new Date("2026-07-08T00:00:00+02:00").toISOString(),
		);
		expect(b[1]?.start.toISOString()).toBe(
			new Date("2026-07-08T03:00:00+02:00").toISOString(),
		);
	});

	it("week → 7 daily buckets from Monday", () => {
		const b = bucketWindows(now, "week");
		expect(b).toHaveLength(7);
		expect(b.map((x) => x.label)).toEqual([
			"Lun",
			"Mar",
			"Mer",
			"Gio",
			"Ven",
			"Sab",
			"Dom",
		]);
		expect(b[0]?.start.toISOString()).toBe(
			new Date("2026-07-06T00:00:00+02:00").toISOString(),
		);
	});

	it("month → 30 daily buckets ending today", () => {
		const b = bucketWindows(now, "month");
		expect(b).toHaveLength(30);
		expect(b[0]?.start.toISOString()).toBe(
			new Date("2026-06-09T00:00:00+02:00").toISOString(),
		);
		expect(b[29]?.start.toISOString()).toBe(
			new Date("2026-07-08T00:00:00+02:00").toISOString(),
		);
		expect(b[0]?.label).toBe("9"); // every 5th bucket labelled
		expect(b[1]?.label).toBe("");
	});
});
