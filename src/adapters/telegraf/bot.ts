import { Telegraf } from "telegraf";
import type { ReactionTypeEmoji } from "telegraf/types";
import type { ConfigEnv } from "../../config.js";
import type { BotEnv } from "../../domain/bot.js";
import type { ChatConfigEnv } from "../../domain/chatConfig.js";
import type { LoggerEnv } from "../../domain/logger.js";

export interface TelegrafAdapter {
	instance: Telegraf;
	botEnv: BotEnv;
}

export const makeTelegrafAdapter =
	(telegraf = Telegraf) =>
	(env: ConfigEnv & LoggerEnv & ChatConfigEnv): TelegrafAdapter => {
		const bot = new telegraf(env.config.botToken);

		// Registration gate: a chat is served once it has a chat_configs row. The
		// entry points that can CREATE that row (/start, /help, and the
		// my_chat_member add-event) always pass; everything else from an
		// unregistered chat is dropped before it can parse text or call Gemini.
		bot.use(async (ctx, next) => {
			const chatId = ctx.chat?.id;
			if (chatId === undefined) return next();

			const msg = ctx.message;
			const text = msg && "text" in msg ? msg.text : undefined;
			const isEntry =
				ctx.updateType === "my_chat_member" ||
				(typeof text === "string" &&
					(text.startsWith("/start") || text.startsWith("/help")));
			if (isEntry) return next();

			const reg = await env.chatConfigRepository.get(chatId);
			if (!reg.success || !reg.data) {
				env.logger.info(`Ignoring update from unregistered chat ${chatId}`);
				return;
			}
			return next();
		});

		const botEnv: BotEnv = {
			bot: {
				sendMessage: async (chatId, text, opts) => {
					await bot.telegram.sendMessage(
						chatId,
						text,
						opts?.parseMode ? { parse_mode: opts.parseMode } : undefined,
					);
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
				sendSidePrompt: async (chatId, text, pendingId) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: "Sinistro", callback_data: `sx:${pendingId}` },
									{ text: "Destro", callback_data: `dx:${pendingId}` },
								],
							],
						},
					});
				},
				sendTypePrompt: async (chatId, text, pendingId) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: "Poppata", callback_data: `eat:${pendingId}` },
									{ text: "Nanna", callback_data: `sleep:${pendingId}` },
								],
							],
						},
					});
				},
				sendFeedTypePrompt: async (chatId, text, pendingId) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: "🍼 Poppata", callback_data: `eat:${pendingId}` },
									{ text: "🥛 Biberon", callback_data: `bottle:${pendingId}` },
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
