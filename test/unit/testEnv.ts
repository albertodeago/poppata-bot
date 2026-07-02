import { vi } from "vitest";
import type { BotEnv } from "../../src/domain/bot.js";
import type { EventEnv } from "../../src/domain/event.js";
import type { LoggerEnv } from "../../src/domain/logger.js";
import type { ParserEnv } from "../../src/domain/parse.js";
import type { PendingEnv } from "../../src/domain/pending.js";

export const makeTestEnv = () => {
	const mocks = {
		eventRepository: {
			insert: vi.fn<EventEnv["eventRepository"]["insert"]>(),
			findOpenSession: vi.fn<EventEnv["eventRepository"]["findOpenSession"]>(),
			closeSession: vi.fn<EventEnv["eventRepository"]["closeSession"]>(),
			deleteLast: vi.fn<EventEnv["eventRepository"]["deleteLast"]>(),
			listSince: vi.fn<EventEnv["eventRepository"]["listSince"]>(),
		},
		pendingRepository: {
			create: vi.fn<PendingEnv["pendingRepository"]["create"]>(),
			get: vi.fn<PendingEnv["pendingRepository"]["get"]>(),
			delete: vi.fn<PendingEnv["pendingRepository"]["delete"]>(),
			deleteStale: vi.fn<PendingEnv["pendingRepository"]["deleteStale"]>(),
		},
		parser: { parse: vi.fn<ParserEnv["parser"]["parse"]>() },
		bot: {
			sendMessage: vi.fn<BotEnv["bot"]["sendMessage"]>(),
			react: vi.fn<BotEnv["bot"]["react"]>(),
			sendConfirmation: vi.fn<BotEnv["bot"]["sendConfirmation"]>(),
			answerCallback: vi.fn<BotEnv["bot"]["answerCallback"]>(),
			clearKeyboard: vi.fn<BotEnv["bot"]["clearKeyboard"]>(),
		},
		logger: {
			info: vi.fn<LoggerEnv["logger"]["info"]>(),
			warn: vi.fn<LoggerEnv["logger"]["warn"]>(),
			error: vi.fn<LoggerEnv["logger"]["error"]>(),
			debug: vi.fn<LoggerEnv["logger"]["debug"]>(),
			log: vi.fn<LoggerEnv["logger"]["log"]>(),
		},
	};

	const env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv = {
		eventRepository: mocks.eventRepository,
		pendingRepository: mocks.pendingRepository,
		parser: mocks.parser,
		bot: mocks.bot,
		logger: mocks.logger,
	};

	return { mocks, env };
};
