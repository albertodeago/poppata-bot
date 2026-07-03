import type { DBEnv } from "../../domain/db.js";
import type { LoggerEnv } from "../../domain/logger.js";
import { tryCatch } from "../../domain/result.js";
import type {
	NewWeightReading,
	WeightReading,
	WeightRepository,
} from "../../domain/weight.js";

interface WeightRow {
	id: string;
	chat_id: string;
	day: string;
	grams: number;
	user_id: string;
	user_name: string;
	created_at: Date;
	overwritten?: boolean;
}

const mapRow = (row: WeightRow): WeightReading => ({
	id: row.id,
	chatId: Number(row.chat_id),
	day: row.day,
	grams: Number(row.grams),
	userId: Number(row.user_id),
	userName: row.user_name,
	createdAt: new Date(row.created_at),
});

// `to_char(day, …)` forces a yyyy-MM-dd string (node-postgres otherwise returns
// a `date` column as a local-midnight Date, which would shift the day).
const COLUMNS =
	"id, chat_id, to_char(day, 'YYYY-MM-DD') AS day, grams, user_id, user_name, created_at";

export const makePgWeightRepository = (
	env: DBEnv & LoggerEnv,
): WeightRepository => ({
	upsert: (reading: NewWeightReading) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`INSERT INTO weights (chat_id, day, grams, user_id, user_name)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT (chat_id, day)
				 DO UPDATE SET grams = EXCLUDED.grams,
				               user_id = EXCLUDED.user_id,
				               user_name = EXCLUDED.user_name,
				               created_at = NOW()
				 RETURNING ${COLUMNS}, (xmax <> 0) AS overwritten`,
					[
						reading.chatId,
						reading.day,
						reading.grams,
						reading.userId,
						reading.userName,
					],
				);
				const r = rows[0] as WeightRow | undefined;
				if (!r) throw new Error("upsert returned no row");
				return { reading: mapRow(r), overwritten: r.overwritten === true };
			},
			(e) => e,
		),

	list: (chatId: number) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT ${COLUMNS} FROM weights WHERE chat_id = $1 ORDER BY day`,
					[chatId],
				);
				return (rows as WeightRow[]).map(mapRow);
			},
			(e) => e,
		),
});
