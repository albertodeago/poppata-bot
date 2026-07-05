import type { Telegraf } from "telegraf";
import type { Update } from "telegraf/types";
import { makeLogger } from "./adapters/console/logger.js";
import { makePgPool } from "./adapters/db/pool.js";
import { makeGeminiParser } from "./adapters/gemini/parse.js";
import { makePgChatConfigRepository } from "./adapters/pg/chatConfig.js";
import { makePgEventRepository } from "./adapters/pg/event.js";
import { makePgPendingRepository } from "./adapters/pg/pending.js";
import { makePgWeightRepository } from "./adapters/pg/weight.js";
import { makeTelegrafAdapter } from "./adapters/telegraf/bot.js";
import { type ConfigEnv, getConfig } from "./config.js";
import type { BotEnv } from "./domain/bot.js";
import type { ChatConfigEnv } from "./domain/chatConfig.js";
import type { DBEnv } from "./domain/db.js";
import type { EventEnv } from "./domain/event.js";
import type { LoggerEnv } from "./domain/logger.js";
import type { ParserEnv } from "./domain/parse.js";
import type { PendingEnv } from "./domain/pending.js";
import type { WeightEnv } from "./domain/weight.js";

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
	WeightEnv &
	ChatConfigEnv &
	BotEnv &
	InfraEnv;

export const makeEnv = (): Env => {
	const logger = makeLogger();
	const config = getConfig();
	const db = makePgPool({ config, logger });
	const eventRepository = makePgEventRepository({ db, logger });
	const weightRepository = makePgWeightRepository({ db, logger });
	const pendingRepository = makePgPendingRepository({ db, logger });
	const chatConfigRepository = makePgChatConfigRepository({ db, logger });
	const parser = makeGeminiParser({ config, logger });
	const telegraf = makeTelegrafAdapter()({
		config,
		logger,
		chatConfigRepository,
	});

	return {
		logger,
		config,
		db,
		eventRepository,
		weightRepository,
		pendingRepository,
		chatConfigRepository,
		parser,
		...telegraf.botEnv,
		telegrafBot: telegraf.instance,
		handleWebhook: async (update: unknown) => {
			await telegraf.instance.handleUpdate(update as Update);
		},
	};
};
