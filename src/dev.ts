import { createInterface } from "node:readline";
import { makeConsoleBot } from "./adapters/console/bot.js";
import { makeLogger } from "./adapters/console/logger.js";
import { makeMemoryChatConfigRepository } from "./adapters/memory/chatConfig.js";
import { makeMemoryEventRepository } from "./adapters/memory/event.js";
import { makeMemoryPendingRepository } from "./adapters/memory/pending.js";
import { makeMemoryWeightRepository } from "./adapters/memory/weight.js";
import { makeNoopParser } from "./adapters/noop/parser.js";
import {
	type BotEnv,
	handleCallback,
	handleMessage,
	type IncomingMessage,
} from "./domain/bot.js";
import type { ChatConfigEnv } from "./domain/chatConfig.js";
import {
	annullaCommand,
	graficiCommand,
	guidaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	pesoCommand,
	scalettaCommand,
	sendDailyReport,
	sendWeeklyReport,
	senoCommand,
	settimanaCommand,
	statoCommand,
} from "./domain/commands.js";
import type { EventEnv } from "./domain/event.js";
import type { LoggerEnv } from "./domain/logger.js";
import type { ParserEnv } from "./domain/parse.js";
import type { PendingEnv } from "./domain/pending.js";
import { nomeCommand, registerChat } from "./domain/registration.js";
import type { WeightEnv } from "./domain/weight.js";

const DEV_CHAT_ID = 1;
const DEV_USER_ID = 1;
const DEV_MAX_CHATS = 5;
const DEV_REPO_ISSUES_URL =
	"https://github.com/albertodeago/poppata-bot/issues";
const DEV_MINIAPP_URL = "https://t.me/Bot/app";
const DEV_GUIDE_URL = "http://localhost:3000/guida.html";

const logger = makeLogger();
const { botEnv, state } = makeConsoleBot({ logger });
const env: BotEnv &
	EventEnv &
	PendingEnv &
	ParserEnv &
	WeightEnv &
	ChatConfigEnv &
	LoggerEnv = {
	logger,
	eventRepository: makeMemoryEventRepository({ logger }),
	weightRepository: makeMemoryWeightRepository({ logger }),
	pendingRepository: makeMemoryPendingRepository({ logger }),
	chatConfigRepository: makeMemoryChatConfigRepository({ logger }),
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
		case "/scaletta":
			await scalettaCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/annulla":
			await annullaCommand(DEV_CHAT_ID)(env);
			return true;
		case "/seno":
			await senoCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/help":
			await helpCommand(DEV_CHAT_ID)(env);
			return true;
		case "/report":
			await sendDailyReport(DEV_CHAT_ID, now)(env);
			return true;
		case "/report-week":
			await sendWeeklyReport(DEV_CHAT_ID, now)(env);
			return true;
		case "/grafici":
			await graficiCommand(DEV_CHAT_ID, DEV_MINIAPP_URL)(env);
			return true;
		case "/guida":
			await guidaCommand(DEV_CHAT_ID, DEV_GUIDE_URL)(env);
			return true;
		default:
			return false;
	}
};

const handleLine = async (line: string): Promise<void> => {
	const trimmed = line.trim();
	if (!trimmed) return;

	if (["conf", "ann", "dx", "sx", "eat", "sleep"].includes(trimmed)) {
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
			at: new Date(),
		})(env);
		// A callback may open a NEW prompt (e.g. conf → side prompt), which the
		// console adapter records in state.lastPendingId. Only clear when unchanged.
		if (state.lastPendingId === pendingId) state.lastPendingId = undefined;
		return;
	}

	if (trimmed === "/peso" || trimmed.startsWith("/peso ")) {
		const arg = trimmed.slice("/peso".length).trim();
		await pesoCommand(DEV_CHAT_ID, DEV_USER_ID, "papà", arg, new Date())(env);
		return;
	}

	if (trimmed === "/start" || trimmed.startsWith("/start ")) {
		const name = trimmed.slice("/start".length).trim();
		await registerChat({
			chatId: DEV_CHAT_ID,
			userName: "papà",
			...(name ? { name } : {}),
			maxChats: DEV_MAX_CHATS,
			repoIssuesUrl: DEV_REPO_ISSUES_URL,
			guideUrl: DEV_GUIDE_URL,
		})(env);
		return;
	}

	if (trimmed === "/nome" || trimmed.startsWith("/nome ")) {
		const arg = trimmed.slice("/nome".length).trim();
		await nomeCommand(DEV_CHAT_ID, arg)(env);
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
	'poppata-bot dev:local — scrivi messaggi (es. "inizio poppata dx 9.15"), /comandi, o conf/ann/sx/dx/eat/sleep. Ctrl+D per uscire.',
);

const rl = createInterface({ input: process.stdin });
let chain: Promise<void> = Promise.resolve();
rl.on("line", (line) => {
	chain = chain.then(() => handleLine(line));
});
rl.on("close", () => {
	void chain.then(() => process.exit(0));
});
