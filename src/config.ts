export type Config = {
	botToken: string;
	databaseUrl: string;
	geminiApiKey: string;
	geminiModel: string;
	cronSecret: string;
	webhookUrl: string;
	webhookSecret: string;
	/** Max number of chats that may self-register (MAX_CHATS, default 5). */
	maxChats: number;
	/** Base repo issues URL for the "bot full" request-access link. */
	repoIssuesUrl: string;
};

const DEFAULT_REPO_ISSUES_URL =
	"https://github.com/albertodeago/poppata-bot/issues";

export type ConfigEnv = {
	config: Config;
};

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set in the environment`);
	return value;
};

export const getConfig = (): Config => {
	const maxChats = process.env.MAX_CHATS
		? Number.parseInt(process.env.MAX_CHATS, 10)
		: 5;
	if (Number.isNaN(maxChats) || maxChats < 1) {
		throw new Error("MAX_CHATS must be a positive integer");
	}

	const config: Config = {
		botToken: required("BOT_TOKEN"),
		databaseUrl: required("DATABASE_URL"),
		geminiApiKey: required("GEMINI_API_KEY"),
		geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
		cronSecret: required("CRON_SECRET"),
		webhookUrl: required("WEBHOOK_URL"),
		webhookSecret: required("WEBHOOK_SECRET"),
		maxChats,
		repoIssuesUrl: process.env.REPO_ISSUES_URL ?? DEFAULT_REPO_ISSUES_URL,
	};
	return config;
};
