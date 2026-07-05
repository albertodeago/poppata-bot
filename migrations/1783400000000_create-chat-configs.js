import { PgLiteral } from "node-pg-migrate";

/** @type {import('node-pg-migrate').ColumnDefinitions} */
export const shorthands = {
	created_at: {
		type: "timestamptz",
		notNull: true,
		default: new PgLiteral("NOW()"),
	},
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	// One row per served chat. The row's existence is the access gate (a chat is
	// "registered" once it has one); baby_name is optional config shown in reports.
	pgm.createTable("chat_configs", {
		chat_id: { type: "bigint", primaryKey: true },
		baby_name: { type: "text", notNull: false },
		created_by_name: { type: "text", notNull: false },
		created_at: "created_at",
	});

	// Same hardening as the other tables: RLS on with no policy default-denies the
	// public PostgREST roles, while the bot's BYPASSRLS `postgres` role over direct
	// SQL is unaffected. (See 1783300000000_enable-rls.js.)
	pgm.sql("ALTER TABLE chat_configs ENABLE ROW LEVEL SECURITY");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropTable("chat_configs");
};
