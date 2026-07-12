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
	reports_enabled: true,
	status: "approved",
	username: null,
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

	it("get maps status and username from the columns", async () => {
		const db = {
			query: vi
				.fn()
				.mockResolvedValue([row({ status: "pending", username: "tizio" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		if (r.success) {
			expect(r.data?.status).toBe("pending");
			expect(r.data?.username).toBe("tizio");
		}
	});

	it("get omits username when null", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		if (r.success) expect(r.data?.username).toBeUndefined();
	});

	it("create inserts ON CONFLICT DO NOTHING with chatId, name and username", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ status: "pending" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.create({
			chatId: -100123,
			createdByName: "papà",
			username: "tizio",
		});
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.status).toBe("pending");
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO chat_configs");
		expect(sql).toContain("ON CONFLICT (chat_id) DO NOTHING");
		expect(params).toEqual([-100123, "papà", "tizio"]);
	});

	it("create passes null username when absent", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ status: "pending" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		await repo.create({ chatId: -100123, createdByName: "papà" });
		const [, params] = db.query.mock.calls[0] ?? [];
		expect(params).toEqual([-100123, "papà", null]);
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

	it("setStatus updates the status column and returns the mapped row", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ status: "banned" })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.setStatus(-100123, "banned");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.status).toBe("banned");
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("UPDATE chat_configs");
		expect(sql).toContain("status");
		expect(params).toEqual([-100123, "banned"]);
	});

	it("setStatus errors when no row matches", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.setStatus(-100123, "approved");
		expect(r.success).toBe(false);
	});

	it("listAll maps every approved row and filters by status", async () => {
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
		expect(db.query.mock.calls[0]?.[0]).toContain("status = 'approved'");
	});

	it("returns an error Result when the query throws", async () => {
		const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("db down");
	});

	it("get maps reportsEnabled from the column", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ reports_enabled: false })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.get(-100123);
		if (r.success) expect(r.data?.reportsEnabled).toBe(false);
	});

	it("setReportsEnabled upserts and returns the mapped row", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ reports_enabled: false })]),
		};
		const repo = makePgChatConfigRepository({ db, logger });
		const r = await repo.setReportsEnabled(-100123, false);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.reportsEnabled).toBe(false);
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO chat_configs");
		expect(sql).toContain("ON CONFLICT (chat_id) DO UPDATE");
		expect(sql).toContain("reports_enabled");
		expect(params).toEqual([-100123, false]);
	});
});
