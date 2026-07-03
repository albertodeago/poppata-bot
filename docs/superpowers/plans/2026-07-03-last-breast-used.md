# "Last Breast Used" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a caregiver see the last breast used — as a hint in the `Per quale seno?` side prompt, and on demand via a `/seno` command and free-text keywords (`che seno?`, etc.).

**Architecture:** Add one non-destructive repo read (`findLastFeed`) and a small shared domain module (`lastFeed.ts`: query regex, formatters, responder). The side prompt, the command, and the keyword all consume it. Recency is measured from the feed's end; an open feed reads as "in corso".

**Tech Stack:** TypeScript ESM (Node ≥ 24), telegraf, Vitest, Biome (tab indentation, double quotes).

## Global Constraints

- Storage stays canonical (`Side = "dx" | "sx"`); no DB migration; `report.ts` untouched.
- `findLastFeed` = the most recent `eat` event **with a side** (open or closed), per `chatId`, ordered by `started_at DESC`.
- Recency counts from `endedAt`; an open feed (no `endedAt`) is reported as "in corso" (no "fa").
- Copy is EXACT:
  - Closed: `Ultima poppata: seno destro — finita alle 15:00 (2h fa)`
  - Open: `Poppata in corso: seno destro — iniziata alle 14:30`
  - None: `Non ho ancora registrato una poppata con un seno.`
  - Prompt hint (appended to `Per quale seno? 🤱`): ` (ultima: destro, 2h fa)` / ` (ultima: destro, in corso)` / `` (none).
- `destro`/`sinistro` come from the existing `SIDE_LABEL`; times from `hhmm` (`H:mm`); durations from `formatDuration` (`2h` / `2h 5m` / `5m`).
- Keyword regex on already-normalized text: `/\b(che|quale|qual|ultimo|ultima)\s+(seno|tetta)\b/` — must NOT match feed logging (`poppata seno destro`).
- Command name: `/seno`, menu description `Ultimo seno usato`.
- Biome: tabs, double quotes. Run `npm run lint:apply` if formatting drifts.

---

### Task 1: `findLastFeed` repository read

**Files:**
- Modify: `src/domain/event.ts` (`EventRepository` interface, after `findOpenSession` ~line 30)
- Modify: `src/adapters/pg/event.ts` (add method after `findOpenSession` ~line 88)
- Modify: `src/adapters/memory/event.ts` (add method after `findOpenSession` ~line 32)
- Modify: `test/unit/testEnv.ts` (bot/event mock ~line 12)
- Test: `test/unit/adapters/pg/event.test.ts`, `test/unit/adapters/memory/event.test.ts`

**Interfaces:**
- Produces: `EventRepository.findLastFeed(chatId: number): Promise<Result<BabyEvent | null>>` — most recent `eat` with a side, or null.

- [ ] **Step 1: Add the pg failing tests**

In `test/unit/adapters/pg/event.test.ts`, add inside `describe("[PG event repo]", ...)` (after the `listSince` test, ~line 100):

```ts
	it("findLastFeed queries the latest eat-with-side and maps the row", async () => {
		const db = { query: vi.fn().mockResolvedValue([row({ side: "sx" })]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data?.side).toBe("sx");
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("type = 'eat'");
		expect(sql).toContain("side IS NOT NULL");
		expect(sql).toContain("ORDER BY started_at DESC");
		expect(params).toEqual([1]);
	});

	it("findLastFeed returns null when no rows", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});
```

- [ ] **Step 2: Add the memory failing tests**

In `test/unit/adapters/memory/event.test.ts`, add inside `describe("[MEMORY event repo]", ...)` (after the `listSince` test, ~line 95):

```ts
	it("findLastFeed returns the most recent eat WITH a side", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(
			newEvent({ side: "sx", startedAt: new Date("2026-07-02T08:00:00Z") }),
		);
		await repo.insert(
			newEvent({ type: "sleep", startedAt: new Date("2026-07-02T09:00:00Z") }),
		);
		await repo.insert(
			newEvent({ side: "dx", startedAt: new Date("2026-07-02T10:00:00Z") }),
		);
		// eat without a side (legacy) must be skipped
		await repo.insert(
			newEvent({ startedAt: new Date("2026-07-02T11:00:00Z") }),
		);
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data?.side).toBe("dx");
			expect(r.data?.startedAt).toEqual(new Date("2026-07-02T10:00:00Z"));
		}
	});

	it("findLastFeed returns null when no eat with a side exists", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(newEvent({ type: "pee", startedAt: new Date() }));
		const r = await repo.findLastFeed(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run test/unit/adapters/pg/event.test.ts test/unit/adapters/memory/event.test.ts`
Expected: FAIL — `findLastFeed` is not a function / type error.

- [ ] **Step 4: Add the method to the `EventRepository` interface**

In `src/domain/event.ts`, add inside `EventRepository`, right after the `findOpenSession` line (line 30):

```ts
	/** The most recent eat event with a side (open or closed), or null. */
	findLastFeed(chatId: number): Promise<Result<BabyEvent | null>>;
```

- [ ] **Step 5: Implement in the pg adapter**

In `src/adapters/pg/event.ts`, add after the `findOpenSession` block (after line 88):

```ts
	findLastFeed: (chatId) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT * FROM events
				 WHERE chat_id = $1 AND type = 'eat' AND side IS NOT NULL
				 ORDER BY started_at DESC LIMIT 1`,
					[chatId],
				);
				return rows[0] ? mapRow(rows[0]) : null;
			},
			(e) => e,
		),
```

- [ ] **Step 6: Implement in the memory adapter**

In `src/adapters/memory/event.ts`, add after the `findOpenSession` block (after line 32):

```ts
		findLastFeed: async (chatId: number) => {
			let last: BabyEvent | null = null;
			for (const e of events) {
				if (e.chatId === chatId && e.type === "eat" && e.side !== undefined) {
					if (!last || e.startedAt.getTime() > last.startedAt.getTime()) {
						last = e;
					}
				}
			}
			return R.success(last);
		},
```

- [ ] **Step 7: Add the mock to `testEnv`**

In `test/unit/testEnv.ts`, add to `mocks.eventRepository` after the `findOpenSession` line (line 12):

```ts
			findLastFeed: vi.fn<EventEnv["eventRepository"]["findLastFeed"]>(),
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (new repo tests pass; nothing else breaks — no caller uses `findLastFeed` yet).

- [ ] **Step 9: Commit**

```bash
git add src/domain/event.ts src/adapters/pg/event.ts src/adapters/memory/event.ts test/unit/testEnv.ts test/unit/adapters/pg/event.test.ts test/unit/adapters/memory/event.test.ts
git commit -m "feat: add findLastFeed repository read (latest eat with a side)"
```

---

### Task 2: `lastFeed.ts` shared module (regex + formatters + responder)

**Files:**
- Create: `src/domain/lastFeed.ts`
- Test: `test/unit/domain/lastFeed.test.ts`

**Interfaces:**
- Consumes: `EventRepository.findLastFeed` (Task 1); `SIDE_LABEL` from `event.js`; `hhmm`, `formatDuration` from `time.js`.
- Produces:
  - `LAST_FEED_QUERY: RegExp`
  - `lastFeedHint(feed: BabyEvent | null, now: Date): string`
  - `formatLastFeed(feed: BabyEvent | null, now: Date): string`
  - `answerLastFeed(chatId: number, now: Date): (env: EventEnv & BotEnv & LoggerEnv) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/domain/lastFeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event.js";
import {
	LAST_FEED_QUERY,
	answerLastFeed,
	formatLastFeed,
	lastFeedHint,
} from "../../../src/domain/lastFeed.js";
import { success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

const feed = (over: Partial<BabyEvent>): BabyEvent => ({
	id: "e1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	side: "dx",
	startedAt: new Date("2026-07-02T12:30:00Z"), // 14:30 Rome
	source: "rules",
	rawText: "poppata dx",
	messageId: 1,
	createdAt: new Date("2026-07-02T12:30:00Z"),
	...over,
});

const now = new Date("2026-07-02T15:00:00Z"); // 17:00 Rome

describe("[LASTFEED] LAST_FEED_QUERY", () => {
	it("matches breast queries", () => {
		for (const s of ["che seno?", "quale seno", "ultimo seno", "che tetta"]) {
			expect(LAST_FEED_QUERY.test(s)).toBe(true);
		}
	});
	it("does not match feed logging", () => {
		for (const s of ["poppata seno destro", "inizio poppata", "seno destro"]) {
			expect(LAST_FEED_QUERY.test(s)).toBe(false);
		}
	});
});

describe("[LASTFEED] formatLastFeed", () => {
	it("closed feed → finished-at + ago", () => {
		const f = feed({ endedAt: new Date("2026-07-02T13:00:00Z") }); // 15:00 Rome, 2h ago
		expect(formatLastFeed(f, now)).toBe(
			"Ultima poppata: seno destro — finita alle 15:00 (2h fa)",
		);
	});
	it("open feed → in corso", () => {
		expect(formatLastFeed(feed({ side: "sx" }), now)).toBe(
			"Poppata in corso: seno sinistro — iniziata alle 14:30",
		);
	});
	it("no feed → none message", () => {
		expect(formatLastFeed(null, now)).toBe(
			"Non ho ancora registrato una poppata con un seno.",
		);
	});
});

describe("[LASTFEED] lastFeedHint", () => {
	it("closed feed → compact ago suffix", () => {
		const f = feed({ endedAt: new Date("2026-07-02T13:00:00Z") });
		expect(lastFeedHint(f, now)).toBe(" (ultima: destro, 2h fa)");
	});
	it("open feed → in corso suffix", () => {
		expect(lastFeedHint(feed({}), now)).toBe(" (ultima: destro, in corso)");
	});
	it("no feed → empty string", () => {
		expect(lastFeedHint(null, now)).toBe("");
	});
});

describe("[LASTFEED] answerLastFeed", () => {
	it("sends the formatted last feed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success(feed({ endedAt: new Date("2026-07-02T13:00:00Z") })),
		);
		await answerLastFeed(1, now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Ultima poppata: seno destro — finita alle 15:00 (2h fa)",
		);
	});
	it("sends an internal-error message when the read fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue({
			success: false,
			error: new Error("db down"),
		});
		await answerLastFeed(1, now)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Errore interno");
		expect(mocks.logger.error).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/lastFeed.test.ts`
Expected: FAIL — cannot import from `lastFeed.js` (module does not exist).

- [ ] **Step 3: Create the module**

Create `src/domain/lastFeed.ts`:

```ts
import type { BotEnv } from "./bot.js";
import { type BabyEvent, type EventEnv, SIDE_LABEL } from "./event.js";
import type { LoggerEnv } from "./logger.js";
import { formatDuration, hhmm } from "./time.js";

const INTERNAL_ERROR = "Errore interno, riprova.";
const NO_FEED = "Non ho ancora registrato una poppata con un seno.";

/** Matches a query word immediately before seno/tetta on normalized text. */
export const LAST_FEED_QUERY = /\b(che|quale|qual|ultimo|ultima)\s+(seno|tetta)\b/;

/** Compact suffix for the side prompt. Empty when there's no prior feed. */
export const lastFeedHint = (feed: BabyEvent | null, now: Date): string => {
	if (!feed?.side) return "";
	const side = SIDE_LABEL[feed.side];
	if (feed.endedAt) {
		const ago = formatDuration(now.getTime() - feed.endedAt.getTime());
		return ` (ultima: ${side}, ${ago} fa)`;
	}
	return ` (ultima: ${side}, in corso)`;
};

/** One-line answer for the /seno command and the keyword. */
export const formatLastFeed = (feed: BabyEvent | null, now: Date): string => {
	if (!feed?.side) return NO_FEED;
	const side = SIDE_LABEL[feed.side];
	if (feed.endedAt) {
		const ago = formatDuration(now.getTime() - feed.endedAt.getTime());
		return `Ultima poppata: seno ${side} — finita alle ${hhmm(feed.endedAt)} (${ago} fa)`;
	}
	return `Poppata in corso: seno ${side} — iniziata alle ${hhmm(feed.startedAt)}`;
};

/** Fetch the last feed and send the formatted answer. */
export const answerLastFeed =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const res = await env.eventRepository.findLastFeed(chatId);
		if (!res.success) {
			env.logger.error("findLastFeed failed", res.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(chatId, formatLastFeed(res.data, now));
	};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/lastFeed.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/lastFeed.ts test/unit/domain/lastFeed.test.ts
git commit -m "feat: add lastFeed module (query regex, formatters, responder)"
```

---

### Task 3: `/seno` command wiring

**Files:**
- Modify: `src/domain/commands.ts` (add `senoCommand` re-export; extend `HELP_TEXT` ~line 36)
- Modify: `api/setup.ts` (`COMMANDS` array ~line 9)
- Modify: `api/webhook.ts` (import ~line 8-16; `bot.command` block ~line 50)
- Modify: `src/dev.ts` (`runCommand` switch ~line 83)
- Test: `test/unit/domain/commands.test.ts`

**Interfaces:**
- Consumes: `answerLastFeed` (Task 2).
- Produces: `senoCommand = answerLastFeed` exported from `commands.js`; `/seno` registered in webhook + dev + command menu.

- [ ] **Step 1: Add failing command tests**

In `test/unit/domain/commands.test.ts`, add a new `describe` block (place it after the existing imports/blocks — reuse the file's existing test imports; it already imports from `commands.js` and `../testEnv.js`). If `senoCommand`, `success`, or `makeTestEnv` are not yet imported in this file, add them to the existing imports:

```ts
import { HELP_TEXT, senoCommand } from "../../../src/domain/commands.js";
import { success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

describe("[COMMANDS] /seno", () => {
	it("HELP_TEXT lists the /seno command", () => {
		expect(HELP_TEXT).toContain("/seno");
	});

	it("replies with the last feed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "eat",
				side: "dx",
				startedAt: new Date("2026-07-02T12:00:00Z"),
				endedAt: new Date("2026-07-02T13:00:00Z"),
				source: "rules",
				rawText: "poppata dx",
				messageId: 1,
				createdAt: new Date("2026-07-02T13:00:00Z"),
			}),
		);
		await senoCommand(1, new Date("2026-07-02T15:00:00Z"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Ultima poppata: seno destro");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: FAIL — `senoCommand` is not exported / `HELP_TEXT` lacks `/seno`.

- [ ] **Step 3: Export `senoCommand` and extend `HELP_TEXT`**

In `src/domain/commands.ts`, add to the imports near the top (after the existing import block, ~line 19):

```ts
import { answerLastFeed } from "./lastFeed.js";
```

Add the re-export (e.g. right after `HELP_TEXT`, ~line 39):

```ts
export const senoCommand = answerLastFeed;
```

In `HELP_TEXT`, add a line after the `/settimana` entry (line 35):

```ts
	'/seno — ultimo seno usato (o scrivi "che seno?")',
```

- [ ] **Step 4: Register `/seno` in the webhook**

In `api/webhook.ts`, add `senoCommand` to the `commands.js` import block (lines 8-16, keep alphabetical-ish — add after `oggiCommand`):

```ts
	senoCommand,
```

Add a command handler after the `annulla` block (~line 52):

```ts
	bot.command("seno", async (ctx) => {
		await senoCommand(ctx.chat.id, new Date())(env);
	});
```

- [ ] **Step 5: Add `/seno` to the command menu list**

In `api/setup.ts`, add to the `COMMANDS` array after the `annulla` entry (line 9):

```ts
	{ command: "seno", description: "Ultimo seno usato" },
```

- [ ] **Step 6: Wire `/seno` into the dev harness**

In `src/dev.ts`, add `senoCommand` to the `commands.js` import block, then add a case to `runCommand` after the `/annulla` case (~line 85):

```ts
		case "/seno":
			await senoCommand(DEV_CHAT_ID, now)(env);
			return true;
```

- [ ] **Step 7: Manual dev check**

Run:

```bash
printf 'poppata dx\ndx\n/seno\n' | npm run dev:local
```

Expected: after starting a feed and picking `dx`, `/seno` prints a line containing `seno destro` (the feed is open, so `Poppata in corso: seno destro — iniziata alle …`).

- [ ] **Step 8: Full check**

Run: `npm run check`
Expected: lint + typecheck clean, all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/domain/commands.ts api/setup.ts api/webhook.ts src/dev.ts test/unit/domain/commands.test.ts
git commit -m "feat: add /seno command (last breast used)"
```

---

### Task 4: Free-text keyword recognition

**Files:**
- Modify: `src/domain/bot.ts` (`handleMessage` top ~lines 332-333; imports ~line 10)
- Test: `test/unit/domain/bot.test.ts`

**Interfaces:**
- Consumes: `LAST_FEED_QUERY`, `answerLastFeed` (Task 2).

- [ ] **Step 1: Add the failing keyword test**

In `test/unit/domain/bot.test.ts`, add inside `describe("[BOT] handleMessage", ...)`:

```ts
	it("answers the last-breast keyword without saving an event", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "eat",
				side: "dx",
				startedAt: new Date("2026-07-02T07:00:00+02:00"),
				endedAt: new Date("2026-07-02T07:20:00+02:00"),
				source: "rules",
				rawText: "poppata dx",
				messageId: 1,
				createdAt: new Date("2026-07-02T07:20:00+02:00"),
			}),
		);

		await handleMessage(msg("che seno?"))(env);

		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Ultima poppata: seno destro");
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.parser.parse).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "last-breast keyword"`
Expected: FAIL — no keyword branch; the message falls through to the help hint / parser.

- [ ] **Step 3: Import the module in `bot.ts`**

In `src/domain/bot.ts`, add after the `parse.js` import (line 10):

```ts
import { LAST_FEED_QUERY, answerLastFeed } from "./lastFeed.js";
```

- [ ] **Step 4: Short-circuit the keyword in `handleMessage`**

In `src/domain/bot.ts`, replace lines 332-333:

```ts
		const arrival = romeNow(msg.at);
		const normalized = normalize(msg.text);
		if (LAST_FEED_QUERY.test(normalized)) {
			await answerLastFeed(msg.chatId, msg.at)(env);
			return;
		}
		const tokens = parseRules(normalized);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: recognize 'che seno?' keyword for last breast used"
```

---

### Task 5: Side-prompt hint

**Files:**
- Modify: `src/domain/bot.ts` (`IncomingCallback` interface ~line 39-46; `promptSide` ~lines 162-182; import line ~10; both `promptSide` call sites ~line 308 and ~line 425)
- Modify: `api/webhook.ts` (callback_query handler — add `at`)
- Modify: `src/dev.ts` (callback construction — add `at`)
- Test: `test/unit/domain/bot.test.ts`

**Interfaces:**
- Consumes: `findLastFeed` (Task 1), `lastFeedHint` (Task 2).
- Produces: `IncomingCallback.at: Date`; `promptSide(env: BotEnv & EventEnv & PendingEnv & LoggerEnv, ctx: EventContext, intent: Intent, now: Date)`.

- [ ] **Step 1: Update existing promptSide tests + add hint tests**

In `test/unit/domain/bot.test.ts`:

(a) The `cb` helper in `describe("[BOT] handleCallback", ...)` builds callbacks — add an `at` field:

```ts
	const cb = (data: string) => ({
		id: "cbq",
		chatId: 1,
		userId: 1,
		userName: "papà",
		data,
		messageId: 200,
		at: new Date("2026-07-02T09:30:00+02:00"),
	});
```

(b) The three existing tests that reach `promptSide` now call `findLastFeed`; add a null mock to each so the lookup resolves. In these tests add, alongside their other `mocks.eventRepository.*` setup:

```ts
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));
```

The three tests are: `"asks for the side when a feed start has no side (no time)"`, `"asks for the side when a feed start has a time but no side"`, and `"confirming a sideless feed start asks for the side instead of saving"`.

(c) Add three new hint tests inside `describe("[BOT] handleMessage", ...)`:

```ts
	it("appends the last-side hint to the side prompt", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(
			success({
				id: "e1",
				chatId: 1,
				userId: 1,
				userName: "papà",
				type: "eat",
				side: "dx",
				startedAt: new Date("2026-07-02T07:00:00+02:00"),
				endedAt: new Date("2026-07-02T07:20:00+02:00"),
				source: "rules",
				rawText: "poppata dx",
				messageId: 1,
				createdAt: new Date("2026-07-02T07:20:00+02:00"),
			}),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		const text = mocks.bot.sendSidePrompt.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Per quale seno?");
		expect(text).toContain("(ultima: destro");
	});

	it("omits the hint when there is no prior feed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			"Per quale seno? 🤱",
			"ps1",
		);
	});

	it("still prompts when the last-feed lookup fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.findLastFeed.mockResolvedValue({
			success: false,
			error: new Error("db down"),
		});
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			"Per quale seno? 🤱",
			"ps1",
		);
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/domain/bot.test.ts`
Expected: FAIL — the "appends the last-side hint" test fails (prompt has no hint); the three updated tests fail if run before the `promptSide` change (they now mock `findLastFeed`, which `promptSide` does not yet call — they pass trivially until Step 3/4, so focus on the new hint test failing).

- [ ] **Step 3: Extend the import in `bot.ts`**

In `src/domain/bot.ts`, change the `lastFeed.js` import (added in Task 4) to include `lastFeedHint`:

```ts
import { LAST_FEED_QUERY, answerLastFeed, lastFeedHint } from "./lastFeed.js";
```

- [ ] **Step 4: Add `at` to `IncomingCallback`**

In `src/domain/bot.ts`, add to the `IncomingCallback` interface (after `messageId`, ~line 45):

```ts
	at: Date;
```

- [ ] **Step 5: Give `promptSide` the last-side hint**

In `src/domain/bot.ts`, replace the `promptSide` function (lines 162-182):

```ts
const promptSide = async (
	env: BotEnv & EventEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	now: Date,
): Promise<void> => {
	const lastRes = await env.eventRepository.findLastFeed(ctx.chatId);
	if (!lastRes.success) {
		env.logger.error("promptSide: findLastFeed failed", lastRes.error);
	}
	const hint = lastRes.success ? lastFeedHint(lastRes.data, now) : "";
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: SIDE_PROMPT,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (side) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendSidePrompt(ctx.chatId, `${SIDE_PROMPT}${hint}`, created.data.id);
};
```

- [ ] **Step 6: Thread `now` into both `promptSide` call sites**

In `src/domain/bot.ts`, in `handleCallback`'s conf-divert (the `promptSide` call, ~line 308):

```ts
			await promptSide(env, ctx, p.intent, cb.at);
```

In `handleMessage`'s save-divert (the `promptSide` call, ~line 425):

```ts
					await promptSide(env, ctx, decision.intent, msg.at);
```

- [ ] **Step 7: Add `at` where `IncomingCallback` is constructed**

In `api/webhook.ts`, in the `bot.on("callback_query", …)` handler, add to the `IncomingCallback` object:

```ts
			at: new Date(),
```

In `src/dev.ts`, in the `handleCallback({ … })` call (the conf/ann/dx/sx sim), add:

```ts
			at: new Date(),
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (all hint tests pass; the three updated promptSide tests still pass with the null mock).

- [ ] **Step 9: Manual dev check**

Run:

```bash
printf 'poppata dx\ndx\npoppata\n' | npm run dev:local
```

Expected: the final `poppata` (no side) shows a side prompt whose text includes `(ultima: destro, in corso)` — the previous feed is still open — e.g. `Per quale seno? 🤱 (ultima: destro, in corso)`.

- [ ] **Step 10: Full check + commit**

Run: `npm run check`
Expected: all green.

```bash
git add src/domain/bot.ts api/webhook.ts src/dev.ts test/unit/domain/bot.test.ts
git commit -m "feat: show last breast used as a hint in the side prompt"
```

---

## Self-Review

**Spec coverage:**
- `findLastFeed` repo read (interface + pg + memory + mock) → Task 1. ✓
- `lastFeed.ts` (`LAST_FEED_QUERY`, `lastFeedHint`, `formatLastFeed`, `answerLastFeed`) → Task 2. ✓
- `/seno` command (commands.ts + setup.ts menu + webhook + dev + HELP_TEXT) → Task 3. ✓
- Keyword recognition → Task 4. ✓
- Side-prompt hint (promptSide + `IncomingCallback.at` + threading) → Task 5. ✓
- Recency from `endedAt`, open→"in corso" → Task 2 formatters. ✓
- Exact copy strings → Global Constraints + Task 2/5 tests assert them. ✓
- `report.ts` untouched, no migration → no task edits them. ✓

**Placeholder scan:** none — every code step shows full code and exact commands.

**Type consistency:** `findLastFeed(chatId): Promise<Result<BabyEvent | null>>` used identically in Tasks 1-5. `answerLastFeed(chatId, now)(env)`, `lastFeedHint(feed, now)`, `formatLastFeed(feed, now)`, `LAST_FEED_QUERY` names match across Tasks 2-5. `promptSide(env, ctx, intent, now)` — the new 4th param is added in Task 5 and both call sites are updated in the same task. `IncomingCallback.at` is added and populated (webhook, dev, test `cb` helper) in Task 5. `senoCommand = answerLastFeed` — same signature, used by webhook/dev/commands.test.

**Note on Task 5 test ordering:** the three pre-existing promptSide tests get a `findLastFeed` null mock in Step 1 (before the impl change); they keep passing across the change because `promptSide` tolerates the mock either way. The genuinely-RED test at Step 2 is "appends the last-side hint".
