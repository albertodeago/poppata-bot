import type { DBEnv } from "../../domain/db.js";
import type {
	BabyEvent,
	EventRepository,
	EventSource,
	EventType,
	NewBabyEvent,
	Side,
} from "../../domain/event.js";
import type { LoggerEnv } from "../../domain/logger.js";
import { tryCatch } from "../../domain/result.js";

interface EventRow {
	id: string;
	chat_id: string;
	user_id: string;
	user_name: string;
	type: string;
	side: string | null;
	started_at: Date;
	ended_at: Date | null;
	source: string;
	raw_text: string;
	message_id: string;
	created_at: Date;
}

const mapRow = (row: EventRow): BabyEvent => {
	const event: BabyEvent = {
		id: row.id,
		chatId: Number(row.chat_id),
		userId: Number(row.user_id),
		userName: row.user_name,
		type: row.type as EventType,
		startedAt: new Date(row.started_at),
		source: row.source as EventSource,
		rawText: row.raw_text,
		messageId: Number(row.message_id),
		createdAt: new Date(row.created_at),
	};
	if (row.side) event.side = row.side as Side;
	if (row.ended_at) event.endedAt = new Date(row.ended_at);
	return event;
};

export const makePgEventRepository = (
	env: DBEnv & LoggerEnv,
): EventRepository => ({
	insert: (event: NewBabyEvent) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`INSERT INTO events
				 (chat_id, user_id, user_name, type, side, started_at, ended_at, source, raw_text, message_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				 RETURNING *`,
					[
						event.chatId,
						event.userId,
						event.userName,
						event.type,
						event.side ?? null,
						event.startedAt,
						event.endedAt ?? null,
						event.source,
						event.rawText,
						event.messageId,
					],
				);
				if (!rows[0]) throw new Error("insert returned no row");
				return mapRow(rows[0]);
			},
			(e) => e,
		),

	findOpenSession: (chatId) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT * FROM events
				 WHERE chat_id = $1 AND ended_at IS NULL AND type IN ('eat','sleep')
				 ORDER BY started_at DESC LIMIT 1`,
					[chatId],
				);
				return rows[0] ? mapRow(rows[0]) : null;
			},
			(e) => e,
		),

	findLastFeed: (chatId) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT * FROM events
				 WHERE chat_id = $1 AND type = 'eat' AND side IS NOT NULL
				 ORDER BY started_at DESC LIMIT 1`,
					[chatId],
				);
				return rows[0] ? mapRow(rows[0]) : null;
			},
			(e) => e,
		),

	closeSession: (id, endedAt) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`UPDATE events SET ended_at = $2 WHERE id = $1 RETURNING *`,
					[id, endedAt],
				);
				if (!rows[0]) throw new Error("closeSession: session not found");
				return mapRow(rows[0]);
			},
			(e) => e,
		),

	deleteLast: (chatId) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`DELETE FROM events
				 WHERE id = (
				   SELECT id FROM events WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1
				 )
				 RETURNING *`,
					[chatId],
				);
				return rows[0] ? mapRow(rows[0]) : null;
			},
			(e) => e,
		),

	listSince: (chatId, start, end) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT * FROM events
				 WHERE chat_id = $1 AND started_at < $3
				   AND ( (type IN ('pee','poop') AND started_at >= $2)
				      OR (type IN ('eat','sleep') AND (ended_at IS NULL OR ended_at > $2)) )
				 ORDER BY started_at`,
					[chatId, start, end],
				);
				return rows.map(mapRow);
			},
			(e) => e,
		),
});
