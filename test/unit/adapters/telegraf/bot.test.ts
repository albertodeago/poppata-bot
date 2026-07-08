import type { Telegraf } from "telegraf";
import { describe, expect, it, vi } from "vitest";
import { makeTelegrafAdapter } from "../../../../src/adapters/telegraf/bot.js";
import { success } from "../../../../src/domain/result.js";

const config = {
	botToken: "b",
	databaseUrl: "d",
	geminiApiKey: "k",
	geminiModel: "m",
	cronSecret: "c",
	webhookUrl: "w",
	webhookSecret: "whs",
	miniAppUrl: "https://t.me/Bot/app",
	guideUrl: "https://ex.com/guida.html",
	maxChats: 5,
	repoIssuesUrl: "https://github.com/x/y/issues",
};

const makeChatConfigRepo = () => ({
	get: vi.fn(),
	count: vi.fn(),
	create: vi.fn(),
	setBabyName: vi.fn(),
	setReportsEnabled: vi.fn(),
	listAll: vi.fn(),
});
const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const makeFake = () => {
	const telegram = {
		sendMessage: vi.fn().mockResolvedValue({}),
		setMessageReaction: vi.fn().mockResolvedValue(true),
		answerCbQuery: vi.fn().mockResolvedValue(true),
		editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
	};
	const use = vi.fn();
	// biome-ignore lint/suspicious/noExplicitAny: minimal Telegraf test double
	const Ctor = vi.fn(function (this: any) {
		this.telegram = telegram;
		this.use = use;
	});
	return { Ctor: Ctor as unknown as typeof Telegraf, telegram, use };
};

describe("[TELEGRAF adapter]", () => {
	it("react calls setMessageReaction with an emoji reaction", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({
			config,
			logger,
			chatConfigRepository: makeChatConfigRepo(),
		});
		await botEnv.bot.react(1, 100, "👍");
		expect(telegram.setMessageReaction).toHaveBeenCalledWith(1, 100, [
			{ type: "emoji", emoji: "👍" },
		]);
	});

	it("sendConfirmation builds conf:/ann: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({
			config,
			logger,
			chatConfigRepository: makeChatConfigRepo(),
		});
		await botEnv.bot.sendConfirmation(1, "Confermi?", "p1");
		expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Confermi?", {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Conferma", callback_data: "conf:p1" },
						{ text: "Annulla", callback_data: "ann:p1" },
					],
				],
			},
		});
	});

	it("sendSidePrompt builds sx:/dx: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({
			config,
			logger,
			chatConfigRepository: makeChatConfigRepo(),
		});
		await botEnv.bot.sendSidePrompt(1, "Per quale seno? 🤱", "p1");
		expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Per quale seno? 🤱", {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Sinistro", callback_data: "sx:p1" },
						{ text: "Destro", callback_data: "dx:p1" },
					],
				],
			},
		});
	});

	it("sendTypePrompt builds eat:/sleep: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({
			config,
			logger,
			chatConfigRepository: makeChatConfigRepo(),
		});
		await botEnv.bot.sendTypePrompt(1, "Poppata o nanna? 🍼", "p1");
		expect(telegram.sendMessage).toHaveBeenCalledWith(
			1,
			"Poppata o nanna? 🍼",
			{
				reply_markup: {
					inline_keyboard: [
						[
							{ text: "Poppata", callback_data: "eat:p1" },
							{ text: "Nanna", callback_data: "sleep:p1" },
						],
					],
				},
			},
		);
	});

	it("clearKeyboard removes the markup and swallows 'not modified'", async () => {
		const { Ctor, telegram } = makeFake();
		telegram.editMessageReplyMarkup.mockRejectedValueOnce(
			new Error("Bad Request: message is not modified"),
		);
		const { botEnv } = makeTelegrafAdapter(Ctor)({
			config,
			logger,
			chatConfigRepository: makeChatConfigRepo(),
		});
		await expect(botEnv.bot.clearKeyboard(1, 100)).resolves.toBeUndefined();
	});

	// biome-ignore lint/suspicious/noExplicitAny: hand-rolled ctx doubles
	type Ctx = any;
	const getMiddleware = () => {
		const { Ctor, use } = makeFake();
		const chatConfigRepository = makeChatConfigRepo();
		makeTelegrafAdapter(Ctor)({ config, logger, chatConfigRepository });
		const middleware = use.mock.calls[0]?.[0] as (
			ctx: Ctx,
			next: () => Promise<void>,
		) => Promise<void>;
		return { middleware, chatConfigRepository };
	};

	it("gate passes /start and /help from any chat without a DB lookup", async () => {
		const { middleware, chatConfigRepository } = getMiddleware();
		const next = vi.fn().mockResolvedValue(undefined);
		await middleware(
			{ chat: { id: 5 }, updateType: "message", message: { text: "/start" } },
			next,
		);
		await middleware(
			{ chat: { id: 6 }, updateType: "message", message: { text: "/help" } },
			next,
		);
		expect(next).toHaveBeenCalledTimes(2);
		expect(chatConfigRepository.get).not.toHaveBeenCalled();
	});

	it("gate passes my_chat_member (add) from an unregistered chat", async () => {
		const { middleware, chatConfigRepository } = getMiddleware();
		const next = vi.fn().mockResolvedValue(undefined);
		await middleware({ chat: { id: 6 }, updateType: "my_chat_member" }, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(chatConfigRepository.get).not.toHaveBeenCalled();
	});

	it("gate drops normal text from an unregistered chat", async () => {
		const { middleware, chatConfigRepository } = getMiddleware();
		chatConfigRepository.get.mockResolvedValue(success(null));
		const next = vi.fn().mockResolvedValue(undefined);
		await middleware(
			{
				chat: { id: 7 },
				updateType: "message",
				message: { text: "poppata dx" },
			},
			next,
		);
		expect(next).not.toHaveBeenCalled();
	});

	it("gate passes normal text from a registered chat", async () => {
		const { middleware, chatConfigRepository } = getMiddleware();
		chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 7, reportsEnabled: true }),
		);
		const next = vi.fn().mockResolvedValue(undefined);
		await middleware(
			{
				chat: { id: 7 },
				updateType: "message",
				message: { text: "poppata dx" },
			},
			next,
		);
		expect(next).toHaveBeenCalledTimes(1);
	});
});
