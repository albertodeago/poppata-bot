import { describe, expect, it, vi } from "vitest";
import { makePgChatConfigRepository } from "../../../../src/adapters/pg/chatConfig.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const row = (over: Record<string, unknown> = {}) => ({
	chat_id: "-100123",
	baby_name: null,
	...over,
});

describe("[PG chatConfig repo]", () => {
	it("get returns null when no row exists", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("FROM chat_configs");
		expect(params).toEqual([-100123]);
	});

	it("get maps a row, omitting babyName when null", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		if (r.success) {
			expect(r.data?.chatId).toBe(-100123);
			expect(r.data?.babyName).toBeUndefined();
		}
	});

	it("get maps babyName when present", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ baby_name: "Leo" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		if (r.success) expect(r.data?.babyName).toBe("Leo");
	});

	it("count returns the integer count", async () => {
		const db = { query: vi.fn().mockResolvedValue([{ n: 3 }]) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.count();
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe(3);
		expect(db.query.mock.calls[0]?.[0]).toContain("count(*)");
	});

	it("create inserts ON CONFLICT DO NOTHING and passes chatId + name", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.create({ chatId: -100123, createdByName: "papà" });
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.chatId).toBe(-100123);
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO chat_configs");
		expect(sql).toContain("ON CONFLICT (chat_id) DO NOTHING");
		expect(params).toEqual([-100123, "papà"]);
	});

	it("create falls back to get when the row already existed (conflict)", async () => {
		const db = {
			query: vi
				.fn()
				.mockResolvedValueOnce([]) // INSERT ... DO NOTHING → no row
				.mockResolvedValueOnce([row({ baby_name: "Leo" })]), // get
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.create({ chatId: -100123, createdByName: "papà" });
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.babyName).toBe("Leo");
		expect(db.query).toHaveBeenCalledTimes(2);
	});

	it("setBabyName upserts and returns the new name", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ baby_name: "Gigi" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.setBabyName(-100123, "Gigi");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.babyName).toBe("Gigi");
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("ON CONFLICT (chat_id) DO UPDATE");
		expect(params).toEqual([-100123, "Gigi"]);
	});

	it("listAll maps every row", async () => {
		const db = {
			query: vi
				.fn()
				.mockResolvedValue([row(), row({ chat_id: "-200", baby_name: "Leo" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.listAll();
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data).toHaveLength(2);
			expect(r.data[1]?.babyName).toBe("Leo");
		}
	});

	it("returns an error Result when the query throws", async () => {
		const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.count();
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("db down");
	});
});
