import type { LoggerEnv } from "../../domain/logger.js";
import * as R from "../../domain/result.js";
import type {
	NewWeightReading,
	WeightReading,
	WeightRepository,
} from "../../domain/weight.js";

export const makeMemoryWeightRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): WeightRepository => {
	logger.info("initMemoryWeightRepository");
	const byKey = new Map<string, WeightReading>();
	const key = (chatId: number, day: string): string => `${chatId}:${day}`;

	return {
		upsert: async (reading: NewWeightReading) => {
			const k = key(reading.chatId, reading.day);
			const existing = byKey.get(k);
			const stored: WeightReading = {
				...reading,
				id: existing?.id ?? crypto.randomUUID(),
				createdAt: new Date(),
			};
			byKey.set(k, stored);
			return R.success({
				reading: stored,
				overwritten: existing !== undefined,
			});
		},

		list: async (chatId: number) => {
			const rows = [...byKey.values()]
				.filter((r) => r.chatId === chatId)
				.sort((a, b) => a.day.localeCompare(b.day));
			return R.success(rows);
		},
	};
};
