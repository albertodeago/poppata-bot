import {
	type BabyEvent,
	type EventEnv,
	type EventSource,
	LABEL,
	type NewBabyEvent,
} from "./event";
import type { LoggerEnv } from "./logger";
import { type Intent, normalize, type ParserEnv, parseRules } from "./parse";
import type { PendingEnv } from "./pending";
import type { Result } from "./result";
import * as R from "./result";
import { decide } from "./session";
import { formatDuration, hhmm, resolveClock, romeNow } from "./time";

export interface BotEnv {
	bot: {
		sendMessage(chatId: number, text: string): Promise<void>;
		react(chatId: number, messageId: number, emoji: string): Promise<void>;
		sendConfirmation(
			chatId: number,
			text: string,
			pendingId: string,
		): Promise<void>;
		answerCallback(callbackId: string, text?: string): Promise<void>;
		clearKeyboard(chatId: number, messageId: number): Promise<void>;
	};
}

export interface IncomingMessage {
	chatId: number;
	userId: number;
	userName: string;
	text: string;
	messageId: number;
	at: Date;
}

export interface IncomingCallback {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	data: string;
	messageId: number;
}

export interface EventContext {
	chatId: number;
	userId: number;
	userName: string;
	messageId: number;
	rawText: string;
}

const CONFIDENCE_MIN = 0.7;
const HELP_HINT =
	'Non ho capito 🤔 Prova ad esempio: "inizio poppata dx 9.15", "fine 9.40", "pipì", "cacca", "nanna 10". Usa /help per la lista completa.';
const INTERNAL_ERROR = "Errore interno, riprova.";

const newEventFrom = (intent: Intent, ctx: EventContext): NewBabyEvent => ({
	chatId: ctx.chatId,
	userId: ctx.userId,
	userName: ctx.userName,
	type: intent.type,
	startedAt: intent.at,
	source: intent.source,
	rawText: ctx.rawText,
	messageId: ctx.messageId,
	...(intent.side ? { side: intent.side } : {}),
});

const describeIntent = (intent: Intent): string => {
	const parts = [LABEL[intent.type]];
	if (intent.side) parts.push(intent.side);
	if (intent.action === "instant") parts.push(`alle ${hhmm(intent.at)}`);
	else
		parts.push(
			`${intent.action === "end" ? "fine" : "inizio"} ${hhmm(intent.at)}`,
		);
	return parts.join(" ");
};

/** Single writer: applies a confirmed/valid intent to the event store. */
export const applyIntent =
	(intent: Intent, ctx: EventContext) =>
	async (
		env: EventEnv & LoggerEnv,
	): Promise<Result<{ closed?: BabyEvent; inserted?: BabyEvent }>> => {
		const openRes = await env.eventRepository.findOpenSession(ctx.chatId);
		if (!openRes.success) return openRes;
		const open = openRes.data;

		if (intent.action === "end") {
			if (!open)
				return R.error(new Error("Nessuna sessione aperta da chiudere."));
			const closed = await env.eventRepository.closeSession(open.id, intent.at);
			if (!closed.success) return closed;
			return R.success({ closed: closed.data });
		}

		if (intent.action === "start") {
			let closed: BabyEvent | undefined;
			if (open) {
				const c = await env.eventRepository.closeSession(open.id, intent.at);
				if (!c.success) return c;
				closed = c.data;
			}
			const inserted = await env.eventRepository.insert(
				newEventFrom(intent, ctx),
			);
			if (!inserted.success) return inserted;
			return R.success(
				closed
					? { closed, inserted: inserted.data }
					: { inserted: inserted.data },
			);
		}

		// instant
		const inserted = await env.eventRepository.insert(
			newEventFrom(intent, ctx),
		);
		if (!inserted.success) return inserted;
		return R.success({ inserted: inserted.data });
	};

const createPending = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	warning: string,
): Promise<void> => {
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		intent,
		warning,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendConfirmation(ctx.chatId, warning, created.data.id);
};

const save = async (
	env: BotEnv & EventEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
): Promise<void> => {
	const applied = await applyIntent(intent, ctx)(env);
	if (!applied.success) {
		env.logger.error("applyIntent failed", applied.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	const closed = applied.data.closed;
	if (intent.action === "end" && closed?.endedAt) {
		const dur = formatDuration(
			closed.endedAt.getTime() - closed.startedAt.getTime(),
		);
		await env.bot.sendMessage(
			ctx.chatId,
			`Ok, aggiunta ✅ — durata ${LABEL[closed.type]}: ${dur}`,
		);
		return;
	}
	await env.bot.react(ctx.chatId, ctx.messageId, "👍");
};

export const handleMessage =
	(msg: IncomingMessage) =>
	async (
		env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv,
	): Promise<void> => {
		const arrival = romeNow(msg.at);
		const tokens = parseRules(normalize(msg.text));

		let { type, action, side, hour, minute, hasTime, confidence } = tokens;
		let source: EventSource = "rules";

		if (confidence === 0) {
			const g = await env.parser.parse(msg.text);
			if (g.success && g.data) {
				const d = g.data;
				source = "gemini";
				type = d.type;
				action = d.action;
				side = d.side;
				hasTime = d.hour !== undefined;
				hour = d.hour;
				minute = d.minute ?? 0;
				confidence = d.confidence;
			}
		}

		if (!action) {
			await env.bot.sendMessage(msg.chatId, HELP_HINT);
			return;
		}

		const openRes = await env.eventRepository.findOpenSession(msg.chatId);
		if (!openRes.success) {
			env.logger.error("findOpenSession failed", openRes.error);
			await env.bot.sendMessage(msg.chatId, INTERNAL_ERROR);
			return;
		}
		const open = openRes.data;

		if (action === "end" && !type) {
			if (!open) {
				await env.bot.sendMessage(
					msg.chatId,
					"Nessuna sessione aperta da chiudere.",
				);
				return;
			}
			type = open.type;
		}

		if (!type) {
			await env.bot.sendMessage(msg.chatId, HELP_HINT);
			return;
		}

		const at =
			hasTime && hour !== undefined
				? resolveClock(arrival, hour, minute).toJSDate()
				: arrival.toJSDate();

		const intent: Intent = {
			type,
			action,
			at,
			source,
			confidence,
			...(side ? { side } : {}),
		};

		const ctx: EventContext = {
			chatId: msg.chatId,
			userId: msg.userId,
			userName: msg.userName,
			messageId: msg.messageId,
			rawText: msg.text,
		};

		if (confidence < CONFIDENCE_MIN) {
			await createPending(
				env,
				ctx,
				intent,
				`Ho capito: ${describeIntent(intent)}. Confermi?`,
			);
			return;
		}

		const decision = decide(intent, open);
		switch (decision.kind) {
			case "error":
				await env.bot.sendMessage(msg.chatId, decision.message);
				return;
			case "confirm":
				await createPending(env, ctx, decision.intent, decision.warning);
				return;
			case "save":
				await save(env, ctx, decision.intent);
				return;
		}
	};
