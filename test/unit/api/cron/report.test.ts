import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	sendDailyReport: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
	sendWeeklyReport: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
	listAll: vi.fn(),
	deleteStale: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/domain/commands.js", () => ({
	sendDailyReport: h.sendDailyReport,
	sendWeeklyReport: h.sendWeeklyReport,
}));

vi.mock("../../../../src/env.js", () => ({
	makeEnv: () => ({
		chatConfigRepository: { listAll: h.listAll },
		pendingRepository: { deleteStale: h.deleteStale },
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			log: vi.fn(),
		},
	}),
}));

import handler from "../../../../api/cron/report.js";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

describe("[CRON report] per-chat toggle", () => {
	let prev: string | undefined;
	beforeEach(() => {
		prev = process.env.CRON_SECRET;
		vi.clearAllMocks();
		process.env.CRON_SECRET = "secret";
	});
	afterEach(() => {
		if (prev === undefined) delete process.env.CRON_SECRET;
		else process.env.CRON_SECRET = prev;
	});

	it("reports to enabled chats and skips disabled ones", async () => {
		h.listAll.mockResolvedValue({
			success: true,
			data: [
				{ chatId: 1, babyName: "Leo", reportsEnabled: true },
				{ chatId: 2, reportsEnabled: false },
			],
		});
		const res = mockRes();
		await handler(
			{
				headers: { authorization: "Bearer secret" },
			} as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(200);
		const dailyChatIds = h.sendDailyReport.mock.calls.map(
			(c) => (c as unknown[])[0],
		);
		expect(dailyChatIds).toContain(1);
		expect(dailyChatIds).not.toContain(2);
	});
});

describe("[CRON report] auth guard", () => {
	let prev: string | undefined;
	beforeEach(() => {
		prev = process.env.CRON_SECRET;
		process.env.CRON_SECRET = "secret";
	});
	afterEach(() => {
		if (prev === undefined) delete process.env.CRON_SECRET;
		else process.env.CRON_SECRET = prev;
	});

	it("401 when the Authorization header is missing", async () => {
		const res = mockRes();
		await handler(
			{ headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it("401 when the bearer token is wrong", async () => {
		const res = mockRes();
		await handler(
			{ headers: { authorization: "Bearer nope" } } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
