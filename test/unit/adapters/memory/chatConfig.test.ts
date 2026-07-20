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

	it("create registers a chat as pending with no name yet", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		const c = await repo.create({ chatId: 1, createdByName: "papà" });
		expect(c.success).toBe(true);
		if (c.success) {
			expect(c.data.chatId).toBe(1);
			expect(c.data.status).toBe("pending");
			expect(c.data.language).toBe("it");
			expect(c.data.babyName).toBeUndefined();
		}
		const got = await repo.get(1);
		if (got.success) expect(got.data?.chatId).toBe(1);
	});

	it("create stores an explicit language", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "Dad", language: "en" });
		const got = await repo.get(1);
		if (got.success) expect(got.data?.language).toBe("en");
	});

	it("create stores the requester username when provided", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà", username: "tizio" });
		const got = await repo.get(1);
		if (got.success) expect(got.data?.username).toBe("tizio");
	});

	it("create is idempotent — a second call keeps the existing row", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setBabyName(1, "Leo");
		await repo.create({ chatId: 1, createdByName: "mamma" });
		const got = await repo.get(1);
		if (got.success) expect(got.data?.babyName).toBe("Leo");
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

	it("setStatus moves the chat through its lifecycle, preserving other fields", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setBabyName(1, "Leo");
		await repo.setReportsEnabled(1, false);
		await repo.setLanguage(1, "en");
		const set = await repo.setStatus(1, "approved");
		expect(set.success).toBe(true);
		if (set.success) expect(set.data.status).toBe("approved");
		const got = await repo.get(1);
		if (got.success) {
			expect(got.data?.status).toBe("approved");
			expect(got.data?.babyName).toBe("Leo");
			expect(got.data?.language).toBe("en");
			expect(got.data?.reportsEnabled).toBe(false);
		}
	});

	it("setStatus errors when the chat has no row (parity with pg)", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		const r = await repo.setStatus(999, "approved");
		expect(r.success).toBe(false);
		const got = await repo.get(999);
		if (got.success) expect(got.data).toBeNull();
	});

	it("setLanguage toggles the language and preserves other fields", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setStatus(1, "approved");
		await repo.setBabyName(1, "Leo");
		await repo.setReportsEnabled(1, false);
		await repo.setLanguage(1, "en");
		const got = await repo.get(1);
		if (got.success) {
			expect(got.data?.language).toBe("en");
			expect(got.data?.babyName).toBe("Leo");
			expect(got.data?.reportsEnabled).toBe(false);
			expect(got.data?.status).toBe("approved");
		}
	});

	it("listAll returns only approved chats", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "a" });
		await repo.setStatus(1, "approved");
		await repo.setBabyName(1, "Leo");
		await repo.create({ chatId: 2, createdByName: "b" }); // stays pending
		await repo.create({ chatId: 3, createdByName: "c" });
		await repo.setStatus(3, "banned");
		const r = await repo.listAll();
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.map((c) => c.chatId)).toEqual([1]);
			expect(r.data[0]?.babyName).toBe("Leo");
		}
	});

	it("create defaults reportsEnabled to true", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		const c = await repo.create({ chatId: 1, createdByName: "papà" });
		if (c.success) expect(c.data.reportsEnabled).toBe(true);
	});

	it("setReportsEnabled toggles the flag and round-trips via get", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setReportsEnabled(1, false);
		let got = await repo.get(1);
		if (got.success) expect(got.data?.reportsEnabled).toBe(false);
		await repo.setReportsEnabled(1, true);
		got = await repo.get(1);
		if (got.success) expect(got.data?.reportsEnabled).toBe(true);
	});

	it("setBabyName preserves an existing reportsEnabled and status", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setStatus(1, "approved");
		await repo.setReportsEnabled(1, false);
		await repo.setBabyName(1, "Leo");
		const got = await repo.get(1);
		if (got.success) {
			expect(got.data?.babyName).toBe("Leo");
			expect(got.data?.reportsEnabled).toBe(false);
			expect(got.data?.status).toBe("approved");
		}
	});

	it("setReportsEnabled preserves an existing babyName and status", async () => {
		const repo = makeMemoryChatConfigRepository({ logger });
		await repo.create({ chatId: 1, createdByName: "papà" });
		await repo.setStatus(1, "approved");
		await repo.setBabyName(1, "Leo");
		await repo.setReportsEnabled(1, false);
		const got = await repo.get(1);
		if (got.success) {
			expect(got.data?.babyName).toBe("Leo");
			expect(got.data?.reportsEnabled).toBe(false);
			expect(got.data?.status).toBe("approved");
		}
	});
});
