/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

// Every public table is created by (and owned by) `postgres`, whose role has
// BYPASSRLS — so the bot keeps full access via the direct SQL connection no
// matter what RLS says. Enabling RLS with NO policies therefore closes the only
// other door: the public PostgREST API, where the `anon`/`authenticated` roles
// hold full DML grants. With RLS on and no policy, those roles are
// default-denied on every row. `pgmigrations` is included so no public table is
// left "Unrestricted".
const TABLES = ["events", "pending_confirmations", "weights", "pgmigrations"];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
	for (const table of TABLES) {
		pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
	}
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
	for (const table of TABLES) {
		pgm.sql(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
	}
};
