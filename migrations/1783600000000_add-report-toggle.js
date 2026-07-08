/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	// Per-chat switch for the cron-pushed reports (daily + Monday weekly). Default
	// true so existing chats keep receiving them; a chat opts out via /report off.
	pgm.addColumn("chat_configs", {
		reports_enabled: { type: "boolean", notNull: true, default: true },
	});
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropColumn("chat_configs", "reports_enabled");
};
