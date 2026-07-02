import type { Telegraf } from "telegraf";
import type { Update } from "telegraf/types";
import { makeLogger } from "./adapters/console/logger";
import { makePgPool } from "./adapters/db/pool";
import { makeGeminiParser } from "./adapters/gemini/parse";
import { makePgEventRepository } from "./adapters/pg/event";
import { makePgPendingRepository } from "./adapters/pg/pending";
import { makeTelegrafAdapter } from "./adapters/telegraf/bot";
import { type ConfigEnv, getConfig } from "./config";
import type { BotEnv } from "./domain/bot";
import type { DBEnv } from "./domain/db";
import type { EventEnv } from "./domain/event";
import type { LoggerEnv } from "./domain/logger";
import type { ParserEnv } from "./domain/parse";
import type { PendingEnv } from "./domain/pending";

type InfraEnv = {
	telegrafBot: Telegraf;
	handleWebhook(update: unknown): Promise<void>;
};

export type Env = LoggerEnv &
	ConfigEnv &
	DBEnv &
	EventEnv &
	PendingEnv &
	ParserEnv &
	BotEnv &
	InfraEnv;

export const makeEnv = (): Env => {
	const logger = makeLogger();
	const config = getConfig();
	const db = makePgPool({ config, logger });
	const eventRepository = makePgEventRepository({ db, logger });
	const pendingRepository = makePgPendingRepository({ db, logger });
	const parser = makeGeminiParser({ config, logger });
	const telegraf = makeTelegrafAdapter()({ config, logger });

	return {
		logger,
		config,
		db,
		eventRepository,
		pendingRepository,
		parser,
		...telegraf.botEnv,
		telegrafBot: telegraf.instance,
		handleWebhook: async (update: unknown) => {
			await telegraf.instance.handleUpdate(update as Update);
		},
	};
};
