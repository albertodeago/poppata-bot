import type { LoggerEnv } from "../../domain/logger";

export const makeLogger = (): LoggerEnv["logger"] => console;
