import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config.js";

const FULL_ENV = {
	BOT_TOKEN: "tok",
	DATABASE_URL: "postgres://x",
	GEMINI_API_KEY: "gk",
	CRON_SECRET: "cs",
	WEBHOOK_URL: "https://ex.com",
	WEBHOOK_SECRET: "whs",
	MINIAPP_URL: "https://t.me/Bot/app",
	ADMIN_CHAT_ID: "-5401484779",
};

describe("[CONFIG] getConfig", () => {
	let saved: NodeJS.ProcessEnv;
	beforeEach(() => {
		saved = { ...process.env };
		for (const k of [
			"BOT_TOKEN",
			"DATABASE_URL",
			"GEMINI_API_KEY",
			"GEMINI_MODEL",
			"CRON_SECRET",
			"WEBHOOK_URL",
			"WEBHOOK_SECRET",
			"MINIAPP_URL",
			"ADMIN_CHAT_ID",
		]) {
			delete process.env[k];
		}
	});
	afterEach(() => {
		process.env = saved;
	});

	it("parses a full environment", () => {
		Object.assign(process.env, FULL_ENV);
		const c = getConfig();
		expect(c.botToken).toBe("tok");
		expect(c.geminiModel).toBe("gemini-2.0-flash"); // default
		expect(c.webhookSecret).toBe("whs");
		expect(c.miniAppUrl).toBe("https://t.me/Bot/app");
	});

	it("uses GEMINI_MODEL override when set", () => {
		Object.assign(process.env, FULL_ENV, { GEMINI_MODEL: "gemini-x" });
		expect(getConfig().geminiModel).toBe("gemini-x");
	});

	it("derives guideUrl from WEBHOOK_URL, stripping a trailing slash", () => {
		Object.assign(process.env, FULL_ENV);
		expect(getConfig().guideUrl).toBe("https://ex.com/guida.html");
		Object.assign(process.env, FULL_ENV, { WEBHOOK_URL: "https://ex.com/" });
		expect(getConfig().guideUrl).toBe("https://ex.com/guida.html");
	});

	it("throws when a required var is missing", () => {
		Object.assign(process.env, FULL_ENV);
		delete process.env.BOT_TOKEN;
		expect(() => getConfig()).toThrow(/BOT_TOKEN/);
	});

	it("throws when MINIAPP_URL is missing", () => {
		Object.assign(process.env, FULL_ENV);
		delete process.env.MINIAPP_URL;
		expect(() => getConfig()).toThrow(/MINIAPP_URL/);
	});

	it("parses ADMIN_CHAT_ID into a number (negative group id)", () => {
		Object.assign(process.env, FULL_ENV);
		expect(getConfig().adminChatId).toBe(-5401484779);
	});

	it("throws when ADMIN_CHAT_ID is missing", () => {
		Object.assign(process.env, FULL_ENV);
		delete process.env.ADMIN_CHAT_ID;
		expect(() => getConfig()).toThrow(/ADMIN_CHAT_ID/);
	});

	it("throws when ADMIN_CHAT_ID is not a number", () => {
		Object.assign(process.env, FULL_ENV, { ADMIN_CHAT_ID: "nope" });
		expect(() => getConfig()).toThrow(/ADMIN_CHAT_ID/);
	});

	it("throws when ADMIN_CHAT_ID has trailing junk (no silent partial parse)", () => {
		Object.assign(process.env, FULL_ENV, { ADMIN_CHAT_ID: "-100 foo" });
		expect(() => getConfig()).toThrow(/ADMIN_CHAT_ID/);
	});
});
