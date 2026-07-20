import { describe, expect, it } from "vitest";
import {
	annullaCommand,
	graficiCommand,
	guidaCommand,
	HELP_TEXT,
	helpCommand,
	ieriCommand,
	oggiCommand,
	pesoCommand,
	scalettaCommand,
	sendDailyReport,
	sendWeeklyReport,
	senoCommand,
	settimanaCommand,
	statoCommand,
} from "../../../src/domain/commands.js";
import type { BabyEvent } from "../../../src/domain/event.js";
import { error, success } from "../../../src/domain/result.js";
import { romeDay } from "../../../src/domain/time.js";
import { makeTestEnv } from "../testEnv.js";

const openEat: BabyEvent = {
	id: "s1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	startedAt: new Date("2026-07-02T09:15:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9.15",
	messageId: 1,
	createdAt: new Date("2026-07-02T09:15:00+02:00"),
};

describe("[COMMANDS] /stato", () => {
	it("describes the open session with its start time", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		await statoCommand(1, new Date("2026-07-02T09:37:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("in corso da 9:15");
	});

	it("says nothing is open when there is no session", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		await statoCommand(1, new Date())(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nessuna sessione aperta.",
		);
	});
});

describe("[COMMANDS] /annulla", () => {
	it("reports what was removed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.deleteLast.mockResolvedValue(success(openEat));
		await annullaCommand(1)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("rimosso");
		expect(text.toLowerCase()).toContain("poppata");
	});

	it("says there is nothing to undo", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.deleteLast.mockResolvedValue(success(null));
		await annullaCommand(1)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Niente da annullare.",
		);
	});
});

describe("[COMMANDS] /help", () => {
	it("lists commands", async () => {
		const { env, mocks } = makeTestEnv();
		await helpCommand(1)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("/oggi");
		expect(text).toContain("/annulla");
	});

	it("lists English commands for an English chat", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({
				chatId: 1,
				language: "en",
				reportsEnabled: true,
				status: "approved",
			}),
		);
		await helpCommand(1)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("/today");
		expect(text).toContain("/language it|en");
	});

	it("documents bottle feeding", () => {
		expect(HELP_TEXT.toLowerCase()).toContain("biberon");
	});
});

const feed = (
	startIso: string,
	endIso: string,
	side?: "dx" | "sx",
): BabyEvent => ({
	id: Math.random().toString(),
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	startedAt: new Date(startIso),
	endedAt: new Date(endIso),
	source: "rules",
	rawText: "",
	messageId: 1,
	createdAt: new Date(startIso),
	...(side ? { side } : {}),
});

describe("[COMMANDS] /oggi + /ieri + /settimana", () => {
	it("/oggi aggregates today's events and sends a daily report", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(
			success([
				feed("2026-07-02T08:00:00+02:00", "2026-07-02T08:30:00+02:00", "dx"),
			]),
		);
		await oggiCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Oggi");
		expect(text).toContain("Poppate");
		// window ends at "now"
		const call = mocks.eventRepository.listSince.mock.calls[0];
		expect(call?.[2]?.toISOString()).toBe(
			new Date("2026-07-02T12:00:00+02:00").toISOString(),
		);
	});

	it("/today uses English report labels for an English chat", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({
				chatId: 1,
				language: "en",
				reportsEnabled: true,
				status: "approved",
			}),
		);
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await oggiCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Today");
		expect(text).toContain("Feeds");
	});

	it("/ieri uses yesterday's window", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await ieriCommand(1, new Date("2026-07-02T09:00:00+02:00"))(env);
		const call = mocks.eventRepository.listSince.mock.calls[0];
		expect(call?.[1]?.toISOString()).toBe(
			new Date("2026-07-01T00:00:00+02:00").toISOString(),
		);
		expect(call?.[2]?.toISOString()).toBe(
			new Date("2026-07-02T00:00:00+02:00").toISOString(),
		);
	});

	it("/settimana sends a weekly report", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await settimanaCommand(1, new Date("2026-07-02T09:00:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("settimana");
	});
});

describe("[COMMANDS] report senders", () => {
	it("sendDailyReport includes the baby name when provided", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await sendDailyReport(1, new Date("2026-07-02T09:00:00+02:00"), "Leo")(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Leo");
	});

	it("sendWeeklyReport targets the previous ISO week", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await sendWeeklyReport(1, new Date("2026-07-02T09:00:00+02:00"))(env);
		const call = mocks.eventRepository.listSince.mock.calls[0];
		expect(call?.[1]?.toISOString()).toBe(
			new Date("2026-06-22T00:00:00+02:00").toISOString(),
		);
	});
});

describe("[COMMANDS] /seno", () => {
	it("HELP_TEXT lists the /seno command", () => {
		expect(HELP_TEXT).toContain("/seno");
	});

	it("replies with the last feed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "eat",
				side: "dx",
				startedAt: new Date("2026-07-02T12:00:00Z"),
				endedAt: new Date("2026-07-02T13:00:00Z"),
				source: "rules",
				rawText: "poppata dx",
				messageId: 1,
				createdAt: new Date("2026-07-02T13:00:00Z"),
			}),
		);
		await senoCommand(1, new Date("2026-07-02T15:00:00Z"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Ultima poppata: seno destro");
	});
});

describe("[COMMANDS] /peso", () => {
	it("HELP_TEXT lists the /peso command", () => {
		expect(HELP_TEXT).toContain("/peso");
	});

	it("records today's weight and confirms it", async () => {
		const { env, mocks } = makeTestEnv();
		const now = new Date("2026-07-03T10:00:00Z");
		mocks.weightRepository.upsert.mockResolvedValue(
			success({
				reading: {
					id: "w1",
					chatId: 1,
					day: romeDay(now),
					grams: 3400,
					userId: 1,
					userName: "papà",
					createdAt: now,
				},
				overwritten: false,
			}),
		);
		await pesoCommand(1, 1, "papà", "3400", now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"⚖️ Peso di oggi: 3400 g",
		);
		expect(mocks.weightRepository.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ chatId: 1, grams: 3400, day: romeDay(now) }),
		);
	});

	it("notes when it overwrote an existing reading", async () => {
		const { env, mocks } = makeTestEnv();
		const now = new Date("2026-07-03T10:00:00Z");
		mocks.weightRepository.upsert.mockResolvedValue(
			success({
				reading: {
					id: "w1",
					chatId: 1,
					day: romeDay(now),
					grams: 3400,
					userId: 1,
					userName: "papà",
					createdAt: now,
				},
				overwritten: true,
			}),
		);
		await pesoCommand(1, 1, "papà", "3400", now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"⚖️ Peso di oggi: 3400 g (aggiornato)",
		);
	});

	it("rejects an out-of-band value without saving", async () => {
		const { env, mocks } = makeTestEnv();
		await pesoCommand(1, 1, "papà", "340", new Date())(env);
		expect(mocks.weightRepository.upsert).not.toHaveBeenCalled();
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Usa /peso 3400 (peso in grammi).",
		);
	});

	it("uses English copy for weight confirmation", async () => {
		const { env, mocks } = makeTestEnv();
		const now = new Date("2026-07-03T10:00:00Z");
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({
				chatId: 1,
				language: "en",
				reportsEnabled: true,
				status: "approved",
			}),
		);
		mocks.weightRepository.upsert.mockResolvedValue(
			success({
				reading: {
					id: "w1",
					chatId: 1,
					day: romeDay(now),
					grams: 3400,
					userId: 1,
					userName: "dad",
					createdAt: now,
				},
				overwritten: false,
			}),
		);
		await pesoCommand(1, 1, "dad", "3400", now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"⚖️ Today's weight: 3400 g",
		);
	});

	it("shows the history when called with no argument", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.weightRepository.list.mockResolvedValue(
			success([
				{
					id: "w1",
					chatId: 1,
					day: "2026-07-01",
					grams: 3200,
					userId: 1,
					userName: "papà",
					createdAt: new Date("2026-07-01T09:00:00Z"),
				},
			]),
		);
		await pesoCommand(1, 1, "papà", "", new Date())(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("⚖️ Peso");
		expect(text).toContain("3200 g");
	});
});

describe("[COMMANDS] /scaletta", () => {
	it("HELP_TEXT lists the /scaletta command", () => {
		expect(HELP_TEXT).toContain("/scaletta");
	});

	it("sends today's events as an HTML timeline", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(
			success([
				feed("2026-07-02T08:00:00+02:00", "2026-07-02T08:30:00+02:00", "dx"),
			]),
		);
		await scalettaCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		const call = mocks.bot.sendMessage.mock.calls[0];
		const text = call?.[1] ?? "";
		expect(text).toContain("Scaletta di oggi");
		expect(text).toContain("8:00→8:30");
		expect(call?.[2]).toEqual({ parseMode: "HTML" });
		// today's window: [start of day, now)
		const listCall = mocks.eventRepository.listSince.mock.calls[0];
		expect(listCall?.[1]?.toISOString()).toBe(
			new Date("2026-07-02T00:00:00+02:00").toISOString(),
		);
		expect(listCall?.[2]?.toISOString()).toBe(
			new Date("2026-07-02T12:00:00+02:00").toISOString(),
		);
	});

	it("reports an internal error when the query fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(error(new Error("boom")));
		await scalettaCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Errore interno, riprova.",
		);
	});
});

describe("[COMMANDS] graficiCommand", () => {
	it("sends a link button to the Mini App with the chat id in startapp", async () => {
		const { mocks, env } = makeTestEnv();
		mocks.bot.sendLinkButton.mockResolvedValue();
		await graficiCommand(-100999, "https://t.me/Bot/app")(env);
		expect(mocks.bot.sendLinkButton).toHaveBeenCalledWith(
			-100999,
			expect.any(String),
			expect.any(String),
			"https://t.me/Bot/app?startapp=-100999",
		);
	});
});

describe("[COMMANDS] /report", () => {
	it("HELP_TEXT documents the /report command", () => {
		expect(HELP_TEXT).toContain("/report on|off");
	});
});

describe("[COMMANDS] guidaCommand", () => {
	it("sends a link button to the visual guide page", async () => {
		const { mocks, env } = makeTestEnv();
		mocks.bot.sendLinkButton.mockResolvedValue();
		await guidaCommand(-100999, "https://ex.com/guida.html")(env);
		expect(mocks.bot.sendLinkButton).toHaveBeenCalledWith(
			-100999,
			expect.any(String),
			expect.any(String),
			"https://ex.com/guida.html",
		);
	});

	it("HELP_TEXT documents the /guida command", () => {
		expect(HELP_TEXT).toContain("/guida");
	});
});
