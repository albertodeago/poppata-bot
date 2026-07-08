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
		const now = new Date();
		const isMonday = romeNow(now).weekday === 1;

		const listed = await env.chatConfigRepository.listAll();
		if (!listed.success) {
			env.logger.error("Cron: listAll failed", listed.error);
			return res.status(500).json({ error: "Internal server error" });
		}
		const chats = listed.data;

		env.logger.info(
			`Cron report starting: ${chats.length} chat(s), weekly=${isMonday}`,
		);

		// Each registered chat gets its own report from its own data and name.
		for (const chat of chats) {
			if (!chat.reportsEnabled) {
				env.logger.info(
					`Cron: skipping chat ${chat.chatId} (reports disabled)`,
				);
				continue;
			}
			env.logger.info(`Cron: sending reports to chat ${chat.chatId}`);
			await sendDailyReport(chat.chatId, now, chat.babyName)(env);
			if (isMonday) {
				await sendWeeklyReport(chat.chatId, now, chat.babyName)(env);
			}
			env.logger.info(`Cron: reports sent to chat ${chat.chatId}`);
		}
		await env.pendingRepository.deleteStale(new Date(now.getTime() - DAY_MS));

		env.logger.info(`Cron report done: ${chats.length} chat(s)`);
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Cron report error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
