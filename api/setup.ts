import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeEnv } from "../src/env.js";

export const COMMANDS = [
	{ command: "grafici", description: "Grafici e statistiche" },
	{ command: "stato", description: "Sessione in corso" },
	{ command: "oggi", description: "Statistiche di oggi" },
	{ command: "ieri", description: "Statistiche di ieri" },
	{ command: "settimana", description: "Statistiche della settimana" },
	{ command: "scaletta", description: "La giornata evento per evento" },
	{ command: "annulla", description: "Rimuove l'ultimo evento" },
	{ command: "seno", description: "Ultimo seno usato" },
	{ command: "peso", description: "Peso: registra o mostra lo storico" },
	{ command: "nome", description: "Imposta il nome del bimbo/a" },
	{ command: "lingua", description: "Cambia lingua del bot" },
	{ command: "report", description: "Report automatici on/off" },
	{ command: "proponi", description: "Invia un'idea o un problema" },
	{ command: "guida", description: "Guida visuale al bot" },
	{ command: "help", description: "Aiuto" },
];

export const ENGLISH_COMMANDS = [
	{ command: "charts", description: "Charts and statistics" },
	{ command: "status", description: "Current open session" },
	{ command: "today", description: "Today's stats" },
	{ command: "yesterday", description: "Yesterday's stats" },
	{ command: "week", description: "This week's stats" },
	{ command: "schedule", description: "Today's events, one by one" },
	{ command: "undo", description: "Remove the latest event" },
	{ command: "breast", description: "Latest breast side used" },
	{ command: "weight", description: "Weight: record or show history" },
	{ command: "name", description: "Set the baby's name" },
	{ command: "language", description: "Change bot language" },
	{ command: "report", description: "Automatic reports on/off" },
	{ command: "suggest", description: "Send an idea or problem" },
	{ command: "guide", description: "Visual guide to the bot" },
	{ command: "help", description: "Help" },
];

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
		const url = `${env.config.webhookUrl.replace(/\/$/, "")}/api/webhook`;
		await env.telegrafBot.telegram.setWebhook(url, {
			// my_chat_member is required for the add-to-group auto-welcome — Telegram
			// drops any update type not listed here.
			allowed_updates: ["message", "callback_query", "my_chat_member"] as const,
			secret_token: env.config.webhookSecret,
		});
		await env.telegrafBot.telegram.setMyCommands(COMMANDS);
		await env.telegrafBot.telegram.setMyCommands(COMMANDS, {
			language_code: "it",
		});
		await env.telegrafBot.telegram.setMyCommands(ENGLISH_COMMANDS, {
			language_code: "en",
		});
		return res.status(200).json({ ok: true, webhook: url });
	} catch (error) {
		console.error("Setup error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
