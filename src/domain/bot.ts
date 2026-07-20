import type { ChatConfigEnv, ChatLanguage } from "./chatConfig.js";
import { ANNULLA_QUERY, annullaCommand } from "./commands.js";
import type {
	BabyEvent,
	EventEnv,
	EventSource,
	NewBabyEvent,
} from "./event.js";
import { chatLanguage, eventLabel, internalError, sideLabel } from "./i18n.js";
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
			labels?: { confirm: string; cancel: string },
		): Promise<void>;
		sendSidePrompt(
			chatId: number,
			text: string,
			pendingId: string,
			labels?: { left: string; right: string },
		): Promise<void>;
		sendTypePrompt(
			chatId: number,
			text: string,
			pendingId: string,
			labels?: { feed: string; sleep: string },
		): Promise<void>;
		sendFeedTypePrompt(
			chatId: number,
			text: string,
			pendingId: string,
			labels?: { feed: string; bottle: string },
		): Promise<void>;
		answerCallback(callbackId: string, text?: string): Promise<void>;
		clearKeyboard(chatId: number, messageId: number): Promise<void>;
		/** Notify the admin of an access request, with approve/ban buttons. */
		sendAccessRequest(
			adminChatId: number,
			text: string,
			targetChatId: number,
		): Promise<void>;
		sendLinkButton(
			chatId: number,
			text: string,
			buttonText: string,
			url: string,
		): Promise<void>;
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
/** A confirmation button is only honored within this window of its creation. */
const PENDING_TTL_MS = 15 * 60_000;

const botText = (language: ChatLanguage) => ({
	helpHint:
		language === "it"
			? 'Non ho capito 🤔 Prova ad esempio: "poppata dx 9.15", "fine 9.40", "nanna 10", "pipì", "cacca". Usa /help per la lista completa.'
			: 'I did not understand 🤔 Try for example: "feed right 9.15", "end 9.40", "sleep 10", "pee", "poop". Use /help for the full list.',
	sidePrompt: language === "it" ? "Per quale seno? 🤱" : "Which breast? 🤱",
	pendingExpired:
		language === "it"
			? "Scaduto ⏰ — più di 15 minuti, riscrivi il messaggio."
			: "Expired ⏰ — more than 15 minutes, write the message again.",
	expiredShort: language === "it" ? "Scaduto" : "Expired",
	canceled: language === "it" ? "Annullato" : "Canceled",
	errorShort: language === "it" ? "Errore" : "Error",
	typePrompt: language === "it" ? "Poppata o nanna? 🍼" : "Feed or sleep? 🍼",
	feedTypePrompt:
		language === "it"
			? "Poppata o biberon? 🍼🥛"
			: "Breastfeed or bottle? 🍼🥛",
	amountPrompt: language === "it" ? "Quanti ml? 🥛" : "How many ml? 🥛",
	bottleAbandoned:
		language === "it"
			? "Ho annullato il biberon di prima: mancavano i ml. 🥛"
			: "I canceled the previous bottle: the ml were missing. 🥛",
	noOpenToClose:
		language === "it"
			? "Nessuna sessione aperta da chiudere."
			: "No open session to close.",
	confirmQuestion: language === "it" ? "Confermi?" : "Confirm?",
	buttons: {
		confirmation:
			language === "it"
				? { confirm: "Conferma", cancel: "Annulla" }
				: { confirm: "Confirm", cancel: "Cancel" },
		side:
			language === "it"
				? { left: "Sinistro", right: "Destro" }
				: { left: "Left", right: "Right" },
		type:
			language === "it"
				? { feed: "Poppata", sleep: "Nanna" }
				: { feed: "Feed", sleep: "Sleep" },
		feedType:
			language === "it"
				? { feed: "🍼 Poppata", bottle: "🥛 Biberon" }
				: { feed: "🍼 Breastfeed", bottle: "🥛 Bottle" },
	},
});

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

const describeIntent = (intent: Intent, language: ChatLanguage): string => {
	const parts = [eventLabel(intent.type, language)];
	if (intent.type === "bottle" && intent.amountMl !== undefined)
		parts.push(`${intent.amountMl} ml`);
	if (intent.side) parts.push(sideLabel(intent.side, language));
	if (intent.action === "instant") {
		parts.push(`${language === "it" ? "alle" : "at"} ${hhmm(intent.at)}`);
	} else
		parts.push(
			`${intent.action === "end" ? (language === "it" ? "fine" : "end") : language === "it" ? "inizio" : "start"} ${hhmm(intent.at)}`,
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
	language: ChatLanguage,
): Promise<void> => {
	const t = botText(language);
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
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	if (language === "it") {
		await env.bot.sendConfirmation(ctx.chatId, warning, created.data.id);
		return;
	}
	await env.bot.sendConfirmation(
		ctx.chatId,
		warning,
		created.data.id,
		t.buttons.confirmation,
	);
};

const promptSide = async (
	env: BotEnv & EventEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	now: Date,
	language: ChatLanguage,
): Promise<void> => {
	const t = botText(language);
	const lastRes = await env.eventRepository.findLastFeed(ctx.chatId);
	if (!lastRes.success) {
		env.logger.error("promptSide: findLastFeed failed", lastRes.error);
	}
	const hint = lastRes.success ? lastFeedHint(lastRes.data, now, language) : "";
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: t.sidePrompt,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (side) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	if (language === "it") {
		await env.bot.sendSidePrompt(
			ctx.chatId,
			`${t.sidePrompt}${hint}`,
			created.data.id,
		);
		return;
	}
	await env.bot.sendSidePrompt(
		ctx.chatId,
		`${t.sidePrompt}${hint}`,
		created.data.id,
		t.buttons.side,
	);
};

const promptType = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	at: Date,
	language: ChatLanguage,
): Promise<void> => {
	const t = botText(language);
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
		warning: t.typePrompt,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (type) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	if (language === "it") {
		await env.bot.sendTypePrompt(ctx.chatId, t.typePrompt, created.data.id);
		return;
	}
	await env.bot.sendTypePrompt(
		ctx.chatId,
		t.typePrompt,
		created.data.id,
		t.buttons.type,
	);
};

/** Ask poppata-vs-biberon for a generic feed; the button verb picks the type. */
const promptFeedType = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	at: Date,
	language: ChatLanguage,
): Promise<void> => {
	const t = botText(language);
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
		warning: t.feedTypePrompt,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (feed type) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	if (language === "it") {
		await env.bot.sendFeedTypePrompt(
			ctx.chatId,
			t.feedTypePrompt,
			created.data.id,
		);
		return;
	}
	await env.bot.sendFeedTypePrompt(
		ctx.chatId,
		t.feedTypePrompt,
		created.data.id,
		t.buttons.feedType,
	);
};

/** Stash a bottle awaiting its ml and ask for it; the user's next message answers. */
const promptAmount = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	language: ChatLanguage,
): Promise<void> => {
	const t = botText(language);
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: t.amountPrompt,
		kind: "amount",
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (amount) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	await env.bot.sendMessage(ctx.chatId, t.amountPrompt);
};

/** Apply an answered ml to its bottle: save + echo, or confirm if unusually large. */
const resolveAmount = async (
	env: BotEnv & EventEnv & PendingEnv & LoggerEnv,
	p: PendingConfirmation,
	ml: number,
	language: ChatLanguage,
): Promise<void> => {
	const ctx: EventContext = {
		chatId: p.chatId,
		userId: p.userId,
		userName: p.userName,
		messageId: p.messageId,
		rawText: p.rawText,
	};
	const intent: Intent = { ...p.intent, amountMl: ml };
	const decision = decide(intent, null, language);
	if (decision.kind === "confirm") {
		await createPending(env, ctx, decision.intent, decision.warning, language);
		return;
	}
	if (decision.kind === "error") {
		// Unreachable for an instant bottle, but keep the type total.
		env.logger.error(
			"resolveAmount: unexpected decide error",
			decision.message,
		);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	const applied = await applyIntent(decision.intent, ctx)(env);
	if (!applied.success) {
		env.logger.error("applyIntent (amount) failed", applied.error);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	await env.bot.sendMessage(ctx.chatId, bottleEcho(decision.intent, language));
};

const sendDurationReply = async (
	env: BotEnv,
	chatId: number,
	closed: BabyEvent & { endedAt: Date },
	language: ChatLanguage,
): Promise<void> => {
	const dur = formatDuration(
		closed.endedAt.getTime() - closed.startedAt.getTime(),
	);
	await env.bot.sendMessage(
		chatId,
		language === "it"
			? `Ok, aggiunta ✅ — durata ${eventLabel(closed.type, language)}: ${dur}`
			: `Ok, added ✅ — ${eventLabel(closed.type, language)} duration: ${dur}`,
	);
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Poppata iniziata alle 09:15", plus "— seno destro" when a side is set. */
const startedText = (intent: Intent, language: ChatLanguage): string => {
	let text =
		language === "it"
			? `${cap(eventLabel(intent.type, language))} iniziata alle ${hhmm(intent.at)}`
			: `${cap(eventLabel(intent.type, language))} started at ${hhmm(intent.at)}`;
	if (intent.side) {
		text +=
			language === "it"
				? ` — seno ${sideLabel(intent.side, language)}`
				: ` — ${sideLabel(intent.side, language)} breast`;
	}
	return text;
};

/** "🥛 Biberon 100 ml alle 14:30 ✅" — feedback for a saved bottle. */
const bottleEcho = (intent: Intent, language: ChatLanguage): string =>
	language === "it"
		? `🥛 ${cap(eventLabel("bottle", language))} ${intent.amountMl ?? 0} ml alle ${hhmm(intent.at)} ✅`
		: `🥛 ${cap(eventLabel("bottle", language))} ${intent.amountMl ?? 0} ml at ${hhmm(intent.at)} ✅`;

const save = async (
	env: BotEnv & EventEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	timeGiven: boolean,
	language: ChatLanguage,
): Promise<void> => {
	const applied = await applyIntent(intent, ctx)(env);
	if (!applied.success) {
		env.logger.error("applyIntent failed", applied.error);
		await env.bot.sendMessage(ctx.chatId, internalError(language));
		return;
	}
	const closed = applied.data.closed;
	if (intent.action === "end" && closed?.endedAt) {
		await sendDurationReply(
			env,
			ctx.chatId,
			{
				...closed,
				endedAt: closed.endedAt,
			},
			language,
		);
		return;
	}
	// A start whose time we defaulted to "now": confirm the assumed time in words
	// (eat→"poppata", sleep→"nanna" are both feminine, so "iniziata" agrees).
	if (intent.action === "start" && !timeGiven) {
		await env.bot.sendMessage(ctx.chatId, startedText(intent, language));
		return;
	}
	// A bottle echoes its ml + time so the recorded amount is visible.
	if (intent.type === "bottle") {
		await env.bot.sendMessage(ctx.chatId, bottleEcho(intent, language));
		return;
	}
	await env.bot.react(ctx.chatId, ctx.messageId, "👍");
};

const feedbackFor = async (
	env: BotEnv,
	p: PendingConfirmation,
	closed: BabyEvent | undefined,
	language: ChatLanguage,
): Promise<void> => {
	if (p.intent.action === "end" && closed?.endedAt) {
		await sendDurationReply(
			env,
			p.chatId,
			{
				...closed,
				endedAt: closed.endedAt,
			},
			language,
		);
		return;
	}
	if (p.intent.action === "start") {
		await env.bot.sendMessage(
			p.chatId,
			`${startedText(p.intent, language)} ✅`,
		);
		return;
	}
	if (p.intent.type === "bottle") {
		await env.bot.sendMessage(p.chatId, bottleEcho(p.intent, language));
		return;
	}
	// react on the ORIGINAL user message (instant events)
	await env.bot.react(p.chatId, p.messageId, "👍");
};

export const handleCallback =
	(cb: IncomingCallback) =>
	async (
		env: BotEnv & EventEnv & PendingEnv & ChatConfigEnv & LoggerEnv,
	): Promise<void> => {
		const [verb, pendingId] = cb.data.split(":");
		const fallbackLanguage = await chatLanguage(env, cb.chatId);
		const fallbackText = botText(fallbackLanguage);
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
			await env.bot.answerCallback(cb.id, fallbackText.expiredShort);
			return;
		}
		const language = await chatLanguage(env, p.chatId);
		const t = botText(language);

		// Honor a tap only within PENDING_TTL_MS: past that the intent's time is
		// too stale to trust, so discard it and ask the user to resend.
		if (cb.at.getTime() - p.createdAt.getTime() > PENDING_TTL_MS) {
			await env.pendingRepository.delete(p.id);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, t.pendingExpired);
			return;
		}

		if (verb === "ann") {
			await env.pendingRepository.delete(p.id);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, t.canceled);
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
				await env.bot.answerCallback(cb.id, t.errorShort);
				return;
			}
			await env.bot.sendMessage(
				ctx.chatId,
				`${startedText(intent, language)} ✅`,
			);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// Biberon button (from the poppata-or-biberon prompt): make it an instant
		// bottle and ask for the ml.
		if (verb === "bottle") {
			const intent: Intent = { ...p.intent, type: "bottle", action: "instant" };
			await promptAmount(env, ctx, intent, language);
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
				await env.bot.answerCallback(cb.id, t.errorShort);
				return;
			}
			const decision = decide(intent, openRes.data, language);
			if (decision.kind === "confirm") {
				await createPending(
					env,
					ctx,
					decision.intent,
					decision.warning,
					language,
				);
				await env.bot.clearKeyboard(cb.chatId, cb.messageId);
				await env.pendingRepository.delete(p.id);
				await env.bot.answerCallback(cb.id);
				return;
			}
			// decision.kind === "save" (decide returns "error" only for end intents).
			if (needsSide(intent)) {
				await promptSide(env, ctx, intent, cb.at, language);
				await env.bot.clearKeyboard(cb.chatId, cb.messageId);
				await env.pendingRepository.delete(p.id);
				await env.bot.answerCallback(cb.id);
				return;
			}
			const applied = await applyIntent(intent, ctx)(env);
			if (!applied.success) {
				env.logger.error("applyIntent (type) failed", applied.error);
				await env.bot.answerCallback(cb.id, t.errorShort);
				return;
			}
			await env.bot.sendMessage(
				ctx.chatId,
				`${startedText(intent, language)} ✅`,
			);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// verb === "conf": a confirmed bottle still missing its ml asks for it.
		if (needsAmount(p.intent)) {
			await promptAmount(env, ctx, p.intent, language);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// verb === "conf": a confirmed feed start still missing its side asks for it.
		if (needsSide(p.intent)) {
			await promptSide(env, ctx, p.intent, cb.at, language);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		const applied = await applyIntent(p.intent, ctx)(env);
		if (!applied.success) {
			env.logger.error("applyIntent (confirm) failed", applied.error);
			await env.bot.answerCallback(cb.id, t.errorShort);
			return;
		}
		await feedbackFor(env, p, applied.data.closed, language);
		await env.bot.clearKeyboard(cb.chatId, cb.messageId);
		await env.pendingRepository.delete(p.id);
		await env.bot.answerCallback(cb.id);
	};

export const handleMessage =
	(msg: IncomingMessage) =>
	async (
		env: BotEnv & EventEnv & PendingEnv & ParserEnv & ChatConfigEnv & LoggerEnv,
	): Promise<void> => {
		const language = await chatLanguage(env, msg.chatId);
		const t = botText(language);
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
				await resolveAmount(env, p, ml, language);
				return;
			}
			await env.bot.sendMessage(msg.chatId, t.bottleAbandoned);
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
			await promptFeedType(env, feedCtx, at, language);
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
			await promptType(env, typeCtx, at, language);
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
				await env.bot.sendMessage(msg.chatId, t.helpHint);
			}
			return;
		}

		const openRes = await env.eventRepository.findOpenSession(msg.chatId);
		if (!openRes.success) {
			env.logger.error("findOpenSession failed", openRes.error);
			await env.bot.sendMessage(msg.chatId, internalError(language));
			return;
		}
		const open = openRes.data;

		if (action === "end" && !type) {
			if (!open) {
				await env.bot.sendMessage(msg.chatId, t.noOpenToClose);
				return;
			}
			type = open.type;
		}

		if (!type) {
			if (hasBabySignal(normalized)) {
				await env.bot.sendMessage(msg.chatId, t.helpHint);
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
					? language === "it"
						? ` C'è già una ${eventLabel(open.type, language)} aperta dalle ${hhmm(
								open.startedAt,
							)}, la chiudo alle ${hhmm(intent.at)}.`
						: ` There is already an open ${eventLabel(open.type, language)} since ${hhmm(
								open.startedAt,
							)}, I will close it at ${hhmm(intent.at)}.`
					: "";
			await createPending(
				env,
				ctx,
				intent,
				language === "it"
					? `Ho capito: ${describeIntent(intent, language)}.${closeNote} ${t.confirmQuestion}`
					: `I understood: ${describeIntent(intent, language)}.${closeNote} ${t.confirmQuestion}`,
				language,
			);
			return;
		}

		const decision = decide(intent, open, language);
		switch (decision.kind) {
			case "error":
				await env.bot.sendMessage(msg.chatId, decision.message);
				return;
			case "confirm":
				await createPending(
					env,
					ctx,
					decision.intent,
					decision.warning,
					language,
				);
				return;
			case "save":
				if (needsAmount(decision.intent)) {
					await promptAmount(env, ctx, decision.intent, language);
					return;
				}
				if (needsSide(decision.intent)) {
					await promptSide(env, ctx, decision.intent, msg.at, language);
					return;
				}
				await save(env, ctx, decision.intent, timeGiven, language);
				return;
		}
	};
