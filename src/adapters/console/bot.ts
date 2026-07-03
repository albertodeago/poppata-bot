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
				console.log(`\n💬 [${chatId}] ${text}`);
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
			answerCallback: async (_id, text) => {
				if (text) console.log(`   (callback: ${text})`);
			},
			clearKeyboard: async (_chatId, messageId) => {
				console.log(`   (tastiera rimossa da msg ${messageId})`);
			},
		},
	};

	return { botEnv, state };
};
