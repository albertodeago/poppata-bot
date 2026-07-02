export interface LoggerEnv {
	readonly logger: Pick<
		typeof console,
		"info" | "warn" | "error" | "debug" | "log"
	>;
}
