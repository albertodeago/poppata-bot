import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../api/webhook";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

describe("[WEBHOOK] method + secret guard", () => {
	let prev: string | undefined;
	beforeEach(() => {
		prev = process.env.WEBHOOK_SECRET;
		process.env.WEBHOOK_SECRET = "whs";
	});
	afterEach(() => {
		if (prev === undefined) delete process.env.WEBHOOK_SECRET;
		else process.env.WEBHOOK_SECRET = prev;
	});

	it("405 for non-POST", async () => {
		const res = mockRes();
		await handler(
			{ method: "GET", headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it("401 when the secret header is missing", async () => {
		const res = mockRes();
		await handler(
			{ method: "POST", headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it("401 when the secret header is wrong", async () => {
		const res = mockRes();
		await handler(
			{
				method: "POST",
				headers: { "x-telegram-bot-api-secret-token": "nope" },
			} as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
