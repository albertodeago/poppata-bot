import { describe, expect, it, vi } from "vitest";
import { makeMemoryPendingRepository } from "../../../../src/adapters/memory/pending.js";
import type { NewPendingConfirmation } from "../../../../src/domain/pending.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const newPending = (): NewPendingConfirmation => ({
	chatId: 1,
	userId: 1,
	userName: "a",
	rawText: "inizio poppata 9",
	intent: {
		type: "eat",
		action: "start",
		at: new Date("2026-07-02T09:00:00+02:00"),
		source: "rules",
		confidence: 1,
	},
	warning: "sospetto",
	messageId: 1,
});

describe("[MEMORY pending repo]", () => {
	it("create then get returns the row", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		const created = await repo.create(newPending());
		expect(created.success).toBe(true);
		if (!created.success) return;
		const got = await repo.get(created.data.id);
		expect(got.success).toBe(true);
		if (got.success) expect(got.data?.id).toBe(created.data.id);
	});

	it("delete removes the row", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		const created = await repo.create(newPending());
		if (!created.success) return;
		await repo.delete(created.data.id);
		const got = await repo.get(created.data.id);
		if (got.success) expect(got.data).toBeNull();
	});

	it("deleteStale removes rows older than the cutoff", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		await repo.create(newPending());
		const future = new Date(Date.now() + 60_000);
		const r = await repo.deleteStale(future);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe(1);
	});

	it("findAmountPending returns the latest amount-kind pending for the chat", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		await repo.create({ ...newPending(), kind: "amount" });
		const r = await repo.findAmountPending(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data?.kind).toBe("amount");
	});

	it("findAmountPending ignores non-amount pendings and other chats", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		await repo.create(newPending()); // no kind
		await repo.create({ ...newPending(), chatId: 2, kind: "amount" });
		const r = await repo.findAmountPending(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});
});
