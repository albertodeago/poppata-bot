import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeEnv } from "../src/env.js";

const COMMANDS = [
	{ command: "stato", description: "Sessione in corso" },
	{ command: "oggi", description: "Statistiche di oggi" },
	{ command: "ieri", description: "Statistiche di ieri" },
	{ command: "settimana", description: "Statistiche della settimana" },
	{ command: "scaletta", description: "La giornata evento per evento" },
	{ command: "annulla", description: "Rimuove l'ultimo evento" },
	{ command: "seno", description: "Ultimo seno usato" },
	{ command: "peso", description: "Peso: registra o mostra lo storico" },
	{ command: "nome", description: "Imposta il nome del bimbo/a" },
	{ command: "help", description: "Aiuto" },
];

export default async function handler(
	_req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
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
		return res.status(200).json({ ok: true, webhook: url });
	} catch (error) {
		console.error("Setup error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
