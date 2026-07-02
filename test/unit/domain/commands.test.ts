import { describe, expect, it } from "vitest";
import {
	annullaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	sendDailyReport,
	sendWeeklyReport,
	settimanaCommand,
	statoCommand,
} from "../../../src/domain/commands.js";
import type { BabyEvent } from "../../../src/domain/event.js";
import { success } from "../../../src/domain/result.js";
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
