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
		// TEMP DEBUG — remove after diagnosing the 401
		console.error(
			"[stats-debug] missing x-telegram-init-data header; header keys=",
			Object.keys(req.headers).join(","),
		);
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
		// TEMP DEBUG v2 — remove after diagnosing. Prints the real bot (from the
		// token) vs the configured MINIAPP_URL, and whether a trimmed token would
		// match (token-whitespace check). No secret is logged.
		try {
			const { createHmac } = await import("node:crypto");
			const p = new URLSearchParams(initData);
			const provided = p.get("hash") ?? "";
			p.delete("hash");
			p.delete("signature");
			const dcs = [...p.entries()]
				.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
				.map(([k, v]) => `${k}=${v}`)
				.join("\n");
			const tok = env.config.botToken;
			const h = (t: string) =>
				createHmac(
					"sha256",
					createHmac("sha256", "WebAppData").update(t).digest(),
				)
					.update(dcs)
					.digest("hex");
			let botUsername = "?";
			try {
				botUsername = (await env.telegrafBot.telegram.getMe()).username ?? "?";
			} catch {}
			console.error(
				"[stats-debug2] rawMatch=",
				h(tok) === provided,
				"| trimMatch=",
				h(tok.trim()) === provided,
				"| tokenHasWhitespace=",
				tok !== tok.trim(),
				"| realBotUsername=",
				botUsername,
				"| miniAppUrl=",
				env.config.miniAppUrl,
			);
		} catch (e) {
			console.error("[stats-debug2] error", e);
		}
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

		const payload = buildStatsPayload({
			events: eventsRes.data,
			weights: weightsRes.data,
			now,
			...(babyName ? { babyName } : {}),
		});
		return res.status(200).json(payload);
	} catch (error) {
		console.error("Stats error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
