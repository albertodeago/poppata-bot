import type {
	AccessStatus,
	ChatConfig,
	ChatConfigRepository,
	ChatLanguage,
} from "../../domain/chatConfig.js";
import type { DBEnv } from "../../domain/db.js";
import type { LoggerEnv } from "../../domain/logger.js";
import { tryCatch } from "../../domain/result.js";

interface ChatConfigRow {
	chat_id: string;
	baby_name: string | null;
	language: string;
	reports_enabled: boolean;
	status: string;
	username: string | null;
}

const mapRow = (row: ChatConfigRow): ChatConfig => ({
	chatId: Number(row.chat_id),
	...(row.baby_name ? { babyName: row.baby_name } : {}),
	language: row.language as ChatLanguage,
	reportsEnabled: row.reports_enabled,
	status: row.status as AccessStatus,
	...(row.username ? { username: row.username } : {}),
});

const COLUMNS =
	"chat_id, baby_name, language, reports_enabled, status, username";

export const makePgChatConfigRepository = (
	env: DBEnv & LoggerEnv,
): ChatConfigRepository => {
	const get = (chatId: number) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT ${COLUMNS} FROM chat_configs WHERE chat_id = $1`,
					[chatId],
				);
				const r = rows[0] as ChatConfigRow | undefined;
				return r ? mapRow(r) : null;
			},
			(e) => e,
		);

	return {
		get,

		create: ({ chatId, createdByName, language, username }) =>
			tryCatch(
				async () => {
					const rows = await env.db.query(
						`INSERT INTO chat_configs (chat_id, created_by_name, language, username)
						 VALUES ($1, $2, $3, $4)
						 ON CONFLICT (chat_id) DO NOTHING
						 RETURNING ${COLUMNS}`,
						[chatId, createdByName, language ?? "it", username ?? null],
					);
					const r = rows[0] as ChatConfigRow | undefined;
					if (r) return mapRow(r);
					// Conflict: the row already existed — return it.
					const existing = await get(chatId);
					if (!existing.success) throw existing.error;
					if (!existing.data) throw new Error("create: row vanished");
					return existing.data;
				},
				(e) => e,
			),

		setBabyName: (chatId: number, babyName: string) =>
			tryCatch(
				async () => {
					const rows = await env.db.query(
						`INSERT INTO chat_configs (chat_id, baby_name)
						 VALUES ($1, $2)
						 ON CONFLICT (chat_id) DO UPDATE SET baby_name = EXCLUDED.baby_name
						 RETURNING ${COLUMNS}`,
						[chatId, babyName],
					);
					const r = rows[0] as ChatConfigRow | undefined;
					if (!r) throw new Error("setBabyName returned no row");
					return mapRow(r);
				},
				(e) => e,
			),

		setReportsEnabled: (chatId: number, enabled: boolean) =>
			tryCatch(
				async () => {
					const rows = await env.db.query(
						`INSERT INTO chat_configs (chat_id, reports_enabled)
						 VALUES ($1, $2)
						 ON CONFLICT (chat_id) DO UPDATE SET reports_enabled = EXCLUDED.reports_enabled
						 RETURNING ${COLUMNS}`,
						[chatId, enabled],
					);
					const r = rows[0] as ChatConfigRow | undefined;
					if (!r) throw new Error("setReportsEnabled returned no row");
					return mapRow(r);
				},
				(e) => e,
			),

		setLanguage: (chatId: number, language: ChatLanguage) =>
			tryCatch(
				async () => {
					const rows = await env.db.query(
						`INSERT INTO chat_configs (chat_id, language)
						 VALUES ($1, $2)
						 ON CONFLICT (chat_id) DO UPDATE SET language = EXCLUDED.language
						 RETURNING ${COLUMNS}`,
						[chatId, language],
					);
					const r = rows[0] as ChatConfigRow | undefined;
					if (!r) throw new Error("setLanguage returned no row");
					return mapRow(r);
				},
				(e) => e,
			),

		setStatus: (chatId: number, status: AccessStatus) =>
			tryCatch(
				async () => {
					const rows = await env.db.query(
						`UPDATE chat_configs SET status = $2
						 WHERE chat_id = $1
						 RETURNING ${COLUMNS}`,
						[chatId, status],
					);
					const r = rows[0] as ChatConfigRow | undefined;
					if (!r) throw new Error(`setStatus: no chat ${chatId}`);
					return mapRow(r);
				},
				(e) => e,
			),

		listAll: () =>
			tryCatch(
				async () => {
					const rows = await env.db.query(
						`SELECT ${COLUMNS} FROM chat_configs
						 WHERE status = 'approved' ORDER BY created_at`,
					);
					return (rows as ChatConfigRow[]).map(mapRow);
				},
				(e) => e,
			),
	};
};
