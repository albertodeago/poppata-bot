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
			"MAX_CHATS",
			"REPO_ISSUES_URL",
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

	it("defaults maxChats to 5 and repoIssuesUrl to the repo issues URL", () => {
		Object.assign(process.env, FULL_ENV);
		const c = getConfig();
		expect(c.maxChats).toBe(5);
		expect(c.repoIssuesUrl).toBe(
			"https://github.com/albertodeago/poppata-bot/issues",
		);
	});

	it("uses MAX_CHATS and REPO_ISSUES_URL overrides when set", () => {
		Object.assign(process.env, FULL_ENV, {
			MAX_CHATS: "20",
			REPO_ISSUES_URL: "https://github.com/x/y/issues",
		});
		const c = getConfig();
		expect(c.maxChats).toBe(20);
		expect(c.repoIssuesUrl).toBe("https://github.com/x/y/issues");
	});

	it("throws when MAX_CHATS is not a positive number", () => {
		Object.assign(process.env, FULL_ENV, { MAX_CHATS: "nope" });
		expect(() => getConfig()).toThrow(/MAX_CHATS/);
	});
});
