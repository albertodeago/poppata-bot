import type {
	ChatConfig,
	ChatConfigRepository,
} from "../../domain/chatConfig.js";
import type { LoggerEnv } from "../../domain/logger.js";
import * as R from "../../domain/result.js";

export const makeMemoryChatConfigRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): ChatConfigRepository => {
	logger.info("initMemoryChatConfigRepository");
	const byChat = new Map<number, ChatConfig>();

	return {
		get: async (chatId) => R.success(byChat.get(chatId) ?? null),

		count: async () => R.success(byChat.size),

		create: async ({ chatId }) => {
			const existing = byChat.get(chatId);
			if (existing) return R.success(existing);
			const created: ChatConfig = { chatId };
			byChat.set(chatId, created);
			return R.success(created);
		},

		setBabyName: async (chatId, babyName) => {
			const updated: ChatConfig = { chatId, babyName };
			byChat.set(chatId, updated);
			return R.success(updated);
		},

		listAll: async () => R.success([...byChat.values()]),
	};
};
