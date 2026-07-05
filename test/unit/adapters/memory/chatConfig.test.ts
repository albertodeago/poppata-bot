import { describe, expect, it, vi } from "vitest";
import { makeMemoryChatConfigRepository } from "../../../../src/adapters/memory/chatConfig.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

describe("[MEMORY chatConfig repo]", () => {
	it("get returns null for an unknown chat", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		const r = await repo.get(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});

	it("create registers a chat with no name yet", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		const c = await repo.create({ chatId: 1, createdByName: "papà" });
		expect(c.success).toBe(true);
		if (c.success) {
			expect(c.data.chatId).toBe(1);
			expect(c.data.babyName).toBeUndefined();
		}
		const got = await repo.get(1);
		if (got.success) expect(got.data?.chatId).toBe(1);
	});

	it("create is idempotent — a second call keeps the existing row", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setBabyName(1, "Leo");
		await repo.create({ chatId: 1, createdByName: "mamma" });
		const got = await repo.get(1);
		if (got.success) expect(got.data?.babyName).toBe("Leo");
		const n = await repo.count();
		if (n.success) expect(n.data).toBe(1);
	});

	it("setBabyName sets and replaces the name", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setBabyName(1, "Leo");
		let got = await repo.get(1);
		if (got.success) expect(got.data?.babyName).toBe("Leo");
		await repo.setBabyName(1, "Gigi");
		got = await repo.get(1);
		if (got.success) expect(got.data?.babyName).toBe("Gigi");
	});

	it("count reflects the number of registered chats", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		expect((await repo.count()).success).toBe(true);
		await repo.create({ chatId: 1, createdByName: "a" });
		await repo.create({ chatId: 2, createdByName: "b" });
		const n = await repo.count();
		if (n.success) expect(n.data).toBe(2);
	});

	it("listAll returns every registered chat", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "a" });
		await repo.setBabyName(1, "Leo");
		await repo.create({ chatId: 2, createdByName: "b" });
		const r = await repo.listAll();
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.map((c) => c.chatId).sort()).toEqual([1, 2]);
			expect(r.data.find((c) => c.chatId === 1)?.babyName).toBe("Leo");
		}
	});
});
