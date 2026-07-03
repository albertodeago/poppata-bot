import {
	type BabyEvent,
	type EventEnv,
	type EventSource,
	LABEL,
	type NewBabyEvent,
	SIDE_LABEL,
} from "./event.js";
import type { LoggerEnv } from "./logger.js";
import { type Intent, normalize, type ParserEnv, parseRules } from "./parse.js";
import type { PendingConfirmation, PendingEnv } from "./pending.js";
import type { Result } from "./result.js";
import * as R from "./result.js";
import { decide } from "./session.js";
import { formatDuration, hhmm, resolveClock, romeNow } from "./time.js";

export interface BotEnv {
	bot: {
		sendMessage(chatId: number, text: string): Promise<void>;
		react(chatId: number, messageId: number, emoji: string): Promise<void>;
		sendConfirmation(
			chatId: number,
			text: string,
			pendingId: string,
		): Promise<void>;
		sendSidePrompt(
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
const SIDE_PROMPT = "Per quale seno? 🤱";

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

/** A feed start that still needs its breast side chosen. */
const needsSide = (intent: Intent): boolean =>
	intent.type === "eat" && intent.action === "start" && !intent.side;

const describeIntent = (intent: Intent): string => {
	const parts = [LABEL[intent.type]];
	if (intent.side) parts.push(SIDE_LABEL[intent.side]);
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
		rawText: ctx.rawText,
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

const promptSide = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
): Promise<void> => {
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: SIDE_PROMPT,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (side) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendSidePrompt(ctx.chatId, SIDE_PROMPT, created.data.id);
};

const sendDurationReply = async (
	env: BotEnv,
	chatId: number,
	closed: BabyEvent & { endedAt: Date },
): Promise<void> => {
	const dur = formatDuration(
		closed.endedAt.getTime() - closed.startedAt.getTime(),
	);
	await env.bot.sendMessage(
		chatId,
		`Ok, aggiunta ✅ — durata ${LABEL[closed.type]}: ${dur}`,
	);
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Poppata iniziata alle 09:15", plus "— seno destro" when a side is set. */
const startedText = (intent: Intent): string => {
	let text = `${cap(LABEL[intent.type])} iniziata alle ${hhmm(intent.at)}`;
	if (intent.side) text += ` — seno ${SIDE_LABEL[intent.side]}`;
	return text;
};

const save = async (
	env: BotEnv & EventEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	timeGiven: boolean,
): Promise<void> => {
	const applied = await applyIntent(intent, ctx)(env);
	if (!applied.success) {
		env.logger.error("applyIntent failed", applied.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	const closed = applied.data.closed;
	if (intent.action === "end" && closed?.endedAt) {
		await sendDurationReply(env, ctx.chatId, {
			...closed,
			endedAt: closed.endedAt,
		});
		return;
	}
	// A start whose time we defaulted to "now": confirm the assumed time in words
	// (eat→"poppata", sleep→"nanna" are both feminine, so "iniziata" agrees).
	if (intent.action === "start" && !timeGiven) {
		await env.bot.sendMessage(ctx.chatId, startedText(intent));
		return;
	}
	await env.bot.react(ctx.chatId, ctx.messageId, "👍");
};

const feedbackFor = async (
	env: BotEnv,
	p: PendingConfirmation,
	closed: BabyEvent | undefined,
): Promise<void> => {
	if (p.intent.action === "end" && closed?.endedAt) {
		await sendDurationReply(env, p.chatId, {
			...closed,
			endedAt: closed.endedAt,
		});
		return;
	}
	// react on the ORIGINAL user message
	await env.bot.react(p.chatId, p.messageId, "👍");
};

export const handleCallback =
	(cb: IncomingCallback) =>
	async (env: BotEnv & EventEnv & PendingEnv & LoggerEnv): Promise<void> => {
		const [verb, pendingId] = cb.data.split(":");
		if (!pendingId) {
			await env.bot.answerCallback(cb.id);
			return;
		}

		const found = await env.pendingRepository.get(pendingId);
		if (!found.success) {
			env.logger.error("get pending failed", found.error);
			await env.bot.answerCallback(cb.id);
			return;
		}
		const p = found.data;
		if (!p) {
			// stale / already handled
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, "Scaduto");
			return;
		}

		if (verb === "ann") {
			await env.pendingRepository.delete(p.id);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, "Annullato");
			return;
		}

		const ctx: EventContext = {
			chatId: p.chatId,
			userId: p.userId,
			userName: p.userName,
			messageId: p.messageId,
			rawText: p.rawText,
		};

		// Side buttons: fill the missing breast, then save the feed start.
		if (verb === "dx" || verb === "sx") {
			const intent: Intent = { ...p.intent, side: verb };
			const applied = await applyIntent(intent, ctx)(env);
			if (!applied.success) {
				env.logger.error("applyIntent (side) failed", applied.error);
				await env.bot.answerCallback(cb.id, "Errore");
				return;
			}
			await env.bot.sendMessage(ctx.chatId, `${startedText(intent)} ✅`);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// verb === "conf": a confirmed feed start still missing its side asks for it.
		if (needsSide(p.intent)) {
			await promptSide(env, ctx, p.intent);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		const applied = await applyIntent(p.intent, ctx)(env);
		if (!applied.success) {
			env.logger.error("applyIntent (confirm) failed", applied.error);
			await env.bot.answerCallback(cb.id, "Errore");
			return;
		}
		await feedbackFor(env, p, applied.data.closed);
		await env.bot.clearKeyboard(cb.chatId, cb.messageId);
		await env.pendingRepository.delete(p.id);
		await env.bot.answerCallback(cb.id);
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

		const timeGiven = hasTime && hour !== undefined;
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
				if (needsSide(decision.intent)) {
					await promptSide(env, ctx, decision.intent);
					return;
				}
				await save(env, ctx, decision.intent, timeGiven);
				return;
		}
	};
