import { describe, expect, it } from "vitest";
import { handleCallback, handleMessage } from "../../../src/domain/bot.js";
import type { BabyEvent } from "../../../src/domain/event.js";
import type { PendingConfirmation } from "../../../src/domain/pending.js";
import { success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

const msg = (text: string, at = new Date("2026-07-02T09:30:00+02:00")) => ({
	chatId: 1,
	userId: 1,
	userName: "papà",
	text,
	messageId: 100,
	at,
});

const openEat: BabyEvent = {
	id: "s1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	startedAt: new Date("2026-07-02T09:00:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9",
	messageId: 1,
	createdAt: new Date("2026-07-02T09:00:00+02:00"),
};

describe("[BOT] handleMessage", () => {
	it("saves a new feed and reacts 👍", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio poppata dx 9.15"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		const inserted = mocks.eventRepository.insert.mock.calls[0]?.[0];
		expect(inserted?.type).toBe("eat");
		expect(inserted?.side).toBe("dx");
		expect(mocks.bot.react).toHaveBeenCalledWith(1, 100, "👍");
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});

	it("closes the open feed on 'fine' and replies with the duration", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.eventRepository.closeSession.mockImplementation(
			async (_id, endedAt) => success({ ...openEat, endedAt }),
		);

		await handleMessage(msg("fine 9.40"))(env);

		expect(mocks.eventRepository.closeSession).toHaveBeenCalledWith(
			"s1",
			new Date("2026-07-02T09:40:00+02:00"),
		);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("durata poppata");
		expect(text).toContain("40m");
		expect(mocks.bot.react).not.toHaveBeenCalled();
	});

	it("asks to confirm when starting while a session is open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p1", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio nanna 10"))(env);

		expect(mocks.pendingRepository.create).toHaveBeenCalledTimes(1);
		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("aperta"),
			"p1",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("reports 'no open session' on a bare 'fine' with nothing open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));

		await handleMessage(msg("fine"))(env);

		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nessuna sessione aperta da chiudere.",
		);
	});

	it("sends the help hint when nothing parses (rules + gemini both empty)", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.parser.parse.mockResolvedValue(success(null));

		await handleMessage(msg("ciao come stai"))(env);

		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("/help");
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("announces the assumed start time when a start has no explicit time", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		// "nanna" with no time → starts at the message arrival time (09:30)
		await handleMessage(msg("nanna"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Nanna iniziata alle 9:30");
		expect(mocks.bot.react).not.toHaveBeenCalled();
	});

	it("asks for the side when a feed start has no side (no time)", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.stringContaining("seno"),
			"ps1",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("asks for the side when a feed start has a time but no side", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps2", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio poppata 9.15"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"ps2",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("echoes the side when a feed start gives a side but no time", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata dx"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.side).toBe("dx");
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toBe("Poppata iniziata alle 9:30 — seno destro");
		expect(mocks.bot.sendSidePrompt).not.toHaveBeenCalled();
	});

	it("confirms-to-save a low-confidence Gemini parse", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.parser.parse.mockResolvedValue(
			success({ type: "poop", action: "instant", confidence: 0.4 }),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p2", createdAt: new Date() }),
		);

		await handleMessage(msg("credo abbia sporcato il pannolino"))(env);

		expect(mocks.pendingRepository.create).toHaveBeenCalledTimes(1);
		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"p2",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("shows the side as destro/sinistro in confirm copy", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.parser.parse.mockResolvedValue(
			success({ type: "eat", action: "start", side: "dx", confidence: 0.4 }),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p9", createdAt: new Date() }),
		);

		await handleMessage(msg("non capisco"))(env);

		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("destro"),
			"p9",
		);
	});

	it("answers the last-breast keyword without saving an event", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "eat",
				side: "dx",
				startedAt: new Date("2026-07-02T07:00:00+02:00"),
				endedAt: new Date("2026-07-02T07:20:00+02:00"),
				source: "rules",
				rawText: "poppata dx",
				messageId: 1,
				createdAt: new Date("2026-07-02T07:20:00+02:00"),
			}),
		);

		await handleMessage(msg("che seno?"))(env);

		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Ultima poppata: seno destro");
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.parser.parse).not.toHaveBeenCalled();
	});

	it("recognizes the bare 'annulla' keyword and removes the last event", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.deleteLast.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "pee",
				startedAt: new Date("2026-07-02T09:00:00+02:00"),
				source: "rules",
				rawText: "pipì",
				messageId: 1,
				createdAt: new Date("2026-07-02T09:00:00+02:00"),
			}),
		);

		await handleMessage(msg("Annulla!"))(env);

		expect(mocks.eventRepository.deleteLast).toHaveBeenCalledWith(1);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Rimosso");
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.parser.parse).not.toHaveBeenCalled();
	});

	it("appends the last-side hint to the side prompt", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "eat",
				side: "dx",
				startedAt: new Date("2026-07-02T07:00:00+02:00"),
				endedAt: new Date("2026-07-02T07:20:00+02:00"),
				source: "rules",
				rawText: "poppata dx",
				messageId: 1,
				createdAt: new Date("2026-07-02T07:20:00+02:00"),
			}),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		const text = mocks.bot.sendSidePrompt.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Per quale seno?");
		expect(text).toContain("(ultima: destro");
	});

	it("omits the hint when there is no prior feed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			"Per quale seno? 🤱",
			"ps1",
		);
	});

	it("still prompts when the last-feed lookup fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue({
			success: false,
			error: new Error("db down"),
		});
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			"Per quale seno? 🤱",
			"ps1",
		);
	});

	it("asks poppata vs nanna for a typeless start", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pt1", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio"))(env);

		expect(mocks.bot.sendTypePrompt).toHaveBeenCalledWith(
			1,
			"Poppata o nanna? 🍼",
			"pt1",
		);
		expect(mocks.parser.parse).not.toHaveBeenCalled();
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});

	it("preserves a given time into the type prompt intent", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pt2", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio 9.15"))(env);

		const created = mocks.pendingRepository.create.mock.calls[0]?.[0];
		expect(created?.intent.at).toEqual(new Date("2026-07-02T09:15:00+02:00"));
		expect(created?.intent.action).toBe("start");
	});
});

const pending = (over: Partial<PendingConfirmation>): PendingConfirmation => ({
	id: "p1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	rawText: "credo abbia sporcato il pannolino",
	intent: {
		type: "poop",
		action: "instant",
		at: new Date("2026-07-02T09:15:00+02:00"),
		source: "gemini",
		confidence: 0.4,
	},
	warning: "Ho capito: cacca alle 9:15. Confermi?",
	messageId: 100,
	createdAt: new Date(),
	...over,
});

describe("[BOT] handleCallback", () => {
	const cb = (data: string) => ({
		id: "cbq",
		chatId: 1,
		userId: 1,
		userName: "papà",
		data,
		messageId: 200,
		at: new Date("2026-07-02T09:30:00+02:00"),
	});

	it("confirm applies the intent, reacts, clears keyboard, deletes pending", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(success(pending({})));
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.rawText).toBe(
			"credo abbia sporcato il pannolino",
		);
		expect(mocks.bot.react).toHaveBeenCalledWith(1, 100, "👍"); // original message
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.answerCallback).toHaveBeenCalled();
	});

	it("confirming a sleep start replies with the started-text line", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(
				pending({
					rawText: "nanna",
					intent: {
						type: "sleep",
						action: "start",
						at: new Date("2026-07-02T09:15:00+02:00"),
						source: "gemini",
						confidence: 0.4,
					},
					warning: "Ho capito: nanna inizio 9:15. Confermi?",
				}),
			),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.type).toBe("sleep");
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nanna iniziata alle 9:15 ✅",
		);
		expect(mocks.bot.react).not.toHaveBeenCalled();
	});

	it("confirm of an 'end' intent replies with the duration", async () => {
		const { env, mocks } = makeTestEnv();
		const openEatLocal = { ...openEat };
		mocks.pendingRepository.get.mockResolvedValue(
			success(
				pending({
					intent: {
						type: "eat",
						action: "end",
						at: new Date("2026-07-02T11:00:00+02:00"),
						source: "rules",
						confidence: 1,
					},
					warning: "Durata poppata sospetta: 2h. Salvare comunque?",
				}),
			),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(
			success(openEatLocal),
		);
		mocks.eventRepository.closeSession.mockImplementation(
			async (_id, endedAt) => success({ ...openEatLocal, endedAt }),
		);

		await handleCallback(cb("conf:p1"))(env);

		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("durata poppata");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});

	it("annulla deletes the pending and clears the keyboard without saving", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(success(pending({})));
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));

		await handleCallback(cb("ann:p1"))(env);

		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.bot.answerCallback).toHaveBeenCalledWith("cbq", "Annullato");
	});

	it("handles a stale/unknown pending id gracefully", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(success(null));

		await handleCallback(cb("conf:gone"))(env);

		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.bot.answerCallback).toHaveBeenCalled();
	});

	it("treats a tap more than 15 minutes after creation as expired", async () => {
		const { env, mocks } = makeTestEnv();
		// tapped at 09:30, created at 09:10 → 20 minutes old
		mocks.pendingRepository.get.mockResolvedValue(
			success(pending({ createdAt: new Date("2026-07-02T09:10:00+02:00") })),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		const warnText = mocks.bot.answerCallback.mock.calls[0]?.[1] ?? "";
		expect(warnText).toMatch(/scaduto/i);
	});

	const feedStartPending = (id: string): PendingConfirmation =>
		pending({
			id,
			rawText: "poppata",
			intent: {
				type: "eat",
				action: "start",
				at: new Date("2026-07-02T09:15:00+02:00"),
				source: "rules",
				confidence: 1,
			},
			warning: "Per quale seno? 🤱",
		});

	const typePromptPending = (id: string): PendingConfirmation =>
		pending({
			id,
			rawText: "inizio",
			intent: {
				type: "sleep", // placeholder — the verb overwrites it
				action: "start",
				at: new Date("2026-07-02T09:15:00+02:00"),
				source: "rules",
				confidence: 1,
			},
			warning: "Poppata o nanna? 🍼",
		});

	it("dx button fills the side, saves the feed, and confirms", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(feedStartPending("ps1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("dx:ps1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.side).toBe("dx");
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("seno destro");
		expect(text).toContain("✅");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("ps1");
		expect(mocks.bot.answerCallback).toHaveBeenCalled();
	});

	it("confirming a sideless feed start asks for the side instead of saving", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(feedStartPending("p1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps2", createdAt: new Date() }),
		);
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"ps2",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});

	it("nanna button saves a sleep start and confirms", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("sleep:pt1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.type).toBe("sleep");
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Nanna iniziata");
		expect(text).toContain("✅");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
		expect(mocks.bot.sendSidePrompt).not.toHaveBeenCalled();
	});

	it("poppata button chains into the side prompt", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps9", createdAt: new Date() }),
		);
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));

		await handleCallback(cb("eat:pt1"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"ps9",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});

	it("nanna button asks to confirm when a session is already open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pc1", createdAt: new Date() }),
		);
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));

		await handleCallback(cb("sleep:pt1"))(env);

		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("aperta"),
			"pc1",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});

	it("poppata button asks to confirm when a session is already open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pc2", createdAt: new Date() }),
		);
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));

		await handleCallback(cb("eat:pt1"))(env);

		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("aperta"),
			"pc2",
		);
		expect(mocks.bot.sendSidePrompt).not.toHaveBeenCalled();
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
	});

	it("confirming the close ends the open session and starts the new one", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(
				pending({
					rawText: "inizio",
					intent: {
						type: "sleep",
						action: "start",
						at: new Date("2026-07-02T09:15:00+02:00"),
						source: "rules",
						confidence: 1,
					},
					warning:
						"C'è già una poppata aperta dalle 9:00. Chiuderla alle 9:15 e iniziare nanna?",
				}),
			),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.eventRepository.closeSession.mockImplementation(async (_id, endedAt) =>
			success({ ...openEat, endedAt }),
		);
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.closeSession).toHaveBeenCalledWith(
			"s1",
			new Date("2026-07-02T09:15:00+02:00"),
		);
		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.type).toBe("sleep");
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nanna iniziata alle 9:15 ✅",
		);
	});
});
