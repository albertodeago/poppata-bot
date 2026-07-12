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
const REQUEST_SENT =
	"📨 Richiesta di accesso inviata! Attendi l'approvazione dell'amministratore.";
const ALREADY_PENDING = "⏳ La tua richiesta è in attesa di approvazione.";

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

const welcomeMessage = (guideUrl: string, babyName?: string): string => {
	const nameLine = babyName ? `👶 Nome: ${babyName}` : NAME_HINT;
	return `${WELCOME}\n${nameLine}\n\n${HELP_TEXT}\n\n📖 <a href="${guideUrl}">Guida visuale: come usare il bot</a>`;
};

export interface RegisterInput {
	chatId: number;
	userName: string;
	chatTitle?: string;
	/** Optional inline name from `/start Mario` (applied only to approved chats). */
	name?: string;
	/** Requester's Telegram @handle, if they have one. */
	username?: string;
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
			adminChatId,
			guideUrl,
		} = input;

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
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const existing = existingRes.data;

		if (existing) {
			// Banned chats are dropped silently. A pending chat that retries re-pings
			// the admin (self-heals a missed notification) and is told to wait.
			if (existing.status === "banned") return;
			if (existing.status === "pending") {
				await notifyAdmin();
				await env.bot.sendMessage(chatId, ALREADY_PENDING);
				return;
			}
			// Approved: greet, or apply an inline /start name.
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

		// New chat: create a pending request and notify the admin to approve/ban.
		const created = await env.chatConfigRepository.create({
			chatId,
			createdByName: userName,
			...(username ? { username } : {}),
		});
		if (!created.success) {
			env.logger.error("register: create failed", created.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await notifyAdmin();
		await env.bot.sendMessage(chatId, REQUEST_SENT);
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
