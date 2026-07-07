import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Chat } from "telegraf/types";
import {
	handleCallback,
	handleMessage,
	type IncomingCallback,
	type IncomingMessage,
} from "../src/domain/bot.js";
import {
	annullaCommand,
	graficiCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	pesoCommand,
	scalettaCommand,
	senoCommand,
	settimanaCommand,
	statoCommand,
} from "../src/domain/commands.js";
import { nomeCommand, registerChat } from "../src/domain/registration.js";
import { type Env, makeEnv } from "../src/env.js";

let env: Env;
let initialized = false;

const senderName = (from?: {
	first_name?: string;
	username?: string;
}): string => from?.first_name ?? from?.username ?? "sconosciuto";

/** Register (or greet) a chat from a webhook ctx — shared by /start and the add-event. */
const registerFrom = (
	chat: Chat,
	from: { first_name?: string; username?: string } | undefined,
	name?: string,
): Promise<void> => {
	const chatTitle = "title" in chat ? chat.title : undefined;
	return registerChat({
		chatId: chat.id,
		userName: senderName(from),
		...(chatTitle ? { chatTitle } : {}),
		...(name ? { name } : {}),
		maxChats: env.config.maxChats,
		repoIssuesUrl: env.config.repoIssuesUrl,
	})(env);
};

const initBot = (): void => {
	if (initialized) return;
	env = makeEnv();
	const bot = env.telegrafBot;

	bot.command("start", async (ctx) => {
		const name = ctx.message.text.replace(/^\/start(@\S+)?\s*/, "").trim();
		await registerFrom(ctx.chat, ctx.from, name || undefined);
	});
	bot.command("nome", async (ctx) => {
		const arg = ctx.message.text.replace(/^\/nome(@\S+)?\s*/, "");
		await nomeCommand(ctx.chat.id, arg)(env);
	});
	bot.command("help", async (ctx) => {
		await helpCommand(ctx.chat.id)(env);
	});
	bot.command("stato", async (ctx) => {
		await statoCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("grafici", async (ctx) => {
		await graficiCommand(ctx.chat.id, env.config.miniAppUrl)(env);
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
	bot.command("scaletta", async (ctx) => {
		await scalettaCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("annulla", async (ctx) => {
		await annullaCommand(ctx.chat.id)(env);
	});
	bot.command("seno", async (ctx) => {
		await senoCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("peso", async (ctx) => {
		const arg = ctx.message.text.replace(/^\/peso(@\S+)?\s*/, "");
		await pesoCommand(
			ctx.chat.id,
			ctx.from.id,
			senderName(ctx.from),
			arg,
			new Date(),
		)(env);
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
			at: new Date(),
		};
		await handleCallback(cb)(env);
	});

	// Auto-register + welcome when the bot is added to a chat.
	bot.on("my_chat_member", async (ctx) => {
		const { old_chat_member, new_chat_member } = ctx.myChatMember;
		const wasOut =
			old_chat_member.status === "left" || old_chat_member.status === "kicked";
		const isIn =
			new_chat_member.status === "member" ||
			new_chat_member.status === "administrator";
		if (wasOut && isIn) {
			await registerFrom(ctx.chat, ctx.from);
		}
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
	const secret = process.env.WEBHOOK_SECRET;
	if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) {
		return res.status(401).json({ error: "Unauthorized" });
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
