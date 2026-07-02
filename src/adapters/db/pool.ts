import { Pool } from "pg";
import type { ConfigEnv } from "../../config";
import type { DBEnv } from "../../domain/db";
import type { LoggerEnv } from "../../domain/logger";

/** pg Pool over the Supabase pooled connection (port 6543). max 1 for serverless. */
export const makePgPool = (env: ConfigEnv & LoggerEnv): DBEnv["db"] => {
	const pool = new Pool({ connectionString: env.config.databaseUrl, max: 1 });

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
