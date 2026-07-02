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

export const makeGeminiParser = (
	env: ConfigEnv & LoggerEnv,
): ParserEnv["parser"] => ({
	parse: async (text) => {
		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.config.geminiModel}:generateContent`;
			const res = await fetch(url, {
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
			if (!res.ok) {
				env.logger.error(`Gemini HTTP ${res.status}`);
				return success(null);
			}
			const data = await res.json();
			const raw: string | undefined =
				data?.candidates?.[0]?.content?.parts?.[0]?.text;
			if (!raw) return success(null);

			const parsed = JSON.parse(raw) as RawGemini;
			if (parsed.type === "other") return success(null);

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
			return success(result);
		} catch (e) {
			env.logger.error("Gemini parse failed", e);
			return success(null);
		}
	},
});
