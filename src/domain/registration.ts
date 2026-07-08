import type { BotEnv } from "./bot.js";
import type { ChatConfigEnv } from "./chatConfig.js";
import { HELP_TEXT } from "./commands.js";
import type { LoggerEnv } from "./logger.js";

type RegEnv = ChatConfigEnv & BotEnv & LoggerEnv;

const INTERNAL_ERROR = "Errore interno, riprova.";
const WELCOME = "Ciao! 👋 Bot attivato in questa chat.";
// No angle-bracket placeholder: the welcome is sent as HTML (HELP_TEXT), so a
// literal "<nome>" would be read as a (broken) tag.
const NAME_HINT = 'Scrivi "/nome Mario" per dirmi come si chiama il bimbo/a.';
const NOME_USAGE = "Usa /nome Mario per impostare il nome.";
const REPORT_ON_STATE = "📊 Report automatici: attivi";
const REPORT_OFF_STATE = "📊 Report automatici: disattivati";
const REPORT_ENABLED = "🔔 Report automatici riattivati.";
const REPORT_DISABLED = "🔕 Report automatici disattivati.";
const REPORT_USAGE = "Usa /report on oppure /report off.";

/** Prefilled GitHub-issue link asking the owner to enable an over-cap chat. */
export const describeIssueLink = (
	repoIssuesUrl: string,
	chatId: number,
	chatTitle?: string,
): string => {
	const title = `Enable bot in chat ${chatId}`;
	const body = `Please enable poppata-bot in this chat.\n${
		chatTitle ? `Chat: ${chatTitle}\n` : ""
	}ChatId: ${chatId}`;
	return `${repoIssuesUrl}/new?title=${encodeURIComponent(
		title,
	)}&body=${encodeURIComponent(body)}`;
};

const nameSet = (name: string, updated: boolean): string =>
	`👶 Nome ${updated ? "aggiornato" : "impostato"}: ${name}`;

const welcomeMessage = (guideUrl: string, babyName?: string): string => {
	const nameLine = babyName ? `👶 Nome: ${babyName}` : NAME_HINT;
	return `${WELCOME}\n${nameLine}\n\n${HELP_TEXT}\n\n📖 <a href="${guideUrl}">Guida visuale: come usare il bot</a>`;
};

const registerFull = (
	maxChats: number,
	url: string,
	guideUrl: string,
): string =>
	`Mi dispiace, il bot ha raggiunto il numero massimo di chat (${maxChats}). Richiedi l'attivazione qui: ${url}\n\n📖 Nel frattempo, guarda come funziona: ${guideUrl}`;

export interface RegisterInput {
	chatId: number;
	userName: string;
	chatTitle?: string;
	/** Optional inline name from `/start Mario`. */
	name?: string;
	maxChats: number;
	repoIssuesUrl: string;
	guideUrl: string;
}

/** Shared by `/start` and the `my_chat_member` add-event. Idempotent. */
export const registerChat =
	(input: RegisterInput) =>
	async (env: RegEnv): Promise<void> => {
		const {
			chatId,
			userName,
			chatTitle,
			name,
			maxChats,
			repoIssuesUrl,
			guideUrl,
		} = input;

		const existingRes = await env.chatConfigRepository.get(chatId);
		if (!existingRes.success) {
			env.logger.error("register: get failed", existingRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const existing = existingRes.data;

		if (existing) {
			if (name) {
				const set = await env.chatConfigRepository.setBabyName(chatId, name);
				if (!set.success) {
					env.logger.error("register: setBabyName failed", set.error);
					await env.bot.sendMessage(chatId, INTERNAL_ERROR);
					return;
				}
				await env.bot.sendMessage(
					chatId,
					nameSet(name, existing.babyName !== undefined),
				);
				return;
			}
			await env.bot.sendMessage(
				chatId,
				welcomeMessage(guideUrl, existing.babyName),
				{ parseMode: "HTML" },
			);
			return;
		}

		// New chat: enforce the registration cap before creating a row.
		const countRes = await env.chatConfigRepository.count();
		if (!countRes.success) {
			env.logger.error("register: count failed", countRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		if (countRes.data >= maxChats) {
			await env.bot.sendMessage(
				chatId,
				registerFull(
					maxChats,
					describeIssueLink(repoIssuesUrl, chatId, chatTitle),
					guideUrl,
				),
			);
			return;
		}

		const created = await env.chatConfigRepository.create({
			chatId,
			createdByName: userName,
		});
		if (!created.success) {
			env.logger.error("register: create failed", created.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		if (name) {
			const set = await env.chatConfigRepository.setBabyName(chatId, name);
			if (!set.success) {
				env.logger.error("register: setBabyName failed", set.error);
				await env.bot.sendMessage(chatId, INTERNAL_ERROR);
				return;
			}
		}
		await env.bot.sendMessage(chatId, welcomeMessage(guideUrl, name), {
			parseMode: "HTML",
		});
	};

/** `/nome Mario` sets the name; bare `/nome` shows it (or a usage hint). */
export const nomeCommand =
	(chatId: number, arg: string) =>
	async (env: RegEnv): Promise<void> => {
		const trimmed = arg.trim();
		const curRes = await env.chatConfigRepository.get(chatId);
		if (!curRes.success) {
			env.logger.error("nome: get failed", curRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const cur = curRes.data;

		if (trimmed === "") {
			await env.bot.sendMessage(
				chatId,
				cur?.babyName ? `👶 Nome attuale: ${cur.babyName}` : NOME_USAGE,
			);
			return;
		}

		const set = await env.chatConfigRepository.setBabyName(chatId, trimmed);
		if (!set.success) {
			env.logger.error("nome: setBabyName failed", set.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			nameSet(trimmed, cur?.babyName !== undefined),
		);
	};

/** `/report on|off` toggles the scheduled reports; bare `/report` shows the state. */
export const reportCommand =
	(chatId: number, arg: string) =>
	async (env: RegEnv): Promise<void> => {
		const trimmed = arg.trim().toLowerCase();

		if (trimmed === "") {
			const curRes = await env.chatConfigRepository.get(chatId);
			if (!curRes.success) {
				env.logger.error("report: get failed", curRes.error);
				await env.bot.sendMessage(chatId, INTERNAL_ERROR);
				return;
			}
			// Unregistered chats never reach this command (the gate blocks them), so a
			// missing row is a defensive case — treat it as the default (enabled).
			const enabled = curRes.data?.reportsEnabled ?? true;
			await env.bot.sendMessage(
				chatId,
				enabled ? REPORT_ON_STATE : REPORT_OFF_STATE,
			);
			return;
		}

		if (trimmed !== "on" && trimmed !== "off") {
			await env.bot.sendMessage(chatId, REPORT_USAGE);
			return;
		}

		const enable = trimmed === "on";
		const set = await env.chatConfigRepository.setReportsEnabled(
			chatId,
			enable,
		);
		if (!set.success) {
			env.logger.error("report: setReportsEnabled failed", set.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			enable ? REPORT_ENABLED : REPORT_DISABLED,
		);
	};
