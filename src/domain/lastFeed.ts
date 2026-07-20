import type { BotEnv } from "./bot.js";
import type { ChatConfigEnv, ChatLanguage } from "./chatConfig.js";
import { type BabyEvent, type EventEnv, SIDE_LABEL } from "./event.js";
import { chatLanguage, internalError, sideLabel } from "./i18n.js";
import type { LoggerEnv } from "./logger.js";
import { formatDuration, hhmm } from "./time.js";

const INTERNAL_ERROR = "Errore interno, riprova.";
const NO_FEED = "Non ho ancora registrato una poppata con un seno.";
const NO_FEED_EN = "I haven't recorded a feed with a breast side yet.";

/** Matches a query word immediately before seno/tetta on normalized text. */
export const LAST_FEED_QUERY =
	/\b(?:(che|quale|qual|ultimo|ultima)\s+(seno|tetta)|(which|last)\s+(breast|side))\b/;

/** Compact suffix for the side prompt. Empty when there's no prior feed. */
export const lastFeedHint = (
	feed: BabyEvent | null,
	now: Date,
	language: ChatLanguage = "it",
): string => {
	if (!feed?.side) return "";
	const side =
		language === "it" ? SIDE_LABEL[feed.side] : sideLabel(feed.side, language);
	if (feed.endedAt) {
		const ago = formatDuration(now.getTime() - feed.endedAt.getTime());
		return language === "it"
			? ` (ultima: ${side}, ${ago} fa)`
			: ` (last: ${side}, ${ago} ago)`;
	}
	return language === "it"
		? ` (ultima: ${side}, in corso)`
		: ` (last: ${side}, ongoing)`;
};

/** One-line answer for the /seno command and the keyword. */
export const formatLastFeed = (
	feed: BabyEvent | null,
	now: Date,
	language: ChatLanguage = "it",
): string => {
	if (!feed?.side) return language === "it" ? NO_FEED : NO_FEED_EN;
	const side =
		language === "it" ? SIDE_LABEL[feed.side] : sideLabel(feed.side, language);
	if (feed.endedAt) {
		const ago = formatDuration(now.getTime() - feed.endedAt.getTime());
		return language === "it"
			? `Ultima poppata: seno ${side} — finita alle ${hhmm(feed.endedAt)} (${ago} fa)`
			: `Latest feed: ${side} breast — ended at ${hhmm(feed.endedAt)} (${ago} ago)`;
	}
	return language === "it"
		? `Poppata in corso: seno ${side} — iniziata alle ${hhmm(feed.startedAt)}`
		: `Feed in progress: ${side} breast — started at ${hhmm(feed.startedAt)}`;
};

/** Fetch the last feed and send the formatted answer. */
export const answerLastFeed =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const res = await env.eventRepository.findLastFeed(chatId);
		if (!res.success) {
			env.logger.error("findLastFeed failed", res.error);
			await env.bot.sendMessage(
				chatId,
				language === "it" ? INTERNAL_ERROR : internalError(language),
			);
			return;
		}
		await env.bot.sendMessage(chatId, formatLastFeed(res.data, now, language));
	};
