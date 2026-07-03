# Design: "Last breast used" — prompt hint + /seno command + keyword

Date: 2026-07-03

## Goal

Let a caregiver see which breast was used last, at the two moments it matters:

1. **Proactively, at feed time** — the `Per quale seno? 🤱` side prompt shows a
   compact hint of the last side used and how long ago that feed finished.
2. **On demand, anytime** — via a `/seno` command AND a free-text keyword
   (`che seno?`, `quale seno`, `ultimo seno`, …), the bot replies with the last
   feed's side and recency.

Recency is measured **from when the last feed finished**. A feed still in
progress is reported as ongoing (no "ago").

## Scope decisions (confirmed with user)

- Build all of it in one go: repository read + shared module + prompt hint +
  keyword + `/seno` command.
- Relative time is measured from the feed's **end** (`endedAt`); an open feed is
  "in corso" with no relative time.
- Command name is `/seno`.
- Prompt hint is **info only** — it never reorders or pre-selects a button.

## Non-goals

- No suggestion/nudge toward the opposite breast (no alternate-breast logic).
- No DB migration (every `eat` row already stores `side`).
- No change to reports, storage canonicity (`dx`/`sx`), or the Gemini enum.

## Copy (exact)

Full response (shared by `/seno`, the keyword, and `senoCommand`):
- Closed last feed: `Ultima poppata: seno destro — finita alle 15:00 (2h fa)`
- Feed in progress: `Poppata in corso: seno destro — iniziata alle 14:30`
- None on record: `Non ho ancora registrato una poppata con un seno.`

Side-prompt hint (appended to `Per quale seno? 🤱`):
- Closed last feed: ` (ultima: destro, 2h fa)` → `Per quale seno? 🤱 (ultima: destro, 2h fa)`
- Feed in progress: ` (ultima: destro, in corso)`
- None on record: `` (empty — the prompt stays `Per quale seno? 🤱`)

`destro`/`sinistro` come from the existing `SIDE_LABEL`. `2h`/`2h 5m`/`5m` come
from the existing `formatDuration`. Times come from the existing `hhmm`
(`H:mm`, no leading zero).

## Architecture

### 1. Repository read

Add one non-destructive method to `EventRepository` (`src/domain/event.ts`):

```ts
/** Most recent eat event that has a side (open or closed), or null. */
findLastFeed(chatId: number): Promise<Result<BabyEvent | null>>;
```

- **pg** (`src/adapters/pg/event.ts`):
  `SELECT * FROM events WHERE chat_id = $1 AND type = 'eat' AND side IS NOT NULL ORDER BY started_at DESC LIMIT 1`
- **memory** (`src/adapters/memory/event.ts`): among `chatId` events with
  `type === "eat"` and a defined `side`, pick the max by `startedAt`.
- **testEnv mock** (`test/unit/testEnv.ts`): add `findLastFeed: vi.fn(...)`.

"Last" is the most recent feed *with a side*; feeds without one (legacy /
pre-side-feature) are skipped. Per-chat (uses `chatId`).

### 2. Shared module `src/domain/lastFeed.ts`

One responsibility: the "last feed" query, formatting, and responder. A separate
module (rather than growing `commands.ts`) avoids a `bot.ts ↔ commands.ts`
runtime import cycle — `bot.ts` needs the keyword + hint, `commands.ts` needs the
command, and both import from this leaf. `lastFeed.ts` imports only
`type { BotEnv }` from `bot.js` (type-only, erased at runtime).

Exports:

```ts
// Matches a query word immediately before seno/tetta on already-normalized text.
export const LAST_FEED_QUERY = /\b(che|quale|qual|ultimo|ultima)\s+(seno|tetta)\b/;

// Compact suffix for the side prompt: " (ultima: destro, 2h fa)" | " (ultima: destro, in corso)" | ""
export const lastFeedHint = (feed: BabyEvent | null, now: Date): string => { … };

// Full one-line answer for the command/keyword.
export const formatLastFeed = (feed: BabyEvent | null, now: Date): string => { … };

// Fetch + format + send. Curried to match the commands.ts style.
export const answerLastFeed =
  (chatId: number, now: Date) =>
  async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => { … };
```

Internal helper `sinceFinished(feed, now)`: closed → `` `${formatDuration(now - endedAt)} fa` ``; open → `"in corso"`. `answerLastFeed` logs and sends `INTERNAL_ERROR` on a repo failure (mirrors existing commands).

### 3. Prompt hint

`promptSide` in `src/domain/bot.ts` gains `EventEnv` in its env type (both callers
— `handleMessage` and `handleCallback` — already provide it). Before sending, it
calls `findLastFeed(chatId)` and appends `lastFeedHint(...)` to the prompt text:

```ts
const lastRes = await env.eventRepository.findLastFeed(ctx.chatId);
const hint = lastRes.success ? lastFeedHint(lastRes.data, now) : "";
const text = `${SIDE_PROMPT}${hint}`;
```

A lookup failure logs and falls back to the plain prompt — it must never block
asking for the side. `now` is available in both callers (message `at` /
`new Date()`); `promptSide` takes a `now: Date` parameter. The pending's stored
`warning` stays `SIDE_PROMPT` (base copy); the dynamic hint is display-only.

### 4. Keyword

In `handleMessage` (`src/domain/bot.ts`), after normalizing but before
`parseRules`, check the query regex and short-circuit:

```ts
const normalized = normalize(msg.text);
if (LAST_FEED_QUERY.test(normalized)) {
  await answerLastFeed(msg.chatId, msg.at)(env);
  return;
}
const tokens = parseRules(normalized);
```

No event is saved on a query. `"poppata seno destro"` does not match (no query
word adjacent to `seno`), so feed logging is unaffected.

### 5. Command `/seno`

- `src/domain/commands.ts`: `export const senoCommand = answerLastFeed;`
  (imported from `lastFeed.js`), and add `/seno — ultimo seno usato (o scrivi
  "che seno?")` to `HELP_TEXT`.
- `api/webhook.ts`: `bot.command("seno", async (ctx) => { await senoCommand(ctx.chat.id, new Date())(env); })`,
  and add `{ command: "seno", description: "Ultimo seno usato" }` to the
  `COMMANDS` array (used by `setMyCommands`).
- `src/dev.ts`: add `case "/seno": await senoCommand(DEV_CHAT_ID, now)(env); return true;`
  to `runCommand`.

## Data flow

```
/seno            → senoCommand(chatId, now)(env) → findLastFeed → formatLastFeed → sendMessage
"che seno?"      → handleMessage → LAST_FEED_QUERY hit → answerLastFeed → (same)
feed start,      → promptSide → findLastFeed → lastFeedHint appended → sendSidePrompt
  no side
```

## Edge cases

- No feed with a side on record → full response = "Non ho ancora registrato…";
  hint = "" (plain prompt).
- Open feed is the most recent → full response = "Poppata in corso…"; hint =
  "(ultima: destro, in corso)".
- `findLastFeed` repo error → command/keyword send `INTERNAL_ERROR`; the side
  prompt silently drops the hint and still asks.
- Multi-chat allow-list: `findLastFeed` is per `chatId`, so chats stay isolated.

## Testing

- **`findLastFeed`**: pg query shape (type='eat', side not null, `started_at DESC LIMIT 1`);
  memory picks the latest eat-with-side and skips side-less/other-type/other-chat
  rows; both return null when none.
- **`LAST_FEED_QUERY`**: matches `che seno?`, `quale seno`, `ultimo seno`,
  `che tetta`; does NOT match `poppata seno destro`, `inizio poppata`, `seno destro`.
- **`formatLastFeed` / `lastFeedHint`**: closed → `"— finita alle H:mm (Xh fa)"` /
  `" (ultima: destro, Xh fa)"`; open → `"in corso — iniziata alle H:mm"` /
  `" (ultima: destro, in corso)"`; null → the none-message / `""`.
- **`promptSide` hint** (`bot.test.ts`): side prompt text includes
  `(ultima: destro` when `findLastFeed` returns a closed feed; no hint when it
  returns null; still prompts (no throw, `sendSidePrompt` called) when
  `findLastFeed` errors.
- **Keyword** (`bot.test.ts`): `handleMessage("che seno?")` → `sendMessage` with
  the last-feed answer, `insert` NOT called.
- **`senoCommand`** (`commands.test.ts`): closed/open/none responses.

## Files touched

- Create: `src/domain/lastFeed.ts`, `test/unit/domain/lastFeed.test.ts`
- Modify: `src/domain/event.ts` (interface), `src/adapters/pg/event.ts`,
  `src/adapters/memory/event.ts`, `test/unit/testEnv.ts`,
  `src/domain/bot.ts` (promptSide hint + keyword), `src/domain/commands.ts`
  (senoCommand + HELP_TEXT), `api/webhook.ts` (command + list), `src/dev.ts`
  (runCommand), plus their test files.
