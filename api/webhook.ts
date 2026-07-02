import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
	handleCallback,
	handleMessage,
	type IncomingCallback,
	type IncomingMessage,
} from "../src/domain/bot";
import {
	annullaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	settimanaCommand,
	startCommand,
	statoCommand,
} from "../src/domain/commands";
import { type Env, makeEnv } from "../src/env";

let env: Env;
let initialized = false;

const senderName = (from?: {
	first_name?: string;
	username?: string;
}): string => from?.first_name ?? from?.username ?? "sconosciuto";

const initBot = (): void => {
	if (initialized) return;
	env = makeEnv();
	const bot = env.telegrafBot;

	bot.command("start", async (ctx) => {
		await startCommand(ctx.chat.id)(env);
	});
	bot.command("help", async (ctx) => {
		await helpCommand(ctx.chat.id)(env);
	});
	bot.command("stato", async (ctx) => {
		await statoCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("oggi", async (ctx) => {
		await oggiCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("ieri", async (ctx) => {
		await ieriCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("settimana", async (ctx) => {
		await settimanaCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("annulla", async (ctx) => {
		await annullaCommand(ctx.chat.id)(env);
	});

	bot.on("text", async (ctx) => {
		if (ctx.message.text.startsWith("/")) return; // commands handled above
		const msg: IncomingMessage = {
			chatId: ctx.chat.id,
			userId: ctx.from.id,
			userName: senderName(ctx.from),
			text: ctx.message.text,
			messageId: ctx.message.message_id,
			at: new Date(ctx.message.date * 1000),
		};
		await handleMessage(msg)(env);
	});

	bot.on("callback_query", async (ctx) => {
		if (!("data" in ctx.callbackQuery)) return;
		const cb: IncomingCallback = {
			id: ctx.callbackQuery.id,
			chatId: ctx.chat?.id ?? ctx.from.id,
			userId: ctx.from.id,
			userName: senderName(ctx.from),
			data: ctx.callbackQuery.data,
			messageId: ctx.callbackQuery.message?.message_id ?? 0,
		};
		await handleCallback(cb)(env);
	});

	initialized = true;
};

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}
	try {
		initBot();
		await env.handleWebhook(req.body);
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Webhook error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
