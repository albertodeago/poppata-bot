import { describe, expect, it, vi } from "vitest";
import { makePgPendingRepository } from "../../../../src/adapters/pg/pending.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const intentJson = {
	type: "eat",
	action: "start",
	at: "2026-07-02T07:00:00.000Z",
	source: "rules",
	confidence: 1,
	side: "dx",
};

const row = (over: Record<string, unknown> = {}) => ({
	id: "p1",
	chat_id: "1",
	user_id: "2",
	user_name: "papà",
	raw_text: "inizio poppata dx 9",
	intent: intentJson,
	warning: "sospetto",
	message_id: "100",
	created_at: new Date("2026-07-02T07:00:00Z"),
	...over,
});

describe("[PG pending repo]", () => {
	it("create serializes intent.at to ISO and rehydrates on the returned row", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.create({
			chatId: 1,
			userId: 2,
			userName: "papà",
			rawText: "inizio poppata dx 9",
			intent: {
				type: "eat",
				action: "start",
				at: new Date("2026-07-02T07:00:00Z"),
				source: "rules",
				confidence: 1,
				side: "dx",
			},
			warning: "sospetto",
			messageId: 100,
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.rawText).toBe("inizio poppata dx 9");
			expect(r.data.intent.at).toBeInstanceOf(Date);
			expect(r.data.intent.at.toISOString()).toBe("2026-07-02T07:00:00.000Z");
			expect(r.data.intent.side).toBe("dx");
		}
		const params = db.query.mock.calls[0]?.[1];
		expect(params?.[3]).toBe("inizio poppata dx 9"); // raw_text
		const storedIntent = JSON.parse(params?.[4]); // intent jsonb (stringified)
		expect(storedIntent.at).toBe("2026-07-02T07:00:00.000Z");
		expect(storedIntent.side).toBe("dx");
	});

	it("get returns null when missing", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.get("nope");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});

	it("delete resolves to void success", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.delete("p1");
		expect(r.success).toBe(true);
		expect(db.query.mock.calls[0]?.[0]).toContain(
			"DELETE FROM pending_confirmations",
		);
	});

	it("deleteStale returns the deleted count", async () => {
		const db = { query: vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.deleteStale(new Date());
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe(2);
	});

	it("create persists the kind and serializes intent.amountMl", async () => {
		const db = { query: vi.fn().mockResolvedValue([row({ kind: "amount" })]) };
		const repo = makePgPendingRepository({ db, logger });
		await repo.create({
			chatId: 1,
			userId: 2,
			userName: "papà",
			rawText: "biberon 400",
			intent: {
				type: "bottle",
				action: "instant",
				at: new Date("2026-07-02T07:00:00Z"),
				source: "rules",
				confidence: 1,
				amountMl: 400,
			},
			warning: "Biberon di 400 ml, confermi?",
			messageId: 100,
			kind: "amount",
		});
		const params = db.query.mock.calls[0]?.[1];
		const storedIntent = JSON.parse(params?.[4]);
		expect(storedIntent.amountMl).toBe(400);
		// kind is passed as a bound parameter
		expect(params).toContain("amount");
	});

	it("findAmountPending queries by chat + amount kind and maps the row", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row({ kind: "amount" })]),
		};
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.findAmountPending(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data?.kind).toBe("amount");
		const sql = db.query.mock.calls[0]?.[0] ?? "";
		expect(sql).toContain("kind");
	});
});
