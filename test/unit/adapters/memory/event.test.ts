import { describe, expect, it, vi } from "vitest";
import { makeMemoryEventRepository } from "../../../../src/adapters/memory/event.js";
import type { NewBabyEvent } from "../../../../src/domain/event.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const newEvent = (over: Partial<NewBabyEvent>): NewBabyEvent => ({
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: new Date("2026-07-02T09:00:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9",
	messageId: 1,
	...over,
});

describe("[MEMORY event repo]", () => {
	it("insert assigns id + createdAt and returns the event", async () => {
		const repo = makeMemoryEventRepository({ logger });
		const r = await repo.insert(newEvent({}));
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.id).toBeTruthy();
			expect(r.data.createdAt).toBeInstanceOf(Date);
			expect(r.data.type).toBe("eat");
		}
	});

	it("findOpenSession returns the open eat/sleep, ignoring instant + closed", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(newEvent({ type: "pee", startedAt: new Date() }));
		const open = await repo.insert(newEvent({ type: "sleep" }));
		const r = await repo.findOpenSession(1);
		expect(r.success).toBe(true);
		if (r.success && open.success) expect(r.data?.id).toBe(open.data.id);
	});

	it("closeSession sets endedAt so it is no longer open", async () => {
		const repo = makeMemoryEventRepository({ logger });
		const open = await repo.insert(newEvent({ type: "sleep" }));
		if (!open.success) throw new Error("setup");
		const end = new Date("2026-07-02T10:00:00+02:00");
		const closed = await repo.closeSession(open.data.id, end);
		expect(closed.success).toBe(true);
		if (closed.success) expect(closed.data.endedAt).toEqual(end);
		const r = await repo.findOpenSession(1);
		if (r.success) expect(r.data).toBeNull();
	});

	it("deleteLast removes and returns the most recent event", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(newEvent({ rawText: "first" }));
		await repo.insert(newEvent({ type: "pee", rawText: "second" }));
		const r = await repo.deleteLast(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data?.rawText).toBe("second");
	});

	it("listSince returns instants in-window and overlapping sessions", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(
			newEvent({
				type: "eat",
				startedAt: new Date("2026-07-01T09:00:00+02:00"),
				endedAt: new Date("2026-07-01T09:20:00+02:00"),
			}),
		);
		await repo.insert(
			newEvent({
				type: "pee",
				startedAt: new Date("2026-07-01T10:00:00+02:00"),
			}),
		);
		await repo.insert(
			newEvent({
				type: "pee",
				startedAt: new Date("2026-06-30T10:00:00+02:00"),
			}),
		);
		const r = await repo.listSince(
			1,
			new Date("2026-07-01T00:00:00+02:00"),
			new Date("2026-07-02T00:00:00+02:00"),
		);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toHaveLength(2);
	});

	it("findLastFeed returns the most recent eat WITH a side", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(
			newEvent({ side: "sx", startedAt: new Date("2026-07-02T08:00:00Z") }),
		);
		await repo.insert(
			newEvent({ type: "sleep", startedAt: new Date("2026-07-02T09:00:00Z") }),
		);
		await repo.insert(
			newEvent({ side: "dx", startedAt: new Date("2026-07-02T10:00:00Z") }),
		);
		// eat without a side (legacy) must be skipped
		await repo.insert(
			newEvent({ startedAt: new Date("2026-07-02T11:00:00Z") }),
		);
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data?.side).toBe("dx");
			expect(r.data?.startedAt).toEqual(new Date("2026-07-02T10:00:00Z"));
		}
	});

	it("findLastFeed returns null when no eat with a side exists", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(newEvent({ type: "pee", startedAt: new Date() }));
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});
});
