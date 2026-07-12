export type Config = {
	botToken: string;
	databaseUrl: string;
	geminiApiKey: string;
	geminiModel: string;
	cronSecret: string;
	webhookUrl: string;
	webhookSecret: string;
	/** t.me deep-link base for the stats Mini App, e.g. https://t.me/Bot/app */
	miniAppUrl: string;
	/** Public URL of the visual onboarding guide, derived from webhookUrl. */
	guideUrl: string;
	/** Telegram chat where access requests land and the admin approves/bans. */
	adminChatId: number;
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
	const adminChatIdRaw = required("ADMIN_CHAT_ID");
	if (!/^-?\d+$/.test(adminChatIdRaw)) {
		throw new Error("ADMIN_CHAT_ID must be an integer");
	}
	const adminChatId = Number.parseInt(adminChatIdRaw, 10);

	const webhookUrl = required("WEBHOOK_URL");
	const config: Config = {
		botToken: required("BOT_TOKEN"),
		databaseUrl: required("DATABASE_URL"),
		geminiApiKey: required("GEMINI_API_KEY"),
		geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
		cronSecret: required("CRON_SECRET"),
		webhookUrl,
		webhookSecret: required("WEBHOOK_SECRET"),
		miniAppUrl: required("MINIAPP_URL"),
		guideUrl: `${webhookUrl.replace(/\/$/, "")}/guida.html`,
		adminChatId,
	};
	return config;
};
