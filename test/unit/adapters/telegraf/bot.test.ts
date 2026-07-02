import type { Telegraf } from "telegraf";
import { describe, expect, it, vi } from "vitest";
import { makeTelegrafAdapter } from "../../../../src/adapters/telegraf/bot.js";

const config = {
	botToken: "b",
	allowedChatId: 1,
	databaseUrl: "d",
	geminiApiKey: "k",
	geminiModel: "m",
	cronSecret: "c",
	webhookUrl: "w",
	webhookSecret: "whs",
};
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
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await botEnv.bot.react(1, 100, "👍");
		expect(telegram.setMessageReaction).toHaveBeenCalledWith(1, 100, [
			{ type: "emoji", emoji: "👍" },
		]);
	});

	it("sendConfirmation builds conf:/ann: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
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

	it("clearKeyboard removes the markup and swallows 'not modified'", async () => {
		const { Ctor, telegram } = makeFake();
		telegram.editMessageReplyMarkup.mockRejectedValueOnce(
			new Error("Bad Request: message is not modified"),
		);
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await expect(botEnv.bot.clearKeyboard(1, 100)).resolves.toBeUndefined();
	});

	it("the allow-list middleware skips other chats and passes the allowed chat", async () => {
		const { Ctor, use } = makeFake();
		makeTelegrafAdapter(Ctor)({ config, logger });
		const middleware = use.mock.calls[0]?.[0] as (
			ctx: { chat?: { id: number } },
			next: () => Promise<void>,
		) => Promise<void>;
		const next = vi.fn().mockResolvedValue(undefined);
		await middleware({ chat: { id: 999 } }, next);
		expect(next).not.toHaveBeenCalled();
		await middleware({ chat: { id: 1 } }, next);
		expect(next).toHaveBeenCalledTimes(1);
	});
});
