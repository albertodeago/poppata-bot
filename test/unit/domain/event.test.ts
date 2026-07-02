import { describe, expect, it } from "vitest";
import { type BabyEvent, isOpenSession } from "../../../src/domain/event";

const base: BabyEvent = {
	id: "1",
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: new Date(),
	source: "rules",
	rawText: "poppata",
	messageId: 1,
	createdAt: new Date(),
};

describe("[EVENT] isOpenSession", () => {
	it("open eat/sleep with no endedAt is an open session", () => {
		expect(isOpenSession({ ...base, type: "eat" })).toBe(true);
		expect(isOpenSession({ ...base, type: "sleep" })).toBe(true);
	});

	it("closed session is not open", () => {
		expect(isOpenSession({ ...base, endedAt: new Date() })).toBe(false);
	});

	it("instant events are never open sessions", () => {
		expect(isOpenSession({ ...base, type: "pee" })).toBe(false);
		expect(isOpenSession({ ...base, type: "poop" })).toBe(false);
	});
});
