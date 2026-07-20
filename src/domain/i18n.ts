import type { ChatConfigEnv, ChatLanguage } from "./chatConfig.js";
import type { EventType, Side } from "./event.js";
import type { LoggerEnv } from "./logger.js";

export const DEFAULT_LANGUAGE: ChatLanguage = "it";

export const normalizeLanguageCode = (code?: string): ChatLanguage => {
	const normalized = code?.trim().toLowerCase() ?? "";
	if (normalized.startsWith("en")) return "en";
	return DEFAULT_LANGUAGE;
};

export const parseLanguageArg = (arg: string): ChatLanguage | null => {
	const normalized = arg.trim().toLowerCase();
	if (["it", "ita", "italiano", "italian"].includes(normalized)) return "it";
	if (["en", "eng", "inglese", "english"].includes(normalized)) return "en";
	return null;
};

export const chatLanguage = async (
	env: ChatConfigEnv & LoggerEnv,
	chatId: number,
): Promise<ChatLanguage> => {
	const res = await env.chatConfigRepository.get(chatId);
	if (!res.success) {
		env.logger.error("chatLanguage: get failed", res.error);
		return DEFAULT_LANGUAGE;
	}
	return res.data?.language ?? DEFAULT_LANGUAGE;
};

export const eventLabel = (type: EventType, language: ChatLanguage): string =>
	({
		it: {
			eat: "poppata",
			sleep: "nanna",
			pee: "pipì",
			poop: "cacca",
			bottle: "biberon",
		},
		en: {
			eat: "feed",
			sleep: "sleep",
			pee: "pee",
			poop: "poop",
			bottle: "bottle",
		},
	})[language][type];

export const sideLabel = (side: Side, language: ChatLanguage): string =>
	({
		it: { dx: "destro", sx: "sinistro" },
		en: { dx: "right", sx: "left" },
	})[language][side];

export const languageName = (language: ChatLanguage): string =>
	language === "it" ? "Italiano" : "English";

export const internalError = (language: ChatLanguage): string =>
	language === "it" ? "Errore interno, riprova." : "Internal error, try again.";

export const languageUsage = (language: ChatLanguage): string =>
	language === "it"
		? "Usa /lingua it oppure /lingua en."
		: "Use /language en or /language it.";

export const languageState = (language: ChatLanguage): string =>
	language === "it"
		? `🌐 Lingua attuale: ${languageName(language)}. ${languageUsage(language)}`
		: `🌐 Current language: ${languageName(language)}. ${languageUsage(language)}`;

export const languageSet = (language: ChatLanguage): string =>
	language === "it"
		? "🌐 Lingua impostata: Italiano."
		: "🌐 Language set to English.";
