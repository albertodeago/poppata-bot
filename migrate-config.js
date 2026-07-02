// @ts-check
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });

/** @type {import('node-pg-migrate').RunnerOption} */
const config = {
	databaseUrl: process.env.DATABASE_URL,
	migrationsTable: "pgmigrations",
	dir: "migrations",
	direction: "up",
};

export default config;
