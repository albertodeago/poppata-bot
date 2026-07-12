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

		create: async ({ chatId, username }) => {
			const existing = byChat.get(chatId);
			if (existing) return R.success(existing);
			const created: ChatConfig = {
				chatId,
				reportsEnabled: true,
				status: "pending",
				...(username ? { username } : {}),
			};
			byChat.set(chatId, created);
			return R.success(created);
		},

		setBabyName: async (chatId, babyName) => {
			const prev = byChat.get(chatId);
			const updated: ChatConfig = {
				chatId,
				babyName,
				reportsEnabled: prev?.reportsEnabled ?? true,
				status: prev?.status ?? "pending",
				...(prev?.username ? { username: prev.username } : {}),
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
				status: prev?.status ?? "pending",
				...(prev?.username ? { username: prev.username } : {}),
			};
			byChat.set(chatId, updated);
			return R.success(updated);
		},

		setStatus: async (chatId, status) => {
			const prev = byChat.get(chatId);
			// Mirror pg's UPDATE-with-no-row: setting status on an unknown chat is an
			// error, not a silent create (approve/ban only act on existing rows).
			if (!prev) return R.error(new Error(`setStatus: no chat ${chatId}`));
			const updated: ChatConfig = {
				chatId,
				...(prev?.babyName ? { babyName: prev.babyName } : {}),
				reportsEnabled: prev?.reportsEnabled ?? true,
				status,
				...(prev?.username ? { username: prev.username } : {}),
			};
			byChat.set(chatId, updated);
			return R.success(updated);
		},

		listAll: async () =>
			R.success([...byChat.values()].filter((c) => c.status === "approved")),
	};
};
