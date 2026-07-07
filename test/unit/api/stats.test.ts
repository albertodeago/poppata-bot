import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../api/stats.js";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

const FULL_ENV = {
	BOT_TOKEN: "tok",
	DATABASE_URL: "postgres://x",
	GEMINI_API_KEY: "gk",
	CRON_SECRET: "cs",
	WEBHOOK_URL: "https://ex.com",
	WEBHOOK_SECRET: "whs",
	MINIAPP_URL: "https://t.me/Bot/app",
};

describe("[STATS] guards", () => {
	let saved: NodeJS.ProcessEnv;
	beforeEach(() => {
		saved = { ...process.env };
		Object.assign(process.env, FULL_ENV);
	});
	afterEach(() => {
		process.env = saved;
	});

	it("405 for non-GET", async () => {
		const res = mockRes();
		await handler(
			{ method: "POST", headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it("401 when the init-data header is missing", async () => {
		const res = mockRes();
		await handler(
			{ method: "GET", headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it("401 when the init-data is invalid", async () => {
		const res = mockRes();
		await handler(
			{
				method: "GET",
				headers: {
					"x-telegram-init-data": "user=%7B%7D&auth_date=1&hash=deadbeef",
				},
			} as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
