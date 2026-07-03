import type { BotEnv } from "./bot.js";
import { type BabyEvent, type EventEnv, SIDE_LABEL } from "./event.js";
import type { LoggerEnv } from "./logger.js";
import { formatDuration, hhmm } from "./time.js";

const INTERNAL_ERROR = "Errore interno, riprova.";
const NO_FEED = "Non ho ancora registrato una poppata con un seno.";

/** Matches a query word immediately before seno/tetta on normalized text. */
export const LAST_FEED_QUERY = /\b(che|quale|qual|ultimo|ultima)\s+(seno|tetta)\b/;

/** Compact suffix for the side prompt. Empty when there's no prior feed. */
export const lastFeedHint = (feed: BabyEvent | null, now: Date): string => {
	if (!feed?.side) return "";
	const side = SIDE_LABEL[feed.side];
	if (feed.endedAt) {
		const ago = formatDuration(now.getTime() - feed.endedAt.getTime());
		return ` (ultima: ${side}, ${ago} fa)`;
	}
	return ` (ultima: ${side}, in corso)`;
};

/** One-line answer for the /seno command and the keyword. */
export const formatLastFeed = (feed: BabyEvent | null, now: Date): string => {
	if (!feed?.side) return NO_FEED;
	const side = SIDE_LABEL[feed.side];
	if (feed.endedAt) {
		const ago = formatDuration(now.getTime() - feed.endedAt.getTime());
		return `Ultima poppata: seno ${side} — finita alle ${hhmm(feed.endedAt)} (${ago} fa)`;
	}
	return `Poppata in corso: seno ${side} — iniziata alle ${hhmm(feed.startedAt)}`;
};

/** Fetch the last feed and send the formatted answer. */
export const answerLastFeed =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const res = await env.eventRepository.findLastFeed(chatId);
		if (!res.success) {
			env.logger.error("findLastFeed failed", res.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(chatId, formatLastFeed(res.data, now));
	};
