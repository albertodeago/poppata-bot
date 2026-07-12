import { describe, expect, it } from "vitest";
import { approveChat, banChat } from "../../../src/domain/access.js";
import { error, success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

describe("[ACCESS] approveChat", () => {
	it("approves the chat and notifies the requester", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.setStatus.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: true, status: "approved" }),
		);
		const r = await approveChat(1)(env);
		expect(mocks.chatConfigRepository.setStatus).toHaveBeenCalledWith(
			1,
			"approved",
		);
		expect(r.success).toBe(true);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			expect.stringContaining("approvato"),
		);
	});

	it("returns the failure and does not notify when setStatus fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.setStatus.mockResolvedValue(
			error(new Error("no chat")),
		);
		const r = await approveChat(1)(env);
		expect(r.success).toBe(false);
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});
});

describe("[ACCESS] banChat", () => {
	it("bans the chat silently — no message to the target", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.setStatus.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: true, status: "banned" }),
		);
		const r = await banChat(1)(env);
		expect(mocks.chatConfigRepository.setStatus).toHaveBeenCalledWith(
			1,
			"banned",
		);
		expect(r.success).toBe(true);
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});
});
