import type { Result } from "./result.js";

/** A chat's access lifecycle. The bot serves only `approved` chats. */
export type AccessStatus = "pending" | "approved" | "banned";

export interface ChatConfig {
	chatId: number;
	/** Baby name shown in report headers; absent until set via /nome. */
	babyName?: string;
	/** Whether the cron sends this chat its scheduled reports. Defaults true. */
	reportsEnabled: boolean;
	/** Access lifecycle: pending → approved → banned. New chats start pending. */
	status: AccessStatus;
	/** Requester's Telegram @handle at request time; absent if they have none. */
	username?: string;
}

export interface ChatConfigRepository {
	/** The chat's config row, or null if the chat has never registered. */
	get(chatId: number): Promise<Result<ChatConfig | null>>;
	/** Create a pending access request (idempotent): new row, or the existing one. */
	create(input: {
		chatId: number;
		createdByName: string;
		username?: string;
	}): Promise<Result<ChatConfig>>;
	/** Set/replace the baby name on an existing (or upserted) row. */
	setBabyName(chatId: number, babyName: string): Promise<Result<ChatConfig>>;
	/** Enable/disable the scheduled (cron) reports for a chat. */
	setReportsEnabled(
		chatId: number,
		enabled: boolean,
	): Promise<Result<ChatConfig>>;
	/** Move a chat through its access lifecycle (admin approve/ban). */
	setStatus(chatId: number, status: AccessStatus): Promise<Result<ChatConfig>>;
	/** Approved chats only, creation order (for the report cron). */
	listAll(): Promise<Result<ChatConfig[]>>;
}

export interface ChatConfigEnv {
	chatConfigRepository: ChatConfigRepository;
}
