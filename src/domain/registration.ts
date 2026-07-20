import type { BotEnv } from "./bot.js";
import type { ChatConfigEnv, ChatLanguage } from "./chatConfig.js";
import { helpText } from "./commands.js";
import { guideUrlForLanguage } from "./guide.js";
import {
	internalError,
	languageSet,
	languageState,
	languageUsage,
	normalizeLanguageCode,
	parseLanguageArg,
} from "./i18n.js";
import type { LoggerEnv } from "./logger.js";

type RegEnv = ChatConfigEnv & BotEnv & LoggerEnv;

const INTERNAL_ERROR = "Errore interno, riprova.";
const WELCOME = "Ciao! 👋 Bot attivato in questa chat.";
const WELCOME_EN = "Hi! 👋 Bot enabled in this chat.";
// No angle-bracket placeholder: the welcome is sent as HTML (HELP_TEXT), so a
// literal "<nome>" would be read as a (broken) tag.
const NAME_HINT = 'Scrivi "/nome Mario" per dirmi come si chiama il bimbo/a.';
const NAME_HINT_EN = 'Write "/name Mario" to tell me the baby name.';
const NOME_USAGE = "Usa /nome Mario per impostare il nome.";
const NAME_USAGE_EN = "Use /name Mario to set the baby name.";
const REPORT_ON_STATE = "📊 Report automatici: attivi";
const REPORT_OFF_STATE = "📊 Report automatici: disattivati";
const REPORT_ENABLED = "🔔 Report automatici riattivati.";
const REPORT_DISABLED = "🔕 Report automatici disattivati.";
const REPORT_USAGE = "Usa /report on oppure /report off.";
const REPORT_ON_STATE_EN = "📊 Automatic reports: on";
const REPORT_OFF_STATE_EN = "📊 Automatic reports: off";
const REPORT_ENABLED_EN = "🔔 Automatic reports enabled.";
const REPORT_DISABLED_EN = "🔕 Automatic reports disabled.";
const REPORT_USAGE_EN = "Use /report on or /report off.";
const REQUEST_SENT =
	"📨 Richiesta di accesso inviata! Attendi l'approvazione dell'amministratore.";
const ALREADY_PENDING = "⏳ La tua richiesta è in attesa di approvazione.";
const REQUEST_SENT_EN =
	"📨 Access request sent! Wait for the administrator to approve it.";
const ALREADY_PENDING_EN = "⏳ Your request is waiting for approval.";

const regText = (language: ChatLanguage) => ({
	internalError: internalError(language),
	welcome: language === "it" ? WELCOME : WELCOME_EN,
	nameHint: language === "it" ? NAME_HINT : NAME_HINT_EN,
	nameUsage: language === "it" ? NOME_USAGE : NAME_USAGE_EN,
	reportOnState: language === "it" ? REPORT_ON_STATE : REPORT_ON_STATE_EN,
	reportOffState: language === "it" ? REPORT_OFF_STATE : REPORT_OFF_STATE_EN,
	reportEnabled: language === "it" ? REPORT_ENABLED : REPORT_ENABLED_EN,
	reportDisabled: language === "it" ? REPORT_DISABLED : REPORT_DISABLED_EN,
	reportUsage: language === "it" ? REPORT_USAGE : REPORT_USAGE_EN,
	requestSent: language === "it" ? REQUEST_SENT : REQUEST_SENT_EN,
	alreadyPending: language === "it" ? ALREADY_PENDING : ALREADY_PENDING_EN,
});

/** The admin-facing text for a new access request (with the requester handle). */
const accessRequestText = (
	chatId: number,
	userName: string,
	username?: string,
	chatTitle?: string,
): string => {
	const who = username ? `${userName} (@${username})` : userName;
	const where = chatTitle ? `${chatTitle} (${chatId})` : `chat ${chatId}`;
	return `📨 Nuova richiesta di accesso\n${where}\nda ${who}`;
};

const nameSet = (name: string, updated: boolean): string =>
	`👶 Nome ${updated ? "aggiornato" : "impostato"}: ${name}`;

const nameSetEn = (name: string, updated: boolean): string =>
	`👶 Name ${updated ? "updated" : "set"}: ${name}`;

const nameSetFor = (
	language: ChatLanguage,
	name: string,
	updated: boolean,
): string =>
	language === "it" ? nameSet(name, updated) : nameSetEn(name, updated);

const welcomeMessage = (
	guideUrl: string,
	language: ChatLanguage,
	babyName?: string,
): string => {
	const t = regText(language);
	const nameLine = babyName
		? language === "it"
			? `👶 Nome: ${babyName}`
			: `👶 Name: ${babyName}`
		: t.nameHint;
	const guideText =
		language === "it"
			? "Guida visuale: come usare il bot"
			: "Visual guide: how to use the bot";
	return `${t.welcome}\n${nameLine}\n\n${helpText(language)}\n\n📖 <a href="${guideUrlForLanguage(guideUrl, language)}">${guideText}</a>`;
};

export interface RegisterInput {
	chatId: number;
	userName: string;
	chatTitle?: string;
	/** Optional inline name from `/start Mario` (applied only to approved chats). */
	name?: string;
	/** Requester's Telegram @handle, if they have one. */
	username?: string;
	/** Requester's Telegram client language code, used only for first registration. */
	languageCode?: string;
	/** Chat that receives the access-request notification. */
	adminChatId: number;
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
			username,
			languageCode,
			adminChatId,
			guideUrl,
		} = input;
		const requestedLanguage = normalizeLanguageCode(languageCode);

		// Notify the admin, tolerating a transient failure: a lost notification is
		// recovered on the next /start (which re-enters via the pending branch).
		const notifyAdmin = async (): Promise<void> => {
			try {
				await env.bot.sendAccessRequest(
					adminChatId,
					accessRequestText(chatId, userName, username, chatTitle),
					chatId,
				);
			} catch (e) {
				env.logger.error("register: sendAccessRequest failed", e);
			}
		};

		const existingRes = await env.chatConfigRepository.get(chatId);
		if (!existingRes.success) {
			env.logger.error("register: get failed", existingRes.error);
			await env.bot.sendMessage(chatId, internalError(requestedLanguage));
			return;
		}
		const existing = existingRes.data;
		const language = existing?.language ?? requestedLanguage;
		const t = regText(language);

		if (existing) {
			// Banned chats are dropped silently. A pending chat that retries re-pings
			// the admin (self-heals a missed notification) and is told to wait.
			if (existing.status === "banned") return;
			if (existing.status === "pending") {
				await notifyAdmin();
				await env.bot.sendMessage(chatId, t.alreadyPending);
				return;
			}
			// Approved: greet, or apply an inline /start name.
			if (name) {
				const set = await env.chatConfigRepository.setBabyName(chatId, name);
				if (!set.success) {
					env.logger.error("register: setBabyName failed", set.error);
					await env.bot.sendMessage(chatId, t.internalError);
					return;
				}
				await env.bot.sendMessage(
					chatId,
					nameSetFor(language, name, existing.babyName !== undefined),
				);
				return;
			}
			await env.bot.sendMessage(
				chatId,
				welcomeMessage(guideUrl, language, existing.babyName),
				{ parseMode: "HTML" },
			);
			return;
		}

		// New chat: create a pending request and notify the admin to approve/ban.
		const created = await env.chatConfigRepository.create({
			chatId,
			createdByName: userName,
			language: requestedLanguage,
			...(username ? { username } : {}),
		});
		if (!created.success) {
			env.logger.error("register: create failed", created.error);
			await env.bot.sendMessage(chatId, internalError(requestedLanguage));
			return;
		}
		await notifyAdmin();
		await env.bot.sendMessage(chatId, regText(requestedLanguage).requestSent);
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
		const language = cur?.language ?? "it";
		const t = regText(language);

		if (trimmed === "") {
			await env.bot.sendMessage(
				chatId,
				cur?.babyName
					? language === "it"
						? `👶 Nome attuale: ${cur.babyName}`
						: `👶 Current name: ${cur.babyName}`
					: t.nameUsage,
			);
			return;
		}

		const set = await env.chatConfigRepository.setBabyName(chatId, trimmed);
		if (!set.success) {
			env.logger.error("nome: setBabyName failed", set.error);
			await env.bot.sendMessage(chatId, t.internalError);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			nameSetFor(language, trimmed, cur?.babyName !== undefined),
		);
	};

/** `/lingua it|en` / `/language it|en` sets the chat reply language. */
export const languageCommand =
	(chatId: number, arg: string) =>
	async (env: RegEnv): Promise<void> => {
		const curRes = await env.chatConfigRepository.get(chatId);
		if (!curRes.success) {
			env.logger.error("language: get failed", curRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const current = curRes.data?.language ?? "it";
		const trimmed = arg.trim();
		if (trimmed === "") {
			await env.bot.sendMessage(chatId, languageState(current));
			return;
		}

		const language = parseLanguageArg(trimmed);
		if (!language) {
			await env.bot.sendMessage(chatId, languageUsage(current));
			return;
		}

		const set = await env.chatConfigRepository.setLanguage(chatId, language);
		if (!set.success) {
			env.logger.error("language: setLanguage failed", set.error);
			await env.bot.sendMessage(chatId, internalError(current));
			return;
		}
		await env.bot.sendMessage(chatId, languageSet(language));
	};

/** `/report on|off` toggles the scheduled reports; bare `/report` shows the state. */
export const reportCommand =
	(chatId: number, arg: string) =>
	async (env: RegEnv): Promise<void> => {
		const trimmed = arg.trim().toLowerCase();
		const curRes = await env.chatConfigRepository.get(chatId);
		if (!curRes.success) {
			env.logger.error("report: get failed", curRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const language = curRes.data?.language ?? "it";
		const t = regText(language);

		if (trimmed === "") {
			// Unregistered chats never reach this command (the gate blocks them), so a
			// missing row is a defensive case — treat it as the default (enabled).
			const enabled = curRes.data?.reportsEnabled ?? true;
			await env.bot.sendMessage(
				chatId,
				enabled ? t.reportOnState : t.reportOffState,
			);
			return;
		}

		if (trimmed !== "on" && trimmed !== "off") {
			await env.bot.sendMessage(chatId, t.reportUsage);
			return;
		}

		const enable = trimmed === "on";
		const set = await env.chatConfigRepository.setReportsEnabled(
			chatId,
			enable,
		);
		if (!set.success) {
			env.logger.error("report: setReportsEnabled failed", set.error);
			await env.bot.sendMessage(chatId, t.internalError);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			enable ? t.reportEnabled : t.reportDisabled,
		);
	};
