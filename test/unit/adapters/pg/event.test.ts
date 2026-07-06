import { describe, expect, it, vi } from "vitest";
import { makePgEventRepository } from "../../../../src/adapters/pg/event.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const row = (over: Record<string, unknown> = {}) => ({
	id: "e1",
	chat_id: "1",
	user_id: "2",
	user_name: "papà",
	type: "eat",
	side: "dx",
	started_at: new Date("2026-07-02T09:00:00Z"),
	ended_at: null,
	source: "rules",
	raw_text: "inizio poppata dx 9",
	message_id: "100",
	created_at: new Date("2026-07-02T09:00:00Z"),
	...over,
});

describe("[PG event repo]", () => {
	it("insert maps the returned row and passes params in column order", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.insert({
			chatId: 1,
			userId: 2,
			userName: "papà",
			type: "eat",
			side: "dx",
			startedAt: new Date("2026-07-02T09:00:00Z"),
			source: "rules",
			rawText: "inizio poppata dx 9",
			messageId: 100,
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.chatId).toBe(1);
			expect(r.data.messageId).toBe(100);
			expect(r.data.side).toBe("dx");
			expect(r.data.endedAt).toBeUndefined();
		}
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO events");
		// side present, ended_at null (position 7)
		expect(params?.[4]).toBe("dx");
		expect(params?.[6]).toBeNull();
	});

	it("insert passes null for an absent side", async () => {
		const db = { query: vi.fn().mockResolvedValue([row({ side: null })]) };
		const repo = makePgEventRepository({ db, logger });
		await repo.insert({
			chatId: 1,
			userId: 2,
			userName: "papà",
			type: "sleep",
			startedAt: new Date(),
			source: "rules",
			rawText: "nanna",
			messageId: 1,
		});
		const params = db.query.mock.calls[0]?.[1];
		expect(params?.[4]).toBeNull();
	});

	it("insert persists amount_ml for a bottle and maps it back", async () => {
		const db = {
			query: vi
				.fn()
				.mockResolvedValue([
					row({ type: "bottle", side: null, amount_ml: 100 }),
				]),
		};
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.insert({
			chatId: 1,
			userId: 2,
			userName: "papà",
			type: "bottle",
			startedAt: new Date("2026-07-02T09:00:00Z"),
			source: "rules",
			rawText: "biberon 100",
			messageId: 100,
			amountMl: 100,
		});
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.amountMl).toBe(100);
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("amount_ml");
		expect(params).toContain(100);
	});

	it("listSince counts bottle among the instant event types", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgEventRepository({ db, logger });
		await repo.listSince(1, new Date(), new Date());
		const sql = db.query.mock.calls[0]?.[0] ?? "";
		expect(sql).toContain("bottle");
	});

	it("findOpenSession returns null when no rows", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findOpenSession(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});

	it("closeSession maps ended_at", async () => {
		const ended = new Date("2026-07-02T09:40:00Z");
		const db = { query: vi.fn().mockResolvedValue([row({ ended_at: ended })]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.closeSession("e1", ended);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.endedAt).toEqual(ended);
	});

	it("listSince maps all rows and passes the window params", async () => {
		const db = { query: vi.fn().mockResolvedValue([row(), row({ id: "e2" })]) };
		const repo = makePgEventRepository({ db, logger });
		const start = new Date("2026-07-01T00:00:00Z");
		const end = new Date("2026-07-02T00:00:00Z");
		const r = await repo.listSince(1, start, end);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toHaveLength(2);
		expect(db.query.mock.calls[0]?.[1]).toEqual([1, start, end]);
	});

	it("findLastFeed queries the latest eat-with-side and maps the row", async () => {
		const db = { query: vi.fn().mockResolvedValue([row({ side: "sx" })]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data?.side).toBe("sx");
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("type = 'eat'");
		expect(sql).toContain("side IS NOT NULL");
		expect(sql).toContain("ORDER BY started_at DESC");
		expect(params).toEqual([1]);
	});

	it("findLastFeed returns null when no rows", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});

	it("returns an error Result when the query throws", async () => {
		const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findOpenSession(1);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("db down");
	});
});
