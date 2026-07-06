import { vi } from "vitest";
import type { BotEnv } from "../../src/domain/bot.js";
import type { ChatConfigEnv } from "../../src/domain/chatConfig.js";
import type { EventEnv } from "../../src/domain/event.js";
import type { LoggerEnv } from "../../src/domain/logger.js";
import type { ParserEnv } from "../../src/domain/parse.js";
import type { PendingEnv } from "../../src/domain/pending.js";
import { success } from "../../src/domain/result.js";
import type { WeightEnv } from "../../src/domain/weight.js";

export const makeTestEnv = () => {
	const mocks = {
		eventRepository: {
			insert: vi.fn<EventEnv["eventRepository"]["insert"]>(),
			findOpenSession: vi.fn<EventEnv["eventRepository"]["findOpenSession"]>(),
			findLastFeed: vi.fn<EventEnv["eventRepository"]["findLastFeed"]>(),
			closeSession: vi.fn<EventEnv["eventRepository"]["closeSession"]>(),
			deleteLast: vi.fn<EventEnv["eventRepository"]["deleteLast"]>(),
			listSince: vi.fn<EventEnv["eventRepository"]["listSince"]>(),
		},
		weightRepository: {
			upsert: vi.fn<WeightEnv["weightRepository"]["upsert"]>(),
			list: vi.fn<WeightEnv["weightRepository"]["list"]>(),
		},
		chatConfigRepository: {
			get: vi.fn<ChatConfigEnv["chatConfigRepository"]["get"]>(),
			count: vi.fn<ChatConfigEnv["chatConfigRepository"]["count"]>(),
			create: vi.fn<ChatConfigEnv["chatConfigRepository"]["create"]>(),
			setBabyName:
				vi.fn<ChatConfigEnv["chatConfigRepository"]["setBabyName"]>(),
			listAll: vi.fn<ChatConfigEnv["chatConfigRepository"]["listAll"]>(),
		},
		pendingRepository: {
			create: vi.fn<PendingEnv["pendingRepository"]["create"]>(),
			get: vi.fn<PendingEnv["pendingRepository"]["get"]>(),
			findAmountPending:
				vi.fn<PendingEnv["pendingRepository"]["findAmountPending"]>(),
			delete: vi.fn<PendingEnv["pendingRepository"]["delete"]>(),
			deleteStale: vi.fn<PendingEnv["pendingRepository"]["deleteStale"]>(),
		},
		parser: { parse: vi.fn<ParserEnv["parser"]["parse"]>() },
		bot: {
			sendMessage: vi.fn<BotEnv["bot"]["sendMessage"]>(),
			react: vi.fn<BotEnv["bot"]["react"]>(),
			sendConfirmation: vi.fn<BotEnv["bot"]["sendConfirmation"]>(),
			sendSidePrompt: vi.fn<BotEnv["bot"]["sendSidePrompt"]>(),
			sendTypePrompt: vi.fn<BotEnv["bot"]["sendTypePrompt"]>(),
			sendFeedTypePrompt: vi.fn<BotEnv["bot"]["sendFeedTypePrompt"]>(),
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

	const env: BotEnv &
		EventEnv &
		PendingEnv &
		ParserEnv &
		WeightEnv &
		ChatConfigEnv &
		LoggerEnv = {
		eventRepository: mocks.eventRepository,
		weightRepository: mocks.weightRepository,
		pendingRepository: mocks.pendingRepository,
		chatConfigRepository: mocks.chatConfigRepository,
		parser: mocks.parser,
		bot: mocks.bot,
		logger: mocks.logger,
	};

	// Default: no open "quanti ml?" question. Every handleMessage checks this,
	// so give it a safe default; tests that exercise the flow override it.
	mocks.pendingRepository.findAmountPending.mockResolvedValue(success(null));

	return { mocks, env };
};
