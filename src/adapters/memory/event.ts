import type {
	BabyEvent,
	EventRepository,
	NewBabyEvent,
} from "../../domain/event.js";
import { isOpenSession } from "../../domain/event.js";
import type { LoggerEnv } from "../../domain/logger.js";
import * as R from "../../domain/result.js";

export const makeMemoryEventRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): EventRepository => {
	logger.info("initMemoryEventRepository");
	const events: BabyEvent[] = [];

	return {
		insert: async (event: NewBabyEvent) => {
			const created: BabyEvent = {
				...event,
				id: crypto.randomUUID(),
				createdAt: new Date(),
			};
			events.push(created);
			return R.success(created);
		},

		findOpenSession: async (chatId: number) => {
			const open = events.find((e) => e.chatId === chatId && isOpenSession(e));
			return R.success(open ?? null);
		},

		findLastFeed: async (chatId: number) => {
			let last: BabyEvent | null = null;
			for (const e of events) {
				if (e.chatId === chatId && e.type === "eat" && e.side !== undefined) {
					if (!last || e.startedAt.getTime() > last.startedAt.getTime()) {
						last = e;
					}
				}
			}
			return R.success(last);
		},

		closeSession: async (id: string, endedAt: Date) => {
			const e = events.find((ev) => ev.id === id);
			if (!e) return R.error(new Error("Session not found"));
			e.endedAt = endedAt;
			return R.success(e);
		},

		deleteLast: async (chatId: number) => {
			let idx = -1;
			for (let i = 0; i < events.length; i++) {
				const e = events[i];
				if (
					e &&
					e.chatId === chatId &&
					(idx === -1 ||
						// biome-ignore lint/style/noNonNullAssertion: idx points at an existing element
						e.createdAt.getTime() > events[idx]!.createdAt.getTime() ||
						// biome-ignore lint/style/noNonNullAssertion: idx points at an existing element
						(e.createdAt.getTime() === events[idx]!.createdAt.getTime() &&
							i > idx))
				) {
					idx = i;
				}
			}
			if (idx === -1) return R.success(null);
			const [deleted] = events.splice(idx, 1);
			return R.success(deleted ?? null);
		},

		listSince: async (chatId: number, start: Date, end: Date) => {
			const s = start.getTime();
			const e = end.getTime();
			const rows = events.filter((ev) => {
				if (ev.chatId !== chatId) return false;
				if (ev.type === "pee" || ev.type === "poop" || ev.type === "bottle") {
					const t = ev.startedAt.getTime();
					return t >= s && t < e;
				}
				// eat/sleep: overlap the window (open sessions included, flagged later)
				if (ev.startedAt.getTime() >= e) return false;
				return ev.endedAt === undefined || ev.endedAt.getTime() > s;
			});
			return R.success(rows);
		},
	};
};
