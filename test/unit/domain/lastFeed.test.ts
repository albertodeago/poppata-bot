import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event.js";
import {
	answerLastFeed,
	formatLastFeed,
	LAST_FEED_QUERY,
	lastFeedHint,
} from "../../../src/domain/lastFeed.js";
import { success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

const feed = (over: Partial<BabyEvent>): BabyEvent => ({
	id: "e1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	side: "dx",
	startedAt: new Date("2026-07-02T12:30:00Z"), // 14:30 Rome
	source: "rules",
	rawText: "poppata dx",
	messageId: 1,
	createdAt: new Date("2026-07-02T12:30:00Z"),
	...over,
});

const now = new Date("2026-07-02T15:00:00Z"); // 17:00 Rome

describe("[LASTFEED] LAST_FEED_QUERY", () => {
	it("matches breast queries", () => {
		for (const s of ["che seno?", "quale seno", "ultimo seno", "che tetta"]) {
			expect(LAST_FEED_QUERY.test(s)).toBe(true);
		}
	});
	it("does not match feed logging", () => {
		for (const s of ["poppata seno destro", "inizio poppata", "seno destro"]) {
			expect(LAST_FEED_QUERY.test(s)).toBe(false);
		}
	});
});

describe("[LASTFEED] formatLastFeed", () => {
	it("closed feed → finished-at + ago", () => {
		const f = feed({ endedAt: new Date("2026-07-02T13:00:00Z") }); // 15:00 Rome, 2h ago
		expect(formatLastFeed(f, now)).toBe(
			"Ultima poppata: seno destro — finita alle 15:00 (2h fa)",
		);
	});
	it("open feed → in corso", () => {
		expect(formatLastFeed(feed({ side: "sx" }), now)).toBe(
			"Poppata in corso: seno sinistro — iniziata alle 14:30",
		);
	});
	it("no feed → none message", () => {
		expect(formatLastFeed(null, now)).toBe(
			"Non ho ancora registrato una poppata con un seno.",
		);
	});
});

describe("[LASTFEED] lastFeedHint", () => {
	it("closed feed → compact ago suffix", () => {
		const f = feed({ endedAt: new Date("2026-07-02T13:00:00Z") });
		expect(lastFeedHint(f, now)).toBe(" (ultima: destro, 2h fa)");
	});
	it("open feed → in corso suffix", () => {
		expect(lastFeedHint(feed({}), now)).toBe(" (ultima: destro, in corso)");
	});
	it("no feed → empty string", () => {
		expect(lastFeedHint(null, now)).toBe("");
	});
});

describe("[LASTFEED] answerLastFeed", () => {
	it("sends the formatted last feed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success(feed({ endedAt: new Date("2026-07-02T13:00:00Z") })),
		);
		await answerLastFeed(1, now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Ultima poppata: seno destro — finita alle 15:00 (2h fa)",
		);
	});
	it("sends an internal-error message when the read fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue({
			success: false,
			error: new Error("db down"),
		});
		await answerLastFeed(1, now)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Errore interno");
		expect(mocks.logger.error).toHaveBeenCalled();
	});
});
