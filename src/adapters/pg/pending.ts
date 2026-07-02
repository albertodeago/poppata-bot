import type { DBEnv } from "../../domain/db.js";
import type { EventSource, EventType, Side } from "../../domain/event.js";
import type { LoggerEnv } from "../../domain/logger.js";
import type { Action, Intent } from "../../domain/parse.js";
import type {
	NewPendingConfirmation,
	PendingConfirmation,
	PendingRepository,
} from "../../domain/pending.js";
import { tryCatch } from "../../domain/result.js";

interface IntentJson {
	type: string;
	action: string;
	at: string;
	source: string;
	confidence: number;
	side?: string;
}

const serializeIntent = (i: Intent): IntentJson => ({
	type: i.type,
	action: i.action,
	at: i.at.toISOString(),
	source: i.source,
	confidence: i.confidence,
	...(i.side ? { side: i.side } : {}),
});

const deserializeIntent = (o: IntentJson): Intent => {
	const intent: Intent = {
		type: o.type as EventType,
		action: o.action as Action,
		at: new Date(o.at),
		source: o.source as EventSource,
		confidence: o.confidence,
	};
	if (o.side) intent.side = o.side as Side;
	return intent;
};

interface PendingRow {
	id: string;
	chat_id: string;
	user_id: string;
	user_name: string;
	raw_text: string;
	intent: IntentJson;
	warning: string;
	message_id: string;
	created_at: Date;
}

const mapRow = (row: PendingRow): PendingConfirmation => ({
	id: row.id,
	chatId: Number(row.chat_id),
	userId: Number(row.user_id),
	userName: row.user_name,
	rawText: row.raw_text,
	intent: deserializeIntent(row.intent),
	warning: row.warning,
	messageId: Number(row.message_id),
	createdAt: new Date(row.created_at),
});

export const makePgPendingRepository = (
	env: DBEnv & LoggerEnv,
): PendingRepository => ({
	create: (p: NewPendingConfirmation) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`INSERT INTO pending_confirmations
				 (chat_id, user_id, user_name, raw_text, intent, warning, message_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)
				 RETURNING *`,
					[
						p.chatId,
						p.userId,
						p.userName,
						p.rawText,
						JSON.stringify(serializeIntent(p.intent)),
						p.warning,
						p.messageId,
					],
				);
				if (!rows[0]) throw new Error("create pending returned no row");
				return mapRow(rows[0]);
			},
			(e) => e,
		),

	get: (id) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT * FROM pending_confirmations WHERE id = $1`,
					[id],
				);
				return rows[0] ? mapRow(rows[0]) : null;
			},
			(e) => e,
		),

	delete: (id) =>
		tryCatch(
			async () => {
				await env.db.query(`DELETE FROM pending_confirmations WHERE id = $1`, [
					id,
				]);
				return undefined;
			},
			(e) => e,
		),

	deleteStale: (olderThan) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`DELETE FROM pending_confirmations WHERE created_at < $1 RETURNING id`,
					[olderThan],
				);
				return rows.length;
			},
			(e) => e,
		),
});
