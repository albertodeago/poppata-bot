import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeEnv } from "../src/env";

const COMMANDS = [
	{ command: "stato", description: "Sessione in corso" },
	{ command: "oggi", description: "Statistiche di oggi" },
	{ command: "ieri", description: "Statistiche di ieri" },
	{ command: "settimana", description: "Statistiche della settimana" },
	{ command: "annulla", description: "Rimuove l'ultimo evento" },
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
			allowed_updates: ["message", "callback_query"] as const,
		});
		await env.telegrafBot.telegram.setMyCommands(COMMANDS);
		return res.status(200).json({ ok: true, webhook: url });
	} catch (error) {
		console.error("Setup error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
