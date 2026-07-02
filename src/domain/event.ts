import type { Result } from "./result";

export type EventType = "eat" | "sleep" | "pee" | "poop";
export type Side = "dx" | "sx";
export type EventSource = "rules" | "gemini";

export interface BabyEvent {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	type: EventType;
	side?: Side;
	/** For eat/sleep: session start. For pee/poop: the instant. */
	startedAt: Date;
	/** eat/sleep when closed; absent while open or for instant events. */
	endedAt?: Date;
	source: EventSource;
	rawText: string;
	messageId: number;
	createdAt: Date;
}

/** Fields needed to persist a new event; id/createdAt are assigned by the repo. */
export type NewBabyEvent = Omit<BabyEvent, "id" | "createdAt">;

export interface EventRepository {
	insert(event: NewBabyEvent): Promise<Result<BabyEvent>>;
	/** The open eat/sleep session for a chat (endedAt absent), or null. */
	findOpenSession(chatId: number): Promise<Result<BabyEvent | null>>;
	closeSession(id: string, endedAt: Date): Promise<Result<BabyEvent>>;
	/** Delete + return the most recently created event in a chat (for /annulla). */
	deleteLast(chatId: number): Promise<Result<BabyEvent | null>>;
	/**
	 * Events relevant to a report window [start, end):
	 * - pee/poop whose startedAt is in the window;
	 * - eat/sleep sessions overlapping the window (including still-open ones,
	 *   which the report layer flags and excludes from totals).
	 */
	listSince(
		chatId: number,
		start: Date,
		end: Date,
	): Promise<Result<BabyEvent[]>>;
}

export interface EventEnv {
	eventRepository: EventRepository;
}

export const isOpenSession = (e: BabyEvent): boolean =>
	(e.type === "eat" || e.type === "sleep") && e.endedAt === undefined;

/** Italian labels for each event type — shared by session/bot copy. */
export const LABEL: Record<EventType, string> = {
	eat: "poppata",
	sleep: "nanna",
	pee: "pipì",
	poop: "cacca",
};
