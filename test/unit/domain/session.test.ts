import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event.js";
import type { Intent } from "../../../src/domain/parse.js";
import { decide } from "../../../src/domain/session.js";

const at = (iso: string) => new Date(iso);

const openEat: BabyEvent = {
	id: "s1",
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: at("2026-07-02T09:00:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9",
	messageId: 1,
	createdAt: at("2026-07-02T09:00:00+02:00"),
};

const intent = (over: Partial<Intent>): Intent => ({
	type: "eat",
	action: "start",
	at: at("2026-07-02T10:00:00+02:00"),
	source: "rules",
	confidence: 1,
	...over,
});

describe("[SESSION] decide", () => {
	it("instant always saves", () => {
		const d = decide(intent({ type: "pee", action: "instant" }), null);
		expect(d.kind).toBe("save");
	});

	it("start with no open session saves", () => {
		const d = decide(intent({ action: "start" }), null);
		expect(d.kind).toBe("save");
	});

	it("start while a session is open asks to confirm", () => {
		const d = decide(intent({ action: "start", type: "sleep" }), openEat);
		expect(d.kind).toBe("confirm");
		if (d.kind === "confirm") expect(d.warning).toContain("aperta");
	});

	it("end with no open session errors", () => {
		const d = decide(intent({ action: "end" }), null);
		expect(d.kind).toBe("error");
		if (d.kind === "error")
			expect(d.message).toBe("Nessuna sessione aperta da chiudere.");
	});

	it("normal end saves and adopts the open session type", () => {
		const d = decide(
			intent({
				action: "end",
				type: "eat",
				at: at("2026-07-02T09:40:00+02:00"),
			}),
			openEat,
		);
		expect(d.kind).toBe("save");
		if (d.kind === "save") {
			expect(d.intent.type).toBe("eat");
			expect(d.intent.at.toISOString()).toBe(
				at("2026-07-02T09:40:00+02:00").toISOString(),
			);
		}
	});

	it("end before start rolls +1 day (midnight crossing)", () => {
		const openSleep: BabyEvent = {
			...openEat,
			type: "sleep",
			startedAt: at("2026-07-02T23:30:00+02:00"),
		};
		// "fine 6.30" resolved same-day 06:30 < 23:30 -> roll to next day
		const d = decide(
			intent({
				action: "end",
				type: "sleep",
				at: at("2026-07-02T06:30:00+02:00"),
			}),
			openSleep,
		);
		expect(d.kind).toBe("save");
		if (d.kind === "save")
			expect(d.intent.at.toISOString()).toBe(
				at("2026-07-03T06:30:00+02:00").toISOString(),
			);
	});

	it("implausibly long feed asks to confirm", () => {
		// open 09:00, end 11:00 -> 120m > 90m
		const d = decide(
			intent({
				action: "end",
				type: "eat",
				at: at("2026-07-02T11:00:00+02:00"),
			}),
			openEat,
		);
		expect(d.kind).toBe("confirm");
	});
});
