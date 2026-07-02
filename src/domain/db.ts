export type DBEnv = {
	db: {
		// biome-ignore lint/suspicious/noExplicitAny: DB rows are dynamically shaped
		query(sql: string, params?: unknown[]): Promise<any[]>;
	};
};
