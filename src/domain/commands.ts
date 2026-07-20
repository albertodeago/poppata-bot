import type { BotEnv } from "./bot.js";
import type { ChatConfigEnv, ChatLanguage } from "./chatConfig.js";
import type { EventEnv } from "./event.js";
import { chatLanguage, eventLabel, internalError } from "./i18n.js";
import { answerLastFeed } from "./lastFeed.js";
import type { LoggerEnv } from "./logger.js";
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
	formatSchedule,
	formatWeekly,
} from "./report.js";
import {
	currentDayWindow,
	currentWeekWindow,
	formatDuration,
	hhmm,
	previousDayWindow,
	previousWeekWindow,
	romeDay,
	romeNow,
	type TimeWindow,
} from "./time.js";
import { formatHistory, parseGrams, type WeightEnv } from "./weight.js";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const PESO_USAGE = "Usa /peso 3400 (peso in grammi).";
const WEIGHT_USAGE_EN = "Use /weight 3400 (weight in grams).";

const HELP_TEXT_IT = [
	"👶 <b>poppata-bot</b>",
	"",
	"<b>Da scrivere in chat</b>",
	"🍼 poppata dx 9.15 — inizio (dx/sx; se manca te lo chiedo)",
	"⏹️ fine 9.40 — chiude poppata o nanna aperta",
	"😴 nanna 10 — inizio nanna",
	'🥛 biberon 100 — latte artificiale in ml (o "bibe" e ti chiedo i ml)',
	"💧 pipì · 💩 cacca — eventi istantanei",
	"",
	"<b>Comandi</b>",
	"/stato — sessione in corso",
	"/oggi · /ieri · /settimana — statistiche",
	"/scaletta — la giornata evento per evento",
	'/annulla — annulla l\'ultimo evento (o scrivi "annulla")',
	'/seno — ultimo seno usato (o scrivi "che seno?")',
	"/peso 3400 — registra il peso; /peso mostra lo storico",
	"/nome Mario — imposta il nome del bimbo/a",
	"/lingua it|en — cambia lingua del bot",
	"/report on|off — attiva/disattiva i report automatici",
	"/guida — guida visuale al bot",
	"/help — questo messaggio",
].join("\n");

const HELP_TEXT_EN = [
	"👶 <b>poppata-bot</b>",
	"",
	"<b>Write in chat</b>",
	"🍼 feed right 9.15 — starts a feed (right/left; I ask if missing)",
	"⏹️ end 9.40 — closes the open feed or sleep session",
	"😴 sleep 10 — starts sleep",
	'🥛 bottle 100 — formula in ml (or "bottle" and I ask for ml)',
	"💧 pee · 💩 poop — instant events",
	"",
	"<b>Commands</b>",
	"/status — current open session",
	"/today · /yesterday · /week — statistics",
	"/schedule — today event by event",
	'/undo — remove the latest event (or write "undo")',
	'/breast — latest breast side used (or write "which breast?")',
	"/weight 3400 — record weight; /weight shows history",
	"/name Mario — set the baby name",
	"/language it|en — change bot language",
	"/report on|off — enable/disable automatic reports",
	"/guide — visual guide to the bot",
	"/help — this message",
].join("\n");

export const helpText = (language: ChatLanguage): string =>
	language === "it" ? HELP_TEXT_IT : HELP_TEXT_EN;

export const HELP_TEXT = HELP_TEXT_IT;

export const senoCommand = answerLastFeed;

export const statoCommand =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const openRes = await env.eventRepository.findOpenSession(chatId);
		if (!openRes.success) {
			env.logger.error("stato: findOpenSession failed", openRes.error);
			await env.bot.sendMessage(chatId, internalError(language));
			return;
		}
		const open = openRes.data;
		if (!open) {
			await env.bot.sendMessage(
				chatId,
				language === "it" ? "Nessuna sessione aperta." : "No open session.",
			);
			return;
		}
		const elapsed = formatDuration(now.getTime() - open.startedAt.getTime());
		const label = eventLabel(open.type, language);
		await env.bot.sendMessage(
			chatId,
			language === "it"
				? `${cap(label)} in corso da ${hhmm(open.startedAt)} (${elapsed})`
				: `${cap(label)} in progress since ${hhmm(open.startedAt)} (${elapsed})`,
		);
	};

export const scalettaCommand =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const window = currentDayWindow(romeNow(now));
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("scaletta: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, internalError(language));
			return;
		}
		await env.bot.sendMessage(
			chatId,
			formatSchedule(evs.data, window, language),
			{
				parseMode: "HTML",
			},
		);
	};

/** Matches a bare "annulla" message (the /annulla command without the slash). */
export const ANNULLA_QUERY = /^(annulla|undo)[!.?]*$/;

export const annullaCommand =
	(chatId: number) =>
	async (env: EventEnv & BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const r = await env.eventRepository.deleteLast(chatId);
		if (!r.success) {
			env.logger.error("annulla: deleteLast failed", r.error);
			await env.bot.sendMessage(chatId, internalError(language));
			return;
		}
		if (!r.data) {
			await env.bot.sendMessage(
				chatId,
				language === "it" ? "Niente da annullare." : "Nothing to undo.",
			);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			language === "it"
				? `Rimosso: ${eventLabel(r.data.type, language)} delle ${hhmm(r.data.startedAt)}`
				: `Removed: ${eventLabel(r.data.type, language)} at ${hhmm(r.data.startedAt)}`,
		);
	};

export const pesoCommand =
	(chatId: number, userId: number, userName: string, arg: string, now: Date) =>
	async (
		env: WeightEnv & BotEnv & ChatConfigEnv & LoggerEnv,
	): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const trimmed = arg.trim();
		if (trimmed === "") {
			const res = await env.weightRepository.list(chatId);
			if (!res.success) {
				env.logger.error("peso: list failed", res.error);
				await env.bot.sendMessage(chatId, internalError(language));
				return;
			}
			await env.bot.sendMessage(chatId, formatHistory(res.data, language));
			return;
		}
		const grams = parseGrams(trimmed);
		if (grams === null) {
			await env.bot.sendMessage(
				chatId,
				language === "it" ? PESO_USAGE : WEIGHT_USAGE_EN,
			);
			return;
		}
		const res = await env.weightRepository.upsert({
			chatId,
			day: romeDay(now),
			grams,
			userId,
			userName,
		});
		if (!res.success) {
			env.logger.error("peso: upsert failed", res.error);
			await env.bot.sendMessage(chatId, internalError(language));
			return;
		}
		const note = res.data.overwritten
			? language === "it"
				? " (aggiornato)"
				: " (updated)"
			: "";
		await env.bot.sendMessage(
			chatId,
			language === "it"
				? `⚖️ Peso di oggi: ${grams} g${note}`
				: `⚖️ Today's weight: ${grams} g${note}`,
		);
	};

export const helpCommand =
	(chatId: number) =>
	async (env: BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		await env.bot.sendMessage(chatId, helpText(language), {
			parseMode: "HTML",
		});
	};

const dailyReport =
	(chatId: number, window: TimeWindow, title: (l: ChatLanguage) => string) =>
	async (env: EventEnv & BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("report: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, internalError(language));
			return;
		}
		await env.bot.sendMessage(
			chatId,
			formatDaily(aggregate(evs.data, window), title(language), language),
		);
	};

const weeklyReport =
	(chatId: number, window: TimeWindow, title: (l: ChatLanguage) => string) =>
	async (env: EventEnv & BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("report: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, internalError(language));
			return;
		}
		await env.bot.sendMessage(
			chatId,
			formatWeekly(
				aggregateWeekly(evs.data, window),
				title(language),
				language,
			),
		);
	};

export const oggiCommand = (chatId: number, now: Date) =>
	dailyReport(chatId, currentDayWindow(romeNow(now)), (l) =>
		l === "it" ? "📊 Oggi" : "📊 Today",
	);

export const ieriCommand = (chatId: number, now: Date) =>
	dailyReport(chatId, previousDayWindow(romeNow(now)), (l) =>
		l === "it" ? "📊 Ieri" : "📊 Yesterday",
	);

export const settimanaCommand = (chatId: number, now: Date) =>
	weeklyReport(chatId, currentWeekWindow(romeNow(now)), (l) =>
		l === "it" ? "📅 Questa settimana" : "📅 This week",
	);

export const sendDailyReport = (chatId: number, now: Date, babyName?: string) =>
	dailyReport(chatId, previousDayWindow(romeNow(now)), (l) =>
		l === "it"
			? babyName
				? `📊 Ieri — ${babyName}`
				: "📊 Ieri"
			: babyName
				? `📊 Yesterday — ${babyName}`
				: "📊 Yesterday",
	);

export const sendWeeklyReport = (
	chatId: number,
	now: Date,
	babyName?: string,
) =>
	weeklyReport(chatId, previousWeekWindow(romeNow(now)), (l) =>
		l === "it"
			? babyName
				? `📅 Settimana scorsa — ${babyName}`
				: "📅 Settimana scorsa"
			: babyName
				? `📅 Last week — ${babyName}`
				: "📅 Last week",
	);

const GRAFICI_TEXT = "📊 Apri le statistiche del bambino";
const GRAFICI_BUTTON = "📊 Apri statistiche";
const CHARTS_TEXT_EN = "📊 Open the baby's statistics";
const CHARTS_BUTTON_EN = "📊 Open stats";

/** Reply with a button that opens the stats Mini App for this chat. */
export const graficiCommand =
	(chatId: number, miniAppUrl: string) =>
	async (env: BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		await env.bot.sendLinkButton(
			chatId,
			language === "it" ? GRAFICI_TEXT : CHARTS_TEXT_EN,
			language === "it" ? GRAFICI_BUTTON : CHARTS_BUTTON_EN,
			`${miniAppUrl}?startapp=${chatId}`,
		);
	};

const GUIDA_TEXT = "📖 Guida visuale: come usare il bot";
const GUIDA_BUTTON = "📖 Apri la guida";
const GUIDE_TEXT_EN = "📖 Visual guide: how to use the bot";
const GUIDE_BUTTON_EN = "📖 Open guide";

/** Reply with a button that opens the visual onboarding guide. */
export const guidaCommand =
	(chatId: number, guideUrl: string) =>
	async (env: BotEnv & ChatConfigEnv & LoggerEnv): Promise<void> => {
		const language = await chatLanguage(env, chatId);
		await env.bot.sendLinkButton(
			chatId,
			language === "it" ? GUIDA_TEXT : GUIDE_TEXT_EN,
			language === "it" ? GUIDA_BUTTON : GUIDE_BUTTON_EN,
			guideUrl,
		);
	};
