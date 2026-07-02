import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";

const FULL_ENV = {
	BOT_TOKEN: "tok",
	ALLOWED_CHAT_ID: "12345",
	DATABASE_URL: "postgres://x",
	GEMINI_API_KEY: "gk",
	CRON_SECRET: "cs",
	WEBHOOK_URL: "https://ex.com",
	WEBHOOK_SECRET: "whs",
};

describe("[CONFIG] getConfig", () => {
	let saved: NodeJS.ProcessEnv;
	beforeEach(() => {
		saved = { ...process.env };
		for (const k of [
			"BOT_TOKEN",
			"ALLOWED_CHAT_ID",
			"DATABASE_URL",
			"GEMINI_API_KEY",
			"GEMINI_MODEL",
			"CRON_SECRET",
			"WEBHOOK_URL",
			"WEBHOOK_SECRET",
			"BABY_NAME",
		]) {
			delete process.env[k];
		}
	});
	afterEach(() => {
		process.env = saved;
	});

	it("parses a full environment", () => {
		Object.assign(process.env, FULL_ENV, { BABY_NAME: "Leo" });
		const c = getConfig();
		expect(c.botToken).toBe("tok");
		expect(c.allowedChatId).toBe(12345);
		expect(c.geminiModel).toBe("gemini-2.0-flash"); // default
		expect(c.webhookSecret).toBe("whs");
		expect(c.babyName).toBe("Leo");
	});

	it("omits babyName when unset", () => {
		Object.assign(process.env, FULL_ENV);
		const c = getConfig();
		expect(c.babyName).toBeUndefined();
	});

	it("uses GEMINI_MODEL override when set", () => {
		Object.assign(process.env, FULL_ENV, { GEMINI_MODEL: "gemini-x" });
		expect(getConfig().geminiModel).toBe("gemini-x");
	});

	it("throws when a required var is missing", () => {
		Object.assign(process.env, FULL_ENV);
		delete process.env.BOT_TOKEN;
		expect(() => getConfig()).toThrow(/BOT_TOKEN/);
	});

	it("throws when ALLOWED_CHAT_ID is not numeric", () => {
		Object.assign(process.env, FULL_ENV, { ALLOWED_CHAT_ID: "nope" });
		expect(() => getConfig()).toThrow(/ALLOWED_CHAT_ID/);
	});
});
