import type { ChatLanguage } from "./chatConfig.js";
import type { Result } from "./result.js";

export interface WeightReading {
	id: string;
	chatId: number;
	/** Rome-local calendar day, yyyy-MM-dd. */
	day: string;
	grams: number;
	userId: number;
	userName: string;
	createdAt: Date;
}

/** Fields needed to persist a reading; id/createdAt are assigned by the repo. */
export type NewWeightReading = Omit<WeightReading, "id" | "createdAt">;

export interface WeightRepository {
	/** Insert today's reading, or overwrite it if the day already has one. */
	upsert(
		reading: NewWeightReading,
	): Promise<Result<{ reading: WeightReading; overwritten: boolean }>>;
	/** All readings for a chat, chronological (oldest first). */
	list(chatId: number): Promise<Result<WeightReading[]>>;
}

export interface WeightEnv {
	weightRepository: WeightRepository;
}

export const MIN_GRAMS = 500;
export const MAX_GRAMS = 30000;

/** Parse the command argument to whole grams, or null if not a plausible value. */
export const parseGrams = (arg: string): number | null => {
	const t = arg.trim();
	if (!/^\d+$/.test(t)) return null;
	const g = Number(t);
	if (g < MIN_GRAMS || g > MAX_GRAMS) return null;
	return g;
};

const EMPTY_HISTORY =
	"Nessun peso registrato. Scrivi /peso 3400 per registrarne uno.";
const EMPTY_HISTORY_EN =
	"No weight recorded yet. Write /weight 3400 to record one.";

// Italian short month names, indexed by month-1. Explicit (not locale-derived)
// so the copy is deterministic regardless of the runtime ICU build.
const MESI = [
	"gen",
	"feb",
	"mar",
	"apr",
	"mag",
	"giu",
	"lug",
	"ago",
	"set",
	"ott",
	"nov",
	"dic",
];

const MONTHS_EN = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

// "2026-07-01" -> "1 lug"
const dayLabel = (day: string, language: ChatLanguage): string => {
	const [, m, d] = day.split("-");
	const months = language === "it" ? MESI : MONTHS_EN;
	return `${Number(d)} ${months[Number(m) - 1]}`;
};

/** The ⚖️ history block with per-reading deltas, or the empty-state line. */
export const formatHistory = (
	readings: WeightReading[],
	language: ChatLanguage = "it",
): string => {
	if (readings.length === 0)
		return language === "it" ? EMPTY_HISTORY : EMPTY_HISTORY_EN;
	const lines = [language === "it" ? "⚖️ Peso" : "⚖️ Weight"];
	let prev: number | undefined;
	for (const r of readings) {
		let line = `${dayLabel(r.day, language)}  ${r.grams} g`;
		if (prev !== undefined) {
			const delta = r.grams - prev;
			line += `  (${delta >= 0 ? "+" : "-"}${Math.abs(delta)})`;
		}
		lines.push(line);
		prev = r.grams;
	}
	return lines.join("\n");
};
