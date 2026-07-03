import { describe, expect, it, vi } from "vitest";
import { makeMemoryWeightRepository } from "../../../../src/adapters/memory/weight.js";
import type { NewWeightReading } from "../../../../src/domain/weight.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const newReading = (
	over: Partial<NewWeightReading> = {},
): NewWeightReading => ({
	chatId: 1,
	day: "2026-07-01",
	grams: 3200,
	userId: 1,
	userName: "papà",
	...over,
});

describe("[MEMORY weight repo]", () => {
	it("upsert inserts a fresh reading (overwritten false)", async () => {
		const repo = makeMemoryWeightRepository({ logger });
		const r = await repo.upsert(newReading({}));
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.overwritten).toBe(false);
			expect(r.data.reading.id).toBeTruthy();
			expect(r.data.reading.grams).toBe(3200);
		}
	});

	it("upsert overwrites the same day (overwritten true)", async () => {
		const repo = makeMemoryWeightRepository({ logger });
		await repo.upsert(newReading({ grams: 3200 }));
		const second = await repo.upsert(newReading({ grams: 3400 }));
		expect(second.success).toBe(true);
		if (second.success) expect(second.data.overwritten).toBe(true);
		const list = await repo.list(1);
		if (list.success) {
			expect(list.data).toHaveLength(1);
			expect(list.data[0]?.grams).toBe(3400);
		}
	});

	it("list returns a chat's readings sorted by day, isolated per chat", async () => {
		const repo = makeMemoryWeightRepository({ logger });
		await repo.upsert(newReading({ day: "2026-07-08", grams: 3400 }));
		await repo.upsert(newReading({ day: "2026-07-01", grams: 3200 }));
		await repo.upsert(
			newReading({ chatId: 2, day: "2026-07-01", grams: 9999 }),
		);
		const r = await repo.list(1);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.map((x) => x.day)).toEqual(["2026-07-01", "2026-07-08"]);
			expect(r.data.every((x) => x.chatId === 1)).toBe(true);
		}
	});
});
