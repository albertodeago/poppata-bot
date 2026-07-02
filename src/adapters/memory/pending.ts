import type { LoggerEnv } from "../../domain/logger";
import type {
	NewPendingConfirmation,
	PendingConfirmation,
	PendingRepository,
} from "../../domain/pending";
import * as R from "../../domain/result";

export const makeMemoryPendingRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): PendingRepository => {
	logger.info("initMemoryPendingRepository");
	let rows: PendingConfirmation[] = [];

	return {
		create: async (p: NewPendingConfirmation) => {
			const created: PendingConfirmation = {
				...p,
				id: crypto.randomUUID(),
				createdAt: new Date(),
			};
			rows.push(created);
			return R.success(created);
		},
		get: async (id: string) => {
			return R.success(rows.find((r) => r.id === id) ?? null);
		},
		delete: async (id: string) => {
			rows = rows.filter((r) => r.id !== id);
			return R.success(undefined);
		},
		deleteStale: async (olderThan: Date) => {
			const before = rows.length;
			rows = rows.filter((r) => r.createdAt.getTime() >= olderThan.getTime());
			return R.success(before - rows.length);
		},
	};
};
