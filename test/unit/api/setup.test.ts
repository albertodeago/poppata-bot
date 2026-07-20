import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { COMMANDS, ENGLISH_COMMANDS } from "../../../api/setup.js";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

describe("[SETUP] command list", () => {
	it("includes /grafici", () => {
		expect(COMMANDS.some((c) => c.command === "grafici")).toBe(true);
	});

	it("includes /guida", () => {
		expect(COMMANDS.some((c) => c.command === "guida")).toBe(true);
	});

	it("COMMANDS includes the report toggle", () => {
		expect(COMMANDS.some((c) => c.command === "report")).toBe(true);
	});

	it("ENGLISH_COMMANDS includes English aliases", () => {
		expect(ENGLISH_COMMANDS.some((c) => c.command === "charts")).toBe(true);
		expect(ENGLISH_COMMANDS.some((c) => c.command === "weight")).toBe(true);
		expect(ENGLISH_COMMANDS.some((c) => c.command === "help")).toBe(true);
	});
});

describe("[SETUP] auth guard", () => {
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
