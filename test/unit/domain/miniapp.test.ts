import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	authorizeDecision,
	validateInitData,
} from "../../../src/domain/miniapp.js";

const TOKEN = "12345:abcdef";

/** Build a signed initData query string the same way Telegram does. */
const sign = (fields: Record<string, string>, token: string): string => {
	const params = new URLSearchParams(fields);
	const dataCheck = [...params.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");
	const secret = createHmac("sha256", "WebAppData").update(token).digest();
	const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
	params.set("hash", hash);
	return params.toString();
};

const NOW = new Date("2026-07-08T12:00:00Z");
const authDate = String(Math.floor(NOW.getTime() / 1000) - 30);

describe("[MINIAPP] validateInitData", () => {
	it("accepts a correctly signed payload and extracts user id + start_param", () => {
		const raw = sign(
			{
				user: JSON.stringify({ id: 42, first_name: "A" }),
				auth_date: authDate,
				start_param: "-100999",
			},
			TOKEN,
		);
		const res = validateInitData(raw, TOKEN, 86400, NOW);
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.userId).toBe(42);
			expect(res.data.startParam).toBe("-100999");
		}
	});

	it("includes signature in the hash (real initData carries a signature field)", () => {
		// Telegram computes `hash` over every field except `hash` itself — which
		// INCLUDES `signature`. Only the Ed25519 third-party check excludes signature.
		const raw = sign(
			{
				user: JSON.stringify({ id: 42 }),
				auth_date: authDate,
				start_param: "-100999",
				signature: "ZWQyNTUxOXNpZ25hdHVyZQ",
			},
			TOKEN,
		);
		const res = validateInitData(raw, TOKEN, 86400, NOW);
		expect(res.success).toBe(true);
		if (res.success) expect(res.data.startParam).toBe("-100999");
	});

	it("rejects a tampered field", () => {
		const raw = sign(
			{ user: JSON.stringify({ id: 42 }), auth_date: authDate },
			TOKEN,
		);
		const tampered = raw
			.replace(/id%22%3A42/, "id%22%3A99")
			.replace(/id":42/, 'id":99');
		const res = validateInitData(tampered, TOKEN, 86400, NOW);
		expect(res.success).toBe(false);
	});

	it("rejects a wrong token", () => {
		const raw = sign(
			{ user: JSON.stringify({ id: 42 }), auth_date: authDate },
			TOKEN,
		);
		expect(validateInitData(raw, "99999:zzz", 86400, NOW).success).toBe(false);
	});

	it("rejects a stale auth_date", () => {
		const stale = String(Math.floor(NOW.getTime() / 1000) - 90000);
		const raw = sign(
			{ user: JSON.stringify({ id: 42 }), auth_date: stale },
			TOKEN,
		);
		expect(validateInitData(raw, TOKEN, 86400, NOW).success).toBe(false);
	});

	it("rejects when hash is missing", () => {
		expect(
			validateInitData("user=%7B%7D&auth_date=1", TOKEN, 86400, NOW).success,
		).toBe(false);
	});
});

describe("[MINIAPP] authorizeDecision", () => {
	it("returns 'self' for a private chat (chatId === userId)", () => {
		expect(authorizeDecision({ chatId: 42, userId: 42 })).toBe("self");
	});
	it("returns 'needs-membership' for a group chat", () => {
		expect(authorizeDecision({ chatId: -100999, userId: 42 })).toBe(
			"needs-membership",
		);
	});
});
