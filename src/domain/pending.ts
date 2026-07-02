import type { Intent } from "./parse.js";
import type { Result } from "./result.js";

export interface PendingConfirmation {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	rawText: string;
	intent: Intent;
	warning: string;
	/** The original user message this confirmation is about. */
	messageId: number;
	createdAt: Date;
}

export type NewPendingConfirmation = Omit<
	PendingConfirmation,
	"id" | "createdAt"
>;

export interface PendingRepository {
	create(p: NewPendingConfirmation): Promise<Result<PendingConfirmation>>;
	get(id: string): Promise<Result<PendingConfirmation | null>>;
	delete(id: string): Promise<Result<void>>;
	/** Delete rows created before `olderThan`; returns how many were removed. */
	deleteStale(olderThan: Date): Promise<Result<number>>;
}

export interface PendingEnv {
	pendingRepository: PendingRepository;
}
