import { type BabyEvent, LABEL } from "./event";
import type { Intent } from "./parse";
import { formatDuration, hhmm } from "./time";

export type Decision =
	| { kind: "save"; intent: Intent }
	| { kind: "confirm"; intent: Intent; warning: string }
	| { kind: "error"; message: string };

const FEED_MAX_MS = 90 * 60_000;
const SLEEP_MAX_MS = 12 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export const decide = (intent: Intent, open: BabyEvent | null): Decision => {
	if (intent.action === "instant") return { kind: "save", intent };

	if (intent.action === "start") {
		if (open) {
			return {
				kind: "confirm",
				intent,
				warning: `C'è già una ${LABEL[open.type]} aperta dalle ${hhmm(
					open.startedAt,
				)}. Chiuderla alle ${hhmm(intent.at)} e iniziare ${LABEL[intent.type]}?`,
			};
		}
		return { kind: "save", intent };
	}

	// action === "end"
	if (!open)
		return { kind: "error", message: "Nessuna sessione aperta da chiudere." };

	let endedAt = intent.at;
	if (endedAt.getTime() < open.startedAt.getTime()) {
		endedAt = new Date(endedAt.getTime() + DAY_MS);
	}
	const durationMs = endedAt.getTime() - open.startedAt.getTime();
	const adjusted: Intent = { ...intent, type: open.type, at: endedAt };
	const max = open.type === "sleep" ? SLEEP_MAX_MS : FEED_MAX_MS;
	if (durationMs > max) {
		return {
			kind: "confirm",
			intent: adjusted,
			warning: `Durata ${LABEL[open.type]} sospetta: ${formatDuration(
				durationMs,
			)}. Salvare comunque?`,
		};
	}
	return { kind: "save", intent: adjusted };
};
