import { describe, expect, it, vi } from "vitest";
import { makePgWeightRepository } from "../../../../src/adapters/pg/weight.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const row = (over: Record<string, unknown> = {}) => ({
	id: "w1",
	chat_id: "1",
	day: "2026-07-01",
	grams: 3400,
	user_id: "2",
	user_name: "papà",
	created_at: new Date("2026-07-01T09:00:00Z"),
	overwritten: false,
	...over,
});

const newReading = {
	chatId: 1,
	day: "2026-07-01",
	grams: 3400,
	userId: 2,
	userName: "papà",
};

describe("[PG weight repo]", () => {
	it("upsert issues ON CONFLICT, passes params in column order, maps overwritten", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.upsert(newReading);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.reading.grams).toBe(3400);
			expect(r.data.reading.chatId).toBe(1);
			expect(r.data.overwritten).toBe(false);
		}
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO weights");
		expect(sql).toContain("ON CONFLICT (chat_id, day)");
		expect(params).toEqual([1, "2026-07-01", 3400, 2, "papà"]);
	});

	it("upsert reports overwritten=true when xmax indicates an update", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ overwritten: true })]),
		};
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.upsert(newReading);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.overwritten).toBe(true);
	});

	it("list orders by day and maps rows", async () => {
		const db = {
			query: vi
				.fn()
				.mockResolvedValue([row(), row({ id: "w2", day: "2026-07-08" })]),
		};
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.list(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toHaveLength(2);
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("FROM weights");
		expect(sql).toContain("ORDER BY day");
		expect(params).toEqual([1]);
	});

	it("returns an error Result when the query throws", async () => {
		const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.list(1);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("db down");
	});
});
