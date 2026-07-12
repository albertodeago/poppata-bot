import type { BotEnv } from "./bot.js";
import type { ChatConfig, ChatConfigEnv } from "./chatConfig.js";
import type { LoggerEnv } from "./logger.js";
import type { Result } from "./result.js";

type AccessEnv = ChatConfigEnv & BotEnv & LoggerEnv;

const APPROVED_NOTICE =
	"✅ Accesso approvato! Scrivi /start o /help per iniziare.";

/** Admin approves a pending chat: flip to approved and tell the requester. */
export const approveChat =
	(chatId: number) =>
	async (env: AccessEnv): Promise<Result<ChatConfig>> => {
		const res = await env.chatConfigRepository.setStatus(chatId, "approved");
		if (!res.success) {
			env.logger.error("approveChat: setStatus failed", res.error);
			return res;
		}
		await env.bot.sendMessage(chatId, APPROVED_NOTICE);
		return res;
	};

/** Admin bans a chat: flip to banned. Silent — the banned chat hears nothing. */
export const banChat =
	(chatId: number) =>
	async (env: AccessEnv): Promise<Result<ChatConfig>> => {
		const res = await env.chatConfigRepository.setStatus(chatId, "banned");
		if (!res.success) env.logger.error("banChat: setStatus failed", res.error);
		return res;
	};
