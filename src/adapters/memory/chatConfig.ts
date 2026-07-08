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
			const created: ChatConfig = { chatId, reportsEnabled: true };
			byChat.set(chatId, created);
			return R.success(created);
		},

		setBabyName: async (chatId, babyName) => {
			const prev = byChat.get(chatId);
			const updated: ChatConfig = {
				chatId,
				babyName,
				reportsEnabled: prev?.reportsEnabled ?? true,
			};
			byChat.set(chatId, updated);
			return R.success(updated);
		},

		setReportsEnabled: async (chatId, enabled) => {
			const prev = byChat.get(chatId);
			const updated: ChatConfig = {
				chatId,
				...(prev?.babyName ? { babyName: prev.babyName } : {}),
				reportsEnabled: enabled,
			};
			byChat.set(chatId, updated);
			return R.success(updated);
		},

		listAll: async () => R.success([...byChat.values()]),
	};
};
