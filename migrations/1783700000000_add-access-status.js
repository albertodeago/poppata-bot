/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	// Access moves from "row exists = active" to an explicit lifecycle: a chat
	// requests access (pending), the admin approves it (approved) or rejects it
	// (banned). The serving gate becomes status = 'approved'. username is the
	// requester's @handle (optional in Telegram), kept to eyeball repeat bans.
	pgm.addColumn("chat_configs", {
		status: { type: "text", notNull: true, default: "pending" },
		username: { type: "text", notNull: false },
	});
	pgm.addConstraint("chat_configs", "chat_configs_status_check", {
		check: "status IN ('pending', 'approved', 'banned')",
	});
	// Existing chats are already live — grandfather them in so nothing breaks.
	pgm.sql("UPDATE chat_configs SET status = 'approved'");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropConstraint("chat_configs", "chat_configs_status_check");
	pgm.dropColumn("chat_configs", ["status", "username"]);
};
