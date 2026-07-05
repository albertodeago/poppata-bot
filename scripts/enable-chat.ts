/**
 * Manually register (enable) a chat, bypassing the self-serve cap.
 *
 *   npm run enable-chat -- <chatId> [nome]
 *
 * Use it to seed the existing chat(s) at cutover, or to honour a request-access
 * issue once the bot is at its MAX_CHATS limit. Reads DATABASE_URL from .env
 * (use the Session pooler / 5432 string, same as migrations).
 */
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { makePgChatConfigRepository } from "../src/adapters/pg/chatConfig.js";

loadEnv({ path: ".env" });

const chatIdArg = process.argv[2];
const name = process.argv.slice(3).join(" ").trim();

if (!chatIdArg) {
	console.error("Usage: npm run enable-chat -- <chatId> [nome]");
	process.exit(1);
}
const chatId = Number.parseInt(chatIdArg, 10);
if (Number.isNaN(chatId)) {
	console.error(`Invalid chatId: ${chatIdArg}`);
	process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("DATABASE_URL is not set (add it to .env)");
	process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const db = {
	query: async (sql: string, params?: unknown[]) => {
		const r = await pool.query(sql, params);
		return r.rows;
	},
};
const repo = makePgChatConfigRepository({ db, logger: console });

const run = async (): Promise<void> => {
	const created = await repo.create({
		chatId,
		createdByName: "enable-chat script",
	});
	if (!created.success) {
		console.error("create failed:", created.error);
		process.exit(1);
	}
	if (name) {
		const set = await repo.setBabyName(chatId, name);
		if (!set.success) {
			console.error("setBabyName failed:", set.error);
			process.exit(1);
		}
	}
	console.log(`✅ Enabled chat ${chatId}${name ? ` (${name})` : ""}`);
	await pool.end();
};

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
