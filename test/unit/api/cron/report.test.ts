import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../../api/cron/report";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

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
