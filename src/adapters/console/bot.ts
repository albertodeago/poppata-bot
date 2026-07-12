import type { BotEnv } from "../../domain/bot.js";
import type { LoggerEnv } from "../../domain/logger.js";

export interface ConsoleBotState {
	lastPendingId?: string | undefined;
	lastConfirmationMessageId?: number | undefined;
}

export const makeConsoleBot = (
	_env: LoggerEnv,
): { botEnv: BotEnv; state: ConsoleBotState } => {
	const state: ConsoleBotState = {};
	let msgSeq = 1000;

	const botEnv: BotEnv = {
		bot: {
			sendMessage: async (chatId, text) => {
				console.log(`\n💬 [${chatId}] ${text.replace(/<\/?b>/g, "")}`);
			},
			react: async (_chatId, messageId, emoji) => {
				console.log(`\n${emoji}  (reaction su msg ${messageId})`);
			},
			sendConfirmation: async (chatId, text, pendingId) => {
				const mid = ++msgSeq;
				state.lastPendingId = pendingId;
				state.lastConfirmationMessageId = mid;
				console.log(
					`\n⚠️  [${chatId}] ${text}\n   [Conferma] [Annulla]   (pending ${pendingId}, msg ${mid})\n   → scrivi "conf" o "ann"`,
				);
			},
			sendSidePrompt: async (chatId, text, pendingId) => {
				const mid = ++msgSeq;
				state.lastPendingId = pendingId;
				state.lastConfirmationMessageId = mid;
				console.log(
					`\n🤱  [${chatId}] ${text}\n   [Sinistro] [Destro]   (pending ${pendingId}, msg ${mid})\n   → scrivi "sx" o "dx"`,
				);
			},
			sendTypePrompt: async (chatId, text, pendingId) => {
				const mid = ++msgSeq;
				state.lastPendingId = pendingId;
				state.lastConfirmationMessageId = mid;
				console.log(
					`\n🍼  [${chatId}] ${text}\n   [Poppata] [Nanna]   (pending ${pendingId}, msg ${mid})\n   → scrivi "eat" o "sleep"`,
				);
			},
			sendFeedTypePrompt: async (chatId, text, pendingId) => {
				const mid = ++msgSeq;
				state.lastPendingId = pendingId;
				state.lastConfirmationMessageId = mid;
				console.log(
					`\n🍼  [${chatId}] ${text}\n   [Poppata] [Biberon]   (pending ${pendingId}, msg ${mid})\n   → scrivi "eat" o "bottle"`,
				);
			},
			answerCallback: async (_id, text) => {
				if (text) console.log(`   (callback: ${text})`);
			},
			sendAccessRequest: async (adminChatId, text, targetChatId) => {
				console.log(
					`\n📨 [admin ${adminChatId}] ${text}\n   [✅ Approva] [🚫 Banna]   (chat ${targetChatId})`,
				);
			},
			clearKeyboard: async (_chatId, messageId) => {
				console.log(`   (tastiera rimossa da msg ${messageId})`);
			},
			sendLinkButton: async (chatId, text, buttonText, url) => {
				console.log(`\n💬 [${chatId}] ${text}\n   [${buttonText}] → ${url}`);
			},
		},
	};

	return { botEnv, state };
};
