import { createInterface } from "node:readline";
import { makeConsoleBot } from "./adapters/console/bot.js";
import { makeLogger } from "./adapters/console/logger.js";
import { makeMemoryEventRepository } from "./adapters/memory/event.js";
import { makeMemoryPendingRepository } from "./adapters/memory/pending.js";
import { makeNoopParser } from "./adapters/noop/parser.js";
import {
	type BotEnv,
	handleCallback,
	handleMessage,
	type IncomingMessage,
} from "./domain/bot.js";
import {
	annullaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	sendDailyReport,
	sendWeeklyReport,
	settimanaCommand,
	startCommand,
	statoCommand,
} from "./domain/commands.js";
import type { EventEnv } from "./domain/event.js";
import type { LoggerEnv } from "./domain/logger.js";
import type { ParserEnv } from "./domain/parse.js";
import type { PendingEnv } from "./domain/pending.js";

const DEV_CHAT_ID = 1;
const DEV_USER_ID = 1;

const logger = makeLogger();
const { botEnv, state } = makeConsoleBot({ logger });
const env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv = {
	logger,
	eventRepository: makeMemoryEventRepository({ logger }),
	pendingRepository: makeMemoryPendingRepository({ logger }),
	parser: makeNoopParser(),
	...botEnv,
};

let msgSeq = 0;

const parsePrefixes = (
	line: string,
): { at: Date; text: string; user: string } => {
	let text = line;
	let at = new Date();
	let user = "papà";

	const nameMatch = text.match(/^@(\S+)\s+(.*)$/);
	if (nameMatch?.[1]) {
		user = nameMatch[1];
		text = nameMatch[2] ?? "";
	}

	const timeMatch = text.match(/^!(\d{1,2}):(\d{2})\s+(.*)$/);
	if (timeMatch?.[1] && timeMatch[2]) {
		const d = new Date();
		d.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
		at = d;
		text = timeMatch[3] ?? "";
	}

	return { at, text, user };
};

const runCommand = async (cmd: string): Promise<boolean> => {
	const now = new Date();
	switch (cmd) {
		case "/stato":
			await statoCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/oggi":
			await oggiCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/ieri":
			await ieriCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/settimana":
			await settimanaCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/annulla":
			await annullaCommand(DEV_CHAT_ID)(env);
			return true;
		case "/help":
			await helpCommand(DEV_CHAT_ID)(env);
			return true;
		case "/start":
			await startCommand(DEV_CHAT_ID)(env);
			return true;
		case "/report":
			await sendDailyReport(DEV_CHAT_ID, now)(env);
			return true;
		case "/report-week":
			await sendWeeklyReport(DEV_CHAT_ID, now)(env);
			return true;
		default:
			return false;
	}
};

const handleLine = async (line: string): Promise<void> => {
	const trimmed = line.trim();
	if (!trimmed) return;

	if (["conf", "ann", "dx", "sx"].includes(trimmed)) {
		const pendingId = state.lastPendingId;
		if (!pendingId) {
			console.log("   (nessuna conferma in sospeso)");
			return;
		}
		await handleCallback({
			id: "cb",
			chatId: DEV_CHAT_ID,
			userId: DEV_USER_ID,
			userName: "papà",
			data: `${trimmed}:${pendingId}`,
			messageId: state.lastConfirmationMessageId ?? 0,
		})(env);
		// A callback may open a NEW prompt (e.g. conf → side prompt), which the
		// console adapter records in state.lastPendingId. Only clear when unchanged.
		if (state.lastPendingId === pendingId) state.lastPendingId = undefined;
		return;
	}

	if (trimmed.startsWith("/")) {
		const handled = await runCommand(trimmed);
		if (!handled) console.log(`   (comando sconosciuto: ${trimmed})`);
		return;
	}

	const { at, text, user } = parsePrefixes(trimmed);
	const msg: IncomingMessage = {
		chatId: DEV_CHAT_ID,
		userId: DEV_USER_ID,
		userName: user,
		text,
		messageId: ++msgSeq,
		at,
	};
	await handleMessage(msg)(env);
};

console.log(
	'poppata-bot dev:local — scrivi messaggi (es. "inizio poppata dx 9.15"), /comandi, o conf/ann/sx/dx. Ctrl+D per uscire.',
);

const rl = createInterface({ input: process.stdin });
let chain: Promise<void> = Promise.resolve();
rl.on("line", (line) => {
	chain = chain.then(() => handleLine(line));
});
rl.on("close", () => {
	void chain.then(() => process.exit(0));
});
