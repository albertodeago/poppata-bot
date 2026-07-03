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
	pgm.createTable("weights", {
		id: "id",
		chat_id: { type: "bigint", notNull: true },
		day: { type: "date", notNull: true },
		grams: { type: "integer", notNull: true },
		user_id: { type: "bigint", notNull: true },
		user_name: { type: "text", notNull: true },
		created_at: "created_at",
	});
	// Invariant: at most one weight reading per chat per calendar day.
	pgm.createIndex("weights", ["chat_id", "day"], {
		name: "one_weight_per_day",
		unique: true,
	});
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropTable("weights");
};
