import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Chat } from "telegraf/types";
import { approveChat, banChat } from "../src/domain/access.js";
import {
	handleCallback,
	handleMessage,
	type IncomingCallback,
	type IncomingMessage,
} from "../src/domain/bot.js";
import {
	annullaCommand,
	graficiCommand,
	guidaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	pesoCommand,
	proposalCommand,
	scalettaCommand,
	senoCommand,
	settimanaCommand,
	statoCommand,
} from "../src/domain/commands.js";
import {
	languageCommand,
	nomeCommand,
	registerChat,
	reportCommand,
} from "../src/domain/registration.js";
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
	from:
		| { first_name?: string; username?: string; language_code?: string }
		| undefined,
	name?: string,
): Promise<void> => {
	const chatTitle = "title" in chat ? chat.title : undefined;
	return registerChat({
		chatId: chat.id,
		userName: senderName(from),
		...(chatTitle ? { chatTitle } : {}),
		...(name ? { name } : {}),
		...(from?.username ? { username: from.username } : {}),
		...(from?.language_code ? { languageCode: from.language_code } : {}),
		adminChatId: env.config.adminChatId,
		guideUrl: env.config.guideUrl,
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

	// --- Admin access controls (only honoured from the ADMIN_CHAT_ID chat) ---
	const isAdmin = (chatId?: number): boolean =>
		chatId === env.config.adminChatId;

	bot.command("approva", async (ctx) => {
		if (!isAdmin(ctx.chat.id)) return;
		const arg = ctx.message.text.replace(/^\/approva(@\S+)?\s*/, "").trim();
		const targetId = Number.parseInt(arg, 10);
		if (Number.isNaN(targetId)) {
			await ctx.reply("Usa /approva <chatId>");
			return;
		}
		const res = await approveChat(targetId)(env);
		await ctx.reply(
			res.success ? `✅ Approvata: ${targetId}` : "Errore, riprova.",
		);
	});
	bot.command("banna", async (ctx) => {
		if (!isAdmin(ctx.chat.id)) return;
		const arg = ctx.message.text.replace(/^\/banna(@\S+)?\s*/, "").trim();
		const targetId = Number.parseInt(arg, 10);
		if (Number.isNaN(targetId)) {
			await ctx.reply("Usa /banna <chatId>");
			return;
		}
		const res = await banChat(targetId)(env);
		await ctx.reply(
			res.success ? `🚫 Bannata: ${targetId}` : "Errore, riprova.",
		);
	});
	// Editing the request message is best-effort: a double-tap or an old message
	// makes Telegram reject the edit, which must not fail the whole update (that
	// would 500 → Telegram retry → re-run the approve/ban side effects).
	const markHandled = async (
		ctx: { editMessageText(text: string): Promise<unknown> },
		text: string,
	): Promise<void> => {
		try {
			await ctx.editMessageText(text);
		} catch {
			// message not modified / too old / uneditable — nothing to do.
		}
	};

	bot.action(/^approve:(-?\d+)$/, async (ctx) => {
		if (!isAdmin(ctx.chat?.id)) {
			await ctx.answerCbQuery();
			return;
		}
		const targetId = Number(ctx.match[1]);
		const res = await approveChat(targetId)(env);
		await ctx.answerCbQuery(res.success ? "Approvata" : "Errore");
		if (res.success) await markHandled(ctx, `✅ Approvata: ${targetId}`);
	});
	bot.action(/^ban:(-?\d+)$/, async (ctx) => {
		if (!isAdmin(ctx.chat?.id)) {
			await ctx.answerCbQuery();
			return;
		}
		const targetId = Number(ctx.match[1]);
		const res = await banChat(targetId)(env);
		await ctx.answerCbQuery(res.success ? "Bannata" : "Errore");
		if (res.success) await markHandled(ctx, `🚫 Bannata: ${targetId}`);
	});

	bot.command(["nome", "name"], async (ctx) => {
		const arg = ctx.message.text.replace(/^\/(?:nome|name)(@\S+)?\s*/, "");
		await nomeCommand(ctx.chat.id, arg)(env);
	});
	bot.command(["lingua", "language"], async (ctx) => {
		const arg = ctx.message.text.replace(
			/^\/(?:lingua|language)(@\S+)?\s*/,
			"",
		);
		await languageCommand(ctx.chat.id, arg)(env);
	});
	bot.command("report", async (ctx) => {
		const arg = ctx.message.text.replace(/^\/report(@\S+)?\s*/, "");
		await reportCommand(ctx.chat.id, arg)(env);
	});
	bot.command(["proponi", "suggest"], async (ctx) => {
		const arg = ctx.message.text.replace(
			/^\/(?:proponi|suggest)(@\S+)?\s*/,
			"",
		);
		const chatTitle = "title" in ctx.chat ? ctx.chat.title : undefined;
		await proposalCommand({
			chatId: ctx.chat.id,
			...(chatTitle ? { chatTitle } : {}),
			userId: ctx.from.id,
			userName: senderName(ctx.from),
			...(ctx.from.username ? { username: ctx.from.username } : {}),
			text: arg,
			adminChatId: env.config.adminChatId,
			now: new Date(),
		})(env);
	});
	bot.command("help", async (ctx) => {
		await helpCommand(ctx.chat.id)(env);
	});
	bot.command(["stato", "status"], async (ctx) => {
		await statoCommand(ctx.chat.id, new Date())(env);
	});
	bot.command(["grafici", "charts"], async (ctx) => {
		await graficiCommand(ctx.chat.id, env.config.miniAppUrl)(env);
	});
	bot.command(["guida", "guide"], async (ctx) => {
		await guidaCommand(ctx.chat.id, env.config.guideUrl)(env);
	});
	bot.command(["oggi", "today"], async (ctx) => {
		await oggiCommand(ctx.chat.id, new Date())(env);
	});
	bot.command(["ieri", "yesterday"], async (ctx) => {
		await ieriCommand(ctx.chat.id, new Date())(env);
	});
	bot.command(["settimana", "week"], async (ctx) => {
		await settimanaCommand(ctx.chat.id, new Date())(env);
	});
	bot.command(["scaletta", "schedule"], async (ctx) => {
		await scalettaCommand(ctx.chat.id, new Date())(env);
	});
	bot.command(["annulla", "undo"], async (ctx) => {
		await annullaCommand(ctx.chat.id)(env);
	});
	bot.command(["seno", "breast"], async (ctx) => {
		await senoCommand(ctx.chat.id, new Date())(env);
	});
	bot.command(["peso", "weight"], async (ctx) => {
		const arg = ctx.message.text.replace(/^\/(?:peso|weight)(@\S+)?\s*/, "");
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
