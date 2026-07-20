import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorizeDecision, validateInitData } from "../src/domain/miniapp.js";
import { buildStatsPayload } from "../src/domain/stats.js";
import { bucketWindows } from "../src/domain/time.js";
import { type Env, makeEnv } from "../src/env.js";

let env: Env;
let initialized = false;

const ACTIVE = new Set(["creator", "administrator", "member", "restricted"]);
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	if (req.method !== "GET") {
		return res.status(405).json({ error: "Method not allowed" });
	}
	const rawHeader = req.headers["x-telegram-init-data"];
	const initData = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
	if (!initData) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	if (!initialized) {
		env = makeEnv();
		initialized = true;
	}

	const valid = validateInitData(
		initData,
		env.config.botToken,
		INIT_DATA_MAX_AGE_SEC,
		new Date(),
	);
	if (!valid.success) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	const { userId, startParam } = valid.data;

	const chatId = Number(startParam);
	if (!Number.isFinite(chatId)) {
		return res.status(400).json({ error: "Bad chat" });
	}

	try {
		if (authorizeDecision({ chatId, userId }) !== "self") {
			let status: string;
			try {
				const member = await env.telegrafBot.telegram.getChatMember(
					chatId,
					userId,
				);
				status = member.status;
			} catch {
				// getChatMember throws for a non-participant — treat as forbidden.
				return res.status(403).json({ error: "Forbidden" });
			}
			if (!ACTIVE.has(status)) {
				return res.status(403).json({ error: "Forbidden" });
			}
		}

		const now = new Date();
		const monthStart = bucketWindows(now, "month")[0]?.start ?? now;
		const [eventsRes, weightsRes, cfgRes] = await Promise.all([
			env.eventRepository.listSince(chatId, monthStart, now),
			env.weightRepository.list(chatId),
			env.chatConfigRepository.get(chatId),
		]);
		if (!eventsRes.success) throw eventsRes.error;
		if (!weightsRes.success) throw weightsRes.error;
		const babyName =
			cfgRes.success && cfgRes.data?.babyName
				? cfgRes.data.babyName
				: undefined;
		const language = cfgRes.success ? (cfgRes.data?.language ?? "it") : "it";

		const payload = buildStatsPayload({
			events: eventsRes.data,
			weights: weightsRes.data,
			language,
			now,
			...(babyName ? { babyName } : {}),
		});
		return res.status(200).json(payload);
	} catch (error) {
		console.error("Stats error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
