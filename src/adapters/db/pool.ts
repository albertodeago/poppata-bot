import { Pool } from "pg";
import type { ConfigEnv } from "../../config.js";
import type { DBEnv } from "../../domain/db.js";
import type { LoggerEnv } from "../../domain/logger.js";

/** Fail a stuck connect fast (well under the 10s webhook / 30s cron limits) so it
 *  surfaces as a catchable error instead of a silent function timeout. */
const CONNECTION_TIMEOUT_MS = 8000;

/** pg Pool over the Supabase pooled connection (port 6543). max 1 for serverless. */
export const makePgPool = (env: ConfigEnv & LoggerEnv): DBEnv["db"] => {
	const pool = new Pool({
		connectionString: env.config.databaseUrl,
		max: 1,
		connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
	});

	pool.on("error", (err) => {
		env.logger.error("Unexpected error on idle pg client", err);
	});

	env.logger.info("pg pool initialized");

	return {
		query: async (sql, params) => {
			const client = await pool.connect();
			try {
				const result = await client.query(sql, params);
				return result.rows;
			} finally {
				client.release();
			}
		},
	};
};
