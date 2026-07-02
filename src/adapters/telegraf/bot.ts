import { Telegraf } from "telegraf";
import type { ReactionTypeEmoji } from "telegraf/types";
import type { ConfigEnv } from "../../config.js";
import type { BotEnv } from "../../domain/bot.js";
import type { LoggerEnv } from "../../domain/logger.js";

export interface TelegrafAdapter {
	instance: Telegraf;
	botEnv: BotEnv;
}

export const makeTelegrafAdapter =
	(telegraf = Telegraf) =>
	(env: ConfigEnv & LoggerEnv): TelegrafAdapter => {
		const bot = new telegraf(env.config.botToken);

		// Serve only the allow-listed chat(s).
		bot.use(async (ctx, next) => {
			const chatId = ctx.chat?.id;
			if (chatId !== undefined && !env.config.allowedChatIds.includes(chatId)) {
				env.logger.info(`Ignoring update from chat ${chatId}`);
				return;
			}
			return next();
		});

		const botEnv: BotEnv = {
			bot: {
				sendMessage: async (chatId, text) => {
					await bot.telegram.sendMessage(chatId, text);
				},
				react: async (chatId, messageId, emoji) => {
					const reaction: ReactionTypeEmoji[] = [
						{ type: "emoji", emoji: emoji as ReactionTypeEmoji["emoji"] },
					];
					await bot.telegram.setMessageReaction(chatId, messageId, reaction);
				},
				sendConfirmation: async (chatId, text, pendingId) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: "Conferma", callback_data: `conf:${pendingId}` },
									{ text: "Annulla", callback_data: `ann:${pendingId}` },
								],
							],
						},
					});
				},
				answerCallback: async (callbackId, text) => {
					await bot.telegram.answerCbQuery(callbackId, text);
				},
				clearKeyboard: async (chatId, messageId) => {
					try {
						await bot.telegram.editMessageReplyMarkup(
							chatId,
							messageId,
							undefined,
							undefined,
						);
					} catch (e) {
						if (
							e instanceof Error &&
							e.message.includes("message is not modified")
						) {
							return;
						}
						throw e;
					}
				},
			},
		};

		env.logger.info("Telegraf adapter initialized");
		return { instance: bot, botEnv };
	};
