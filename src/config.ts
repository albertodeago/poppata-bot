export type Config = {
	botToken: string;
	/** One or more group chats the bot serves (comma-separated in ALLOWED_CHAT_ID). */
	allowedChatIds: number[];
	databaseUrl: string;
	geminiApiKey: string;
	geminiModel: string;
	cronSecret: string;
	webhookUrl: string;
	webhookSecret: string;
	babyName?: string;
};

export type ConfigEnv = {
	config: Config;
};

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set in the environment`);
	return value;
};

export const getConfig = (): Config => {
	const allowedChatIds = required("ALLOWED_CHAT_ID")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => Number.parseInt(s, 10));
	if (
		allowedChatIds.length === 0 ||
		allowedChatIds.some((id) => Number.isNaN(id))
	) {
		throw new Error(
			"ALLOWED_CHAT_ID must be one or more comma-separated numbers",
		);
	}

	const config: Config = {
		botToken: required("BOT_TOKEN"),
		allowedChatIds,
		databaseUrl: required("DATABASE_URL"),
		geminiApiKey: required("GEMINI_API_KEY"),
		geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
		cronSecret: required("CRON_SECRET"),
		webhookUrl: required("WEBHOOK_URL"),
		webhookSecret: required("WEBHOOK_SECRET"),
		...(process.env.BABY_NAME ? { babyName: process.env.BABY_NAME } : {}),
	};
	return config;
};
