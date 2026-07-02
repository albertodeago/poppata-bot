import type { ConfigEnv } from "../../config.js";
import type { LoggerEnv } from "../../domain/logger.js";
import type { GeminiParse, ParserEnv } from "../../domain/parse.js";
import { success } from "../../domain/result.js";

const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		type: { type: "string", enum: ["eat", "sleep", "pee", "poop", "other"] },
		action: { type: "string", enum: ["start", "end", "instant"] },
		side: { type: "string", enum: ["dx", "sx", "none"] },
		hour: { type: "integer" },
		minute: { type: "integer" },
		confidence: { type: "number" },
	},
	required: ["type", "action", "confidence"],
};

const PROMPT = [
	"Sei un parser per un bot che traccia le attività di un neonato.",
	"Classifica il messaggio in un'attività: eat (poppata), sleep (nanna), pee (pipì), poop (cacca).",
	"action: start (inizio), end (fine); pee e poop sono sempre instant.",
	'side: dx o sx solo per eat, altrimenti "none".',
	"Se il messaggio indica un orario, imposta hour (0-23) e minute (0-59); altrimenti hour = -1.",
	"confidence: da 0 a 1.",
	'Se il messaggio NON riguarda nessuna di queste attività, type = "other".',
	"Messaggio:",
].join("\n");

interface RawGemini {
	type: string;
	action: string;
	side?: string;
	hour?: number;
	minute?: number;
	confidence: number;
}

/** Outcome of a single attempt: a definitive result, or a transient failure to retry. */
type Attempt = { retry: false; result: GeminiParse | null } | { retry: true };

export interface GeminiRetryOptions {
	/** Number of retries after the first attempt (default 2 → up to 3 tries). */
	retries?: number;
	/** Base backoff between retries in ms; the nth retry waits base×n (default 400). */
	delayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const makeGeminiParser = (
	env: ConfigEnv & LoggerEnv,
	opts: GeminiRetryOptions = {},
): ParserEnv["parser"] => {
	const retries = opts.retries ?? 2;
	const delayMs = opts.delayMs ?? 400;

	const attempt = async (text: string): Promise<Attempt> => {
		let res: Response;
		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.config.geminiModel}:generateContent`;
			res = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-goog-api-key": env.config.geminiApiKey,
				},
				body: JSON.stringify({
					contents: [{ role: "user", parts: [{ text: `${PROMPT}\n${text}` }] }],
					generationConfig: {
						responseMimeType: "application/json",
						responseSchema: RESPONSE_SCHEMA,
					},
				}),
			});
		} catch (e) {
			env.logger.warn("Gemini fetch failed, will retry", e);
			return { retry: true };
		}

		if (!res.ok) {
			// 429 (rate limit) and 5xx are transient → retry; other 4xx won't improve.
			if (res.status === 429 || res.status >= 500) {
				env.logger.warn(`Gemini HTTP ${res.status}, will retry`);
				return { retry: true };
			}
			env.logger.error(`Gemini HTTP ${res.status}`);
			return { retry: false, result: null };
		}

		try {
			const data = await res.json();
			const raw: string | undefined =
				data?.candidates?.[0]?.content?.parts?.[0]?.text;
			if (!raw) return { retry: false, result: null };

			const parsed = JSON.parse(raw) as RawGemini;
			if (parsed.type === "other") return { retry: false, result: null };

			const result: GeminiParse = {
				type: parsed.type as GeminiParse["type"],
				action: parsed.action as GeminiParse["action"],
				confidence: parsed.confidence,
			};
			if (parsed.side && parsed.side !== "none") {
				result.side = parsed.side as Exclude<GeminiParse["side"], undefined>;
			}
			if (typeof parsed.hour === "number" && parsed.hour >= 0) {
				result.hour = parsed.hour;
				result.minute = typeof parsed.minute === "number" ? parsed.minute : 0;
			}
			return { retry: false, result };
		} catch (e) {
			env.logger.error("Gemini response parse failed", e);
			return { retry: false, result: null };
		}
	};

	return {
		parse: async (text) => {
			for (let i = 0; i <= retries; i++) {
				const outcome = await attempt(text);
				if (!outcome.retry) return success(outcome.result);
				if (i < retries) await sleep(delayMs * (i + 1));
			}
			env.logger.error(`Gemini failed after ${retries + 1} attempts`);
			return success(null);
		},
	};
};
