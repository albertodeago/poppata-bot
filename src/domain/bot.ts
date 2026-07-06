import { ANNULLA_QUERY, annullaCommand } from "./commands.js";
import {
	type BabyEvent,
	type EventEnv,
	type EventSource,
	LABEL,
	type NewBabyEvent,
	SIDE_LABEL,
} from "./event.js";
import { answerLastFeed, LAST_FEED_QUERY, lastFeedHint } from "./lastFeed.js";
import type { LoggerEnv } from "./logger.js";
import {
	hasBabySignal,
	type Intent,
	normalize,
	type ParserEnv,
	parseRules,
} from "./parse.js";
import type { PendingConfirmation, PendingEnv } from "./pending.js";
import type { Result } from "./result.js";
import * as R from "./result.js";
import { decide } from "./session.js";
import { formatDuration, hhmm, resolveClock, romeNow } from "./time.js";

export interface BotEnv {
	bot: {
		sendMessage(
			chatId: number,
			text: string,
			opts?: { parseMode?: "HTML" },
		): Promise<void>;
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
		sendTypePrompt(
			chatId: number,
			text: string,
			pendingId: string,
		): Promise<void>;
		sendFeedTypePrompt(
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
	at: Date;
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
	'Non ho capito 🤔 Prova ad esempio: "poppata dx 9.15", "fine 9.40", "nanna 10", "pipì", "cacca". Usa /help per la lista completa.';
const INTERNAL_ERROR = "Errore interno, riprova.";
const SIDE_PROMPT = "Per quale seno? 🤱";
/** A confirmation button is only honored within this window of its creation. */
const PENDING_TTL_MS = 15 * 60_000;
const PENDING_EXPIRED = "Scaduto ⏰ — più di 15 minuti, riscrivi il messaggio.";
const TYPE_PROMPT = "Poppata o nanna? 🍼";
const FEED_TYPE_PROMPT = "Poppata o biberon? 🍼🥛";
const AMOUNT_PROMPT = "Quanti ml? 🥛";
const BOTTLE_ABANDONED = "Ho annullato il biberon di prima: mancavano i ml. 🥛";

/** A bottle-answer message: a bare 1–3 digit number, optionally with "ml". */
const parseMl = (text: string): number | undefined => {
	const m = text.trim().match(/^(\d{1,3})\s*(?:ml)?$/i);
	return m?.[1] ? Number(m[1]) : undefined;
};

/** A bottle whose ml is still unknown (bare "bibe" / an ambiguous Gemini parse). */
const needsAmount = (intent: Intent): boolean =>
	intent.type === "bottle" && intent.amountMl === undefined;

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
	...(intent.amountMl !== undefined ? { amountMl: intent.amountMl } : {}),
});

/** A feed start that still needs its breast side chosen. */
const needsSide = (intent: Intent): boolean =>
	intent.type === "eat" && intent.action === "start" && !intent.side;

const describeIntent = (intent: Intent): string => {
	const parts = [LABEL[intent.type]];
	if (intent.type === "bottle" && intent.amountMl !== undefined)
		parts.push(`${intent.amountMl} ml`);
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
	env: BotEnv & EventEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	now: Date,
): Promise<void> => {
	const lastRes = await env.eventRepository.findLastFeed(ctx.chatId);
	if (!lastRes.success) {
		env.logger.error("promptSide: findLastFeed failed", lastRes.error);
	}
	const hint = lastRes.success ? lastFeedHint(lastRes.data, now) : "";
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
	await env.bot.sendSidePrompt(
		ctx.chatId,
		`${SIDE_PROMPT}${hint}`,
		created.data.id,
	);
};

const promptType = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	at: Date,
): Promise<void> => {
	// The stored `type` is a placeholder; the button verb (eat/sleep) in
	// handleCallback sets the real one. confidence:1 — the user picks explicitly.
	const intent: Intent = {
		type: "sleep",
		action: "start",
		at,
		source: "rules",
		confidence: 1,
	};
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: TYPE_PROMPT,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (type) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendTypePrompt(ctx.chatId, TYPE_PROMPT, created.data.id);
};

/** Ask poppata-vs-biberon for a generic feed; the button verb picks the type. */
const promptFeedType = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	at: Date,
): Promise<void> => {
	// Placeholder intent; the button verb sets the real type in handleCallback
	// (eat → poppata start, bottle → instant then asks the ml).
	const intent: Intent = {
		type: "eat",
		action: "start",
		at,
		source: "rules",
		confidence: 1,
	};
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: FEED_TYPE_PROMPT,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (feed type) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendFeedTypePrompt(
		ctx.chatId,
		FEED_TYPE_PROMPT,
		created.data.id,
	);
};

/** Stash a bottle awaiting its ml and ask for it; the user's next message answers. */
const promptAmount = async (
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
		warning: AMOUNT_PROMPT,
		kind: "amount",
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (amount) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendMessage(ctx.chatId, AMOUNT_PROMPT);
};

/** Apply an answered ml to its bottle: save + echo, or confirm if unusually large. */
const resolveAmount = async (
	env: BotEnv & EventEnv & PendingEnv & LoggerEnv,
	p: PendingConfirmation,
	ml: number,
): Promise<void> => {
	const ctx: EventContext = {
		chatId: p.chatId,
		userId: p.userId,
		userName: p.userName,
		messageId: p.messageId,
		rawText: p.rawText,
	};
	const intent: Intent = { ...p.intent, amountMl: ml };
	const decision = decide(intent, null);
	if (decision.kind === "confirm") {
		await createPending(env, ctx, decision.intent, decision.warning);
		return;
	}
	if (decision.kind === "error") {
		// Unreachable for an instant bottle, but keep the type total.
		env.logger.error(
			"resolveAmount: unexpected decide error",
			decision.message,
		);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	const applied = await applyIntent(decision.intent, ctx)(env);
	if (!applied.success) {
		env.logger.error("applyIntent (amount) failed", applied.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendMessage(ctx.chatId, bottleEcho(decision.intent));
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

/** "🥛 Biberon 100 ml alle 14:30 ✅" — feedback for a saved bottle. */
const bottleEcho = (intent: Intent): string =>
	`🥛 ${cap(LABEL.bottle)} ${intent.amountMl ?? 0} ml alle ${hhmm(intent.at)} ✅`;

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
	// A bottle echoes its ml + time so the recorded amount is visible.
	if (intent.type === "bottle") {
		await env.bot.sendMessage(ctx.chatId, bottleEcho(intent));
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
	if (p.intent.action === "start") {
		await env.bot.sendMessage(p.chatId, `${startedText(p.intent)} ✅`);
		return;
	}
	if (p.intent.type === "bottle") {
		await env.bot.sendMessage(p.chatId, bottleEcho(p.intent));
		return;
	}
	// react on the ORIGINAL user message (instant events)
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

		// Honor a tap only within PENDING_TTL_MS: past that the intent's time is
		// too stale to trust, so discard it and ask the user to resend.
		if (cb.at.getTime() - p.createdAt.getTime() > PENDING_TTL_MS) {
			await env.pendingRepository.delete(p.id);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, PENDING_EXPIRED);
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

		// Biberon button (from the poppata-or-biberon prompt): make it an instant
		// bottle and ask for the ml.
		if (verb === "bottle") {
			const intent: Intent = { ...p.intent, type: "bottle", action: "instant" };
			await promptAmount(env, ctx, intent);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// Type buttons: the verb is authoritative (the stored placeholder type is
		// ignored). Gate through decide so a start over an open session asks before
		// closing it (consistent with the text path); otherwise eat → side prompt,
		// sleep → save directly.
		if (verb === "eat" || verb === "sleep") {
			const intent: Intent = { ...p.intent, type: verb };
			const openRes = await env.eventRepository.findOpenSession(ctx.chatId);
			if (!openRes.success) {
				env.logger.error("findOpenSession (type) failed", openRes.error);
				await env.bot.answerCallback(cb.id, "Errore");
				return;
			}
			const decision = decide(intent, openRes.data);
			if (decision.kind === "confirm") {
				await createPending(env, ctx, decision.intent, decision.warning);
				await env.bot.clearKeyboard(cb.chatId, cb.messageId);
				await env.pendingRepository.delete(p.id);
				await env.bot.answerCallback(cb.id);
				return;
			}
			// decision.kind === "save" (decide returns "error" only for end intents).
			if (needsSide(intent)) {
				await promptSide(env, ctx, intent, cb.at);
				await env.bot.clearKeyboard(cb.chatId, cb.messageId);
				await env.pendingRepository.delete(p.id);
				await env.bot.answerCallback(cb.id);
				return;
			}
			const applied = await applyIntent(intent, ctx)(env);
			if (!applied.success) {
				env.logger.error("applyIntent (type) failed", applied.error);
				await env.bot.answerCallback(cb.id, "Errore");
				return;
			}
			await env.bot.sendMessage(ctx.chatId, `${startedText(intent)} ✅`);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// verb === "conf": a confirmed bottle still missing its ml asks for it.
		if (needsAmount(p.intent)) {
			await promptAmount(env, ctx, p.intent);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// verb === "conf": a confirmed feed start still missing its side asks for it.
		if (needsSide(p.intent)) {
			await promptSide(env, ctx, p.intent, cb.at);
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
		const normalized = normalize(msg.text);

		// An open "quanti ml?" question consumes the next message: a bare number
		// answers it; anything else abandons it (with a heads-up) and is then
		// processed as usual.
		const amountPending = await env.pendingRepository.findAmountPending(
			msg.chatId,
		);
		if (!amountPending.success) {
			env.logger.error("findAmountPending failed", amountPending.error);
		} else if (amountPending.data) {
			const p = amountPending.data;
			await env.pendingRepository.delete(p.id);
			const ml = parseMl(msg.text);
			if (ml !== undefined) {
				await resolveAmount(env, p, ml);
				return;
			}
			await env.bot.sendMessage(msg.chatId, BOTTLE_ABANDONED);
			// fall through: handle this message as usual
		}

		if (LAST_FEED_QUERY.test(normalized)) {
			await answerLastFeed(msg.chatId, msg.at)(env);
			return;
		}
		if (ANNULLA_QUERY.test(normalized)) {
			await annullaCommand(msg.chatId)(env);
			return;
		}
		const tokens = parseRules(normalized);

		let {
			type,
			action,
			side,
			hour,
			minute,
			hasTime,
			confidence,
			amountMl,
			ambiguousFeed,
		} = tokens;
		let source: EventSource = "rules";

		// A generic feed word (mangia/pappa/latte) with no breast/bottle signal:
		// ask poppata vs biberon instead of letting Gemini guess. Deterministic.
		if (ambiguousFeed) {
			const at =
				hasTime && hour !== undefined
					? resolveClock(arrival, hour, minute).toJSDate()
					: arrival.toJSDate();
			const feedCtx: EventContext = {
				chatId: msg.chatId,
				userId: msg.userId,
				userName: msg.userName,
				messageId: msg.messageId,
				rawText: msg.text,
			};
			await promptFeedType(env, feedCtx, at);
			return;
		}

		// A start with no type ("inizio", "comincia 9.15"): ask poppata vs nanna
		// with buttons instead of guessing. Deterministic — skips the Gemini fallback.
		if (action === "start" && !type) {
			const at =
				hasTime && hour !== undefined
					? resolveClock(arrival, hour, minute).toJSDate()
					: arrival.toJSDate();
			const typeCtx: EventContext = {
				chatId: msg.chatId,
				userId: msg.userId,
				userName: msg.userName,
				messageId: msg.messageId,
				rawText: msg.text,
			};
			await promptType(env, typeCtx, at);
			return;
		}

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
				amountMl = d.amountMl;
				confidence = d.confidence;
			}
		}

		if (!action) {
			// Nudge only genuine-but-unparseable attempts; ignore chatter silently.
			if (hasBabySignal(normalized)) {
				await env.bot.sendMessage(msg.chatId, HELP_HINT);
			}
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
			if (hasBabySignal(normalized)) {
				await env.bot.sendMessage(msg.chatId, HELP_HINT);
			}
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
			...(amountMl !== undefined ? { amountMl } : {}),
		};

		const ctx: EventContext = {
			chatId: msg.chatId,
			userId: msg.userId,
			userName: msg.userName,
			messageId: msg.messageId,
			rawText: msg.text,
		};

		if (confidence < CONFIDENCE_MIN) {
			const closeNote =
				intent.action === "start" && open
					? ` C'è già una ${LABEL[open.type]} aperta dalle ${hhmm(
							open.startedAt,
						)}, la chiudo alle ${hhmm(intent.at)}.`
					: "";
			await createPending(
				env,
				ctx,
				intent,
				`Ho capito: ${describeIntent(intent)}.${closeNote} Confermi?`,
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
				if (needsAmount(decision.intent)) {
					await promptAmount(env, ctx, decision.intent);
					return;
				}
				if (needsSide(decision.intent)) {
					await promptSide(env, ctx, decision.intent, msg.at);
					return;
				}
				await save(env, ctx, decision.intent, timeGiven);
				return;
		}
	};
