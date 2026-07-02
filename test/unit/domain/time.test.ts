import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	currentDayWindow,
	formatDuration,
	hhmm,
	previousDayWindow,
	previousWeekWindow,
	resolveClock,
	romeNow,
	ZONE,
} from "../../../src/domain/time";

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
