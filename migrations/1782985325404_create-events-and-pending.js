import { PgLiteral } from "node-pg-migrate";

/** @type {import('node-pg-migrate').ColumnDefinitions} */
export const shorthands = {
	id: {
		type: "uuid",
		primaryKey: true,
		default: new PgLiteral("gen_random_uuid()"),
	},
	created_at: {
		type: "timestamptz",
		notNull: true,
		default: new PgLiteral("NOW()"),
	},
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	pgm.createTable("events", {
		id: "id",
		chat_id: { type: "bigint", notNull: true },
		user_id: { type: "bigint", notNull: true },
		user_name: { type: "text", notNull: true },
		type: { type: "text", notNull: true },
		side: { type: "text", notNull: false },
		started_at: { type: "timestamptz", notNull: true },
		ended_at: { type: "timestamptz", notNull: false },
		source: { type: "text", notNull: true },
		raw_text: { type: "text", notNull: true },
		message_id: { type: "bigint", notNull: true },
		created_at: "created_at",
	});
	pgm.createIndex("events", ["chat_id", "started_at"]);
	// Invariant: at most one open eat/sleep session per chat.
	pgm.createIndex("events", "chat_id", {
		name: "one_open_session_per_chat",
		unique: true,
		where: "ended_at IS NULL AND type IN ('eat','sleep')",
	});

	pgm.createTable("pending_confirmations", {
		id: "id",
		chat_id: { type: "bigint", notNull: true },
		user_id: { type: "bigint", notNull: true },
		user_name: { type: "text", notNull: true },
		raw_text: { type: "text", notNull: true },
		intent: { type: "jsonb", notNull: true },
		warning: { type: "text", notNull: true },
		message_id: { type: "bigint", notNull: true },
		created_at: "created_at",
	});
	pgm.createIndex("pending_confirmations", "chat_id");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropTable("pending_confirmations");
	pgm.dropTable("events");
};
