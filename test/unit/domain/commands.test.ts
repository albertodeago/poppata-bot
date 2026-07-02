import { describe, expect, it } from "vitest";
import {
	annullaCommand,
	helpCommand,
	statoCommand,
} from "../../../src/domain/commands";
import type { BabyEvent } from "../../../src/domain/event";
import { success } from "../../../src/domain/result";
import { makeTestEnv } from "../testEnv";

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
