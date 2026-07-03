import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
	sendDailyReport,
	sendWeeklyReport,
} from "../../src/domain/commands.js";
import { romeNow } from "../../src/domain/time.js";
import { makeEnv } from "../../src/env.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	const cronSecret = process.env.CRON_SECRET;
	if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	try {
		const env = makeEnv();
		const babyName = env.config.babyName;
		const now = new Date();
		const isMonday = romeNow(now).weekday === 1;
		const chatIds = env.config.allowedChatIds;

		env.logger.info(
			`Cron report starting: ${chatIds.length} chat(s), weekly=${isMonday}`,
		);

		// Each allow-listed chat gets its own report from its own data.
		for (const chatId of chatIds) {
			env.logger.info(`Cron: sending reports to chat ${chatId}`);
			await sendDailyReport(chatId, now, babyName)(env);
			if (isMonday) {
				await sendWeeklyReport(chatId, now, babyName)(env);
			}
			env.logger.info(`Cron: reports sent to chat ${chatId}`);
		}
		await env.pendingRepository.deleteStale(new Date(now.getTime() - DAY_MS));

		env.logger.info(`Cron report done: ${chatIds.length} chat(s)`);
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Cron report error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
