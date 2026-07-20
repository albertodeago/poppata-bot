/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	// Shared reply language for the whole chat. Telegram exposes per-user client
	// language, but group bot replies should stay consistent for everyone.
	pgm.addColumn("chat_configs", {
		language: { type: "text", notNull: true, default: "it" },
	});
	pgm.addConstraint("chat_configs", "chat_configs_language_check", {
		check: "language IN ('it', 'en')",
	});
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropConstraint("chat_configs", "chat_configs_language_check");
	pgm.dropColumn("chat_configs", "language");
};