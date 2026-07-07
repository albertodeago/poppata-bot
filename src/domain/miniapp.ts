import { createHmac, timingSafeEqual } from "node:crypto";
import { error, type Result, success } from "./result.js";

export interface ValidatedInitData {
	userId: number;
	startParam?: string;
	authDate: number;
}

/**
 * Validate a Telegram Mini App `initData` string:
 *   secret = HMAC_SHA256("WebAppData", botToken)
 *   check  = sorted "k=v" of every field except `hash`/`signature`, joined by "\n"
 *   valid iff hex(HMAC_SHA256(check, secret)) === hash  AND  auth_date is fresh.
 * `hash` (bot-token HMAC) and `signature` (third-party Ed25519) are both excluded
 * from the check string; only `hash` is verified here.
 */
export const validateInitData = (
	raw: string,
	botToken: string,
	maxAgeSec: number,
	now: Date,
): Result<ValidatedInitData> => {
	const params = new URLSearchParams(raw);
	const hash = params.get("hash");
	if (!hash) return error(new Error("initData: missing hash"));
	params.delete("hash");
	params.delete("signature");

	const dataCheck = [...params.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");

	const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
	const computed = createHmac("sha256", secret).update(dataCheck).digest("hex");

	const a = Buffer.from(computed, "hex");
	const b = Buffer.from(hash, "hex");
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return error(new Error("initData: bad hash"));
	}

	const authDate = Number(params.get("auth_date"));
	if (!Number.isFinite(authDate))
		return error(new Error("initData: bad auth_date"));
	if (now.getTime() / 1000 - authDate > maxAgeSec) {
		return error(new Error("initData: stale"));
	}

	const userRaw = params.get("user");
	if (!userRaw) return error(new Error("initData: missing user"));
	let userId: number;
	try {
		userId = Number((JSON.parse(userRaw) as { id: unknown }).id);
	} catch {
		return error(new Error("initData: bad user"));
	}
	if (!Number.isFinite(userId))
		return error(new Error("initData: bad user id"));

	const startParam = params.get("start_param") ?? undefined;
	return success({ userId, authDate, ...(startParam ? { startParam } : {}) });
};

export type AuthzKind = "self" | "needs-membership";

/** A private chat's id equals the user's id — the viewer IS the chat, so no
 *  membership lookup is needed. Any other (group/supergroup) id must be checked. */
export const authorizeDecision = (p: {
	chatId: number;
	userId: number;
}): AuthzKind => (p.chatId === p.userId ? "self" : "needs-membership");
