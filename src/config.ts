export type Config = {
	botToken: string;
	allowedChatId: number;
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
	const allowedChatId = Number.parseInt(required("ALLOWED_CHAT_ID"), 10);
	if (Number.isNaN(allowedChatId)) {
		throw new Error("ALLOWED_CHAT_ID must be a number");
	}

	const config: Config = {
		botToken: required("BOT_TOKEN"),
		allowedChatId,
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
