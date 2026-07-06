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
	/**
	 * "amount" marks a bottle awaiting its ml, resolved by the user's next
	 * (free-text) message rather than a button. Absent for button confirmations.
	 */
	kind?: "amount";
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
	/** The most recent `kind:"amount"` pending for a chat (the open "quanti ml?"), or null. */
	findAmountPending(
		chatId: number,
	): Promise<Result<PendingConfirmation | null>>;
	delete(id: string): Promise<Result<void>>;
	/** Delete rows created before `olderThan`; returns how many were removed. */
	deleteStale(olderThan: Date): Promise<Result<number>>;
}

export interface PendingEnv {
	pendingRepository: PendingRepository;
}
