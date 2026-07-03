import type { BotEnv } from "./bot.js";
import { type EventEnv, LABEL } from "./event.js";
import { answerLastFeed } from "./lastFeed.js";
import type { LoggerEnv } from "./logger.js";
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
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
const INTERNAL_ERROR = "Errore interno, riprova.";
const PESO_USAGE = "Usa /peso 3400 (peso in grammi).";

export const HELP_TEXT = [
	"👶 poppata-bot — cosa capisco:",
	'• "inizio poppata dx 9.15" — inizio poppata (dx/sx, o destro/sinistro; se manca te lo chiedo) alle 9:15',
	'• "fine 9.40" — chiude la sessione aperta alle 9:40',
	'• "nanna 10" / "fine 10.15" — inizio/fine nanna',
	'• "inizio" — se non dico cosa, mi chiedi se poppata o nanna',
	'• "pipì" / "cacca" — eventi istantanei',
	"",
	"Comandi:",
	"/stato — sessione in corso",
	"/oggi — statistiche di oggi",
	"/ieri — statistiche di ieri",
	"/settimana — statistiche della settimana",
	'/annulla — rimuove l\'ultimo evento (o scrivi "annulla")',
	'/seno — ultimo seno usato (o scrivi "che seno?")',
	'/peso 3400 — registra il peso di oggi (grammi); "/peso" mostra lo storico',
	"/help — questo messaggio",
].join("\n");

export const senoCommand = answerLastFeed;

export const statoCommand =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const openRes = await env.eventRepository.findOpenSession(chatId);
		if (!openRes.success) {
			env.logger.error("stato: findOpenSession failed", openRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const open = openRes.data;
		if (!open) {
			await env.bot.sendMessage(chatId, "Nessuna sessione aperta.");
			return;
		}
		const elapsed = formatDuration(now.getTime() - open.startedAt.getTime());
		await env.bot.sendMessage(
			chatId,
			`${cap(LABEL[open.type])} in corso da ${hhmm(open.startedAt)} (${elapsed})`,
		);
	};

/** Matches a bare "annulla" message (the /annulla command without the slash). */
export const ANNULLA_QUERY = /^annulla[!.?]*$/;

export const annullaCommand =
	(chatId: number) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const r = await env.eventRepository.deleteLast(chatId);
		if (!r.success) {
			env.logger.error("annulla: deleteLast failed", r.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		if (!r.data) {
			await env.bot.sendMessage(chatId, "Niente da annullare.");
			return;
		}
		await env.bot.sendMessage(
			chatId,
			`Rimosso: ${LABEL[r.data.type]} delle ${hhmm(r.data.startedAt)}`,
		);
	};

export const pesoCommand =
	(chatId: number, userId: number, userName: string, arg: string, now: Date) =>
	async (env: WeightEnv & BotEnv & LoggerEnv): Promise<void> => {
		const trimmed = arg.trim();
		if (trimmed === "") {
			const res = await env.weightRepository.list(chatId);
			if (!res.success) {
				env.logger.error("peso: list failed", res.error);
				await env.bot.sendMessage(chatId, INTERNAL_ERROR);
				return;
			}
			await env.bot.sendMessage(chatId, formatHistory(res.data));
			return;
		}
		const grams = parseGrams(trimmed);
		if (grams === null) {
			await env.bot.sendMessage(chatId, PESO_USAGE);
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
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const note = res.data.overwritten ? " (aggiornato)" : "";
		await env.bot.sendMessage(chatId, `⚖️ Peso di oggi: ${grams} g${note}`);
	};

export const helpCommand =
	(chatId: number) =>
	async (env: BotEnv): Promise<void> => {
		await env.bot.sendMessage(chatId, HELP_TEXT);
	};

export const startCommand =
	(chatId: number) =>
	async (env: BotEnv): Promise<void> => {
		await env.bot.sendMessage(chatId, `Ciao! 👋\n\n${HELP_TEXT}`);
	};

const dailyReport =
	(chatId: number, window: TimeWindow, title: string) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("report: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			formatDaily(aggregate(evs.data, window), title),
		);
	};

const weeklyReport =
	(chatId: number, window: TimeWindow, title: string) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("report: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			formatWeekly(aggregateWeekly(evs.data, window), title),
		);
	};

export const oggiCommand = (chatId: number, now: Date) =>
	dailyReport(chatId, currentDayWindow(romeNow(now)), "📊 Oggi");

export const ieriCommand = (chatId: number, now: Date) =>
	dailyReport(chatId, previousDayWindow(romeNow(now)), "📊 Ieri");

export const settimanaCommand = (chatId: number, now: Date) =>
	weeklyReport(chatId, currentWeekWindow(romeNow(now)), "📅 Questa settimana");

export const sendDailyReport = (chatId: number, now: Date, babyName?: string) =>
	dailyReport(
		chatId,
		previousDayWindow(romeNow(now)),
		babyName ? `📊 Ieri — ${babyName}` : "📊 Ieri",
	);

export const sendWeeklyReport = (
	chatId: number,
	now: Date,
	babyName?: string,
) =>
	weeklyReport(
		chatId,
		previousWeekWindow(romeNow(now)),
		babyName ? `📅 Settimana scorsa — ${babyName}` : "📅 Settimana scorsa",
	);
