/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	// Millilitres for a bottle (formula) feed; NULL for every other event type.
	pgm.addColumn("events", {
		amount_ml: { type: "integer", notNull: false },
	});
	// Discriminates a free-text "quanti ml?" question ('amount') from the
	// button-driven confirmations (NULL).
	pgm.addColumn("pending_confirmations", {
		kind: { type: "text", notNull: false },
	});
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropColumn("pending_confirmations", "kind");
	pgm.dropColumn("events", "amount_ml");
};
