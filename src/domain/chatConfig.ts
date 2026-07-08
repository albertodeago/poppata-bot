import type { Result } from "./result.js";

export interface ChatConfig {
	chatId: number;
	/** Baby name shown in report headers; absent until set via /nome. */
	babyName?: string;
	/** Whether the cron sends this chat its scheduled reports. Defaults true. */
	reportsEnabled: boolean;
}

export interface ChatConfigRepository {
	/** The chat's config row, or null if the chat has never registered. */
	get(chatId: number): Promise<Result<ChatConfig | null>>;
	/** Number of registered chats (for the registration cap). */
	count(): Promise<Result<number>>;
	/** Register a chat (idempotent): create the row, or return the existing one. */
	create(input: {
		chatId: number;
		createdByName: string;
	}): Promise<Result<ChatConfig>>;
	/** Set/replace the baby name on an existing (or upserted) row. */
	setBabyName(chatId: number, babyName: string): Promise<Result<ChatConfig>>;
	/** Enable/disable the scheduled (cron) reports for a chat. */
	setReportsEnabled(
		chatId: number,
		enabled: boolean,
	): Promise<Result<ChatConfig>>;
	/** All registered chats, creation order (for the report cron). */
	listAll(): Promise<Result<ChatConfig[]>>;
}

export interface ChatConfigEnv {
	chatConfigRepository: ChatConfigRepository;
}
