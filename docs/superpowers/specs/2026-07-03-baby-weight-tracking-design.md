# Design: Baby weight tracking — /peso command

Date: 2026-07-03

## Goal

Let a caregiver record the baby's weight and review the trend over time. Weight
is an infrequent, deliberate action — not a free-text event like feeds/sleep.

1. **Record** — `/peso 3400` logs 3400 **grams** for **today** (Europe/Rome).
2. **Review** — bare `/peso` (no number) shows the history, one line per reading,
   with the growth delta since the previous reading, so "is it still growing?"
   is answered at a glance.

## Scope decisions (confirmed with user)

- **Command, not free-text.** A dedicated `/peso` command avoids the time-parser
  collision (`detectTime("peso 4.2")` reads `4.2` as the clock time `04:02`).
- **Grams, integer.** The argument is whole grams, stored exactly as typed
  (`/peso 3400`). No kg, no decimals, no unit auto-detection.
- **Today only.** A reading always belongs to today's Rome calendar day. No
  past-date backfill.
- **One per day.** Re-entering today overwrites (upsert); the reply notes it.
- **History view = list with deltas** (the second-half requirement).

## Non-goals (YAGNI)

- No past-date backfill (`/peso 3400 1/7`).
- No `/annulla` support for weights — a wrong value is corrected by re-entering
  the same day (overwrite). `deleteLast`/`events` are untouched.
- No weight in the daily/weekly reports.
- No delta on the single-record reply (delta lives only in the `/peso` history).
- No confirmation ([Conferma]/[Annulla]) flow — record is a silent upsert.
- No change to the `events` table, its queries, or the open-session index.

## Storage approach (decision)

**Separate `weights` table + `WeightRepository` port** (chosen over extending
`events`).

`events` is session-shaped — `type`/`side`/`started_at`/`ended_at`, no numeric
column, and a partial unique index enforcing *one open session*. Weight is a
daily scalar with a *one-per-calendar-day* invariant, no open/close, no side.
A dedicated table + port keeps it isolated: zero changes to
`listSince`/`aggregate`/`deleteLast`/the open-session index, independently
testable, and consistent with the codebase's one-module-per-concern grain.

## Copy (exact)

Record (valid):
- Fresh day: `⚖️ Peso di oggi: 3400 g`
- Overwrote today: `⚖️ Peso di oggi: 3400 g (aggiornato)`

Record (invalid / out of band): usage hint
- `Usa /peso 3400 (peso in grammi).`

History (`/peso`, no arg):
- With readings — heading `⚖️ Peso`, then one line per reading in chronological
  order, `d LLL` Italian date, grams, and `(+Δ)`/`(-Δ)` vs the previous line
  (first line has no delta):
  ```
  ⚖️ Peso
  1 lug   3200 g
  8 lug   3400 g  (+200)
  15 lug  3610 g  (+210)
  ```
- Empty state: `Nessun peso registrato. Scrivi /peso 3400 per registrarne uno.`

Italian month abbreviation via luxon `setLocale("it").toFormat("d LLL")`. Grams
rendered as `${grams} g`. Deltas are signed integers in grams.

## Data model

New migration `migrations/<ts>_create-weights.js` (reuse the `id`/`created_at`
shorthands already defined):

```
weights
  id          uuid pk        gen_random_uuid()
  chat_id     bigint  not null
  day         date    not null      -- Rome-local calendar day (yyyy-MM-dd)
  grams       integer not null
  user_id     bigint  not null
  user_name   text    not null
  created_at  timestamptz not null  NOW()

  unique index (chat_id, day)       -- one reading per day; upsert overwrites
```

`down` drops the table.

## Architecture

### 1. Time helper

`src/domain/time.ts`: add

```ts
/** Rome-local calendar day as yyyy-MM-dd (the storage key for a weight). */
export const romeDay = (at: Date): string => romeNow(at).toFormat("yyyy-MM-dd");
```

### 2. Domain module `src/domain/weight.ts`

One responsibility: the weight reading type, port, parsing, and formatting.

```ts
export interface WeightReading {
  id: string;
  chatId: number;
  day: string;          // yyyy-MM-dd (Rome)
  grams: number;
  userId: number;
  userName: string;
  createdAt: Date;
}

export type NewWeightReading = Omit<WeightReading, "id" | "createdAt">;

export interface WeightRepository {
  /** Insert today's reading, or overwrite it if the day already has one. */
  upsert(reading: NewWeightReading): Promise<Result<{
    reading: WeightReading;
    overwritten: boolean;
  }>>;
  /** All readings for a chat, chronological (oldest first). */
  list(chatId: number): Promise<Result<WeightReading[]>>;
}

export interface WeightEnv { weightRepository: WeightRepository; }
```

Pure helpers (exported for direct testing):

```ts
export const MIN_GRAMS = 500;
export const MAX_GRAMS = 30000;

/** Parse the command argument to whole grams, or null if not a plausible value. */
export const parseGrams = (arg: string): number | null => { … };
//  trims; requires /^\d+$/; rejects <MIN_GRAMS or >MAX_GRAMS. Fat-finger typos
//  like "340" or "340000" → null → usage hint.

/** The ⚖️ history block with per-reading deltas, or the empty-state line. */
export const formatHistory = (readings: WeightReading[]): string => { … };
//  chronological; first line no delta; subsequent lines append
//  ` (${sign}${abs} )` where sign is + / - vs the previous grams.
```

### 3. Command `pesoCommand`

In `src/domain/commands.ts` (alongside the other commands), curried to match the
house style:

```ts
export const pesoCommand =
  (chatId: number, arg: string, now: Date) =>
  async (env: WeightEnv & BotEnv & LoggerEnv): Promise<void> => { … };
```

- `arg` empty/whitespace → `list(chatId)` → `formatHistory` → `sendMessage`.
- `arg` present → `parseGrams`:
  - `null` → `sendMessage(usage hint)`.
  - grams → `upsert({ chatId, day: romeDay(now), grams, userId, userName })`.
    Reply `⚖️ Peso di oggi: N g`, appending ` (aggiornato)` when
    `overwritten`.
- Any repo failure → log + `INTERNAL_ERROR` (mirrors existing commands).

`userId`/`userName` come from the command call site (webhook `ctx.from`, dev
harness constants).

Add a `/peso` line to `HELP_TEXT`:
`/peso 3400 — registra il peso di oggi (grammi); /peso — storico`

### 4. Adapters

**pg** `src/adapters/pg/weight.ts` — `makePgWeightRepository(env: DBEnv & LoggerEnv)`:

- `upsert`:
  ```sql
  INSERT INTO weights (chat_id, day, grams, user_id, user_name)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (chat_id, day)
  DO UPDATE SET grams = EXCLUDED.grams,
               user_id = EXCLUDED.user_id,
               user_name = EXCLUDED.user_name,
               created_at = NOW()
  RETURNING *, (xmax <> 0) AS overwritten
  ```
  `xmax <> 0` is true on the update path, false on a fresh insert. (`day` is
  passed as the `yyyy-MM-dd` string; Postgres casts to `date`.) `mapRow`
  converts `chat_id`/`user_id` via `Number(...)`, `day` via the row's date →
  `yyyy-MM-dd` string, `grams` via `Number(...)`.
- `list`:
  `SELECT * FROM weights WHERE chat_id = $1 ORDER BY day` → `rows.map(mapRow)`.

Both wrapped in `tryCatch` like `pg/event.ts`.

**memory** `src/adapters/memory/weight.ts` — `makeMemoryWeightRepository({ logger })`:

- backing `Map<string, WeightReading>` keyed `${chatId}:${day}`.
- `upsert`: `overwritten = map.has(key)`; set/replace; return `{ reading, overwritten }`.
- `list`: values filtered by `chatId`, sorted by `day` ascending.

### 5. Wiring

- `src/env.ts`: `const weightRepository = makePgWeightRepository({ db, logger });`
  add to the returned env; add `WeightEnv` to the `Env` intersection.
- `api/webhook.ts`: register the command, extracting the text after `/peso` as
  the arg:
  ```ts
  bot.command("peso", async (ctx) => {
    const arg = ctx.message.text.replace(/^\/peso(@\S+)?\s*/, "");
    await pesoCommand(ctx.chat.id, arg, new Date())(env);
  });
  ```
  (`(@\S+)?` tolerates `/peso@BotName` in groups.) `userId`/`userName` from
  `ctx.from` via the existing `senderName` helper.
- `api/setup.ts`: add `{ command: "peso", description: "Peso (registra/storico)" }`
  to `COMMANDS`.
- `src/dev.ts`: wire `makeMemoryWeightRepository` into the dev env, and dispatch
  `/peso [n]` with its argument (the current `runCommand` matches exact strings;
  add a prefix branch for `/peso`):
  ```ts
  if (trimmed === "/peso" || trimmed.startsWith("/peso ")) {
    const arg = trimmed.slice("/peso".length).trim();
    await pesoCommand(DEV_CHAT_ID, arg, now)(env);
    return true;
  }
  ```

## Data flow

```
/peso 3400  → pesoCommand(chatId,"3400",now) → parseGrams → upsert(day=romeDay) → sendMessage
/peso       → pesoCommand(chatId,"",now)     → list → formatHistory → sendMessage
```

## Edge cases

- **Overwrite same day** → `upsert` returns `overwritten: true` → ` (aggiornato)`.
- **Invalid arg** (`/peso abc`, `/peso 12.5`, `/peso 340`, `/peso 340000`) →
  `parseGrams` → `null` → usage hint. Nothing saved.
- **Empty history** → empty-state line.
- **Single reading** → one line, no delta.
- **Weight loss** between readings → negative delta `(-120)`.
- **Repo error** → log + `INTERNAL_ERROR`.
- **Multi-chat allow-list** → keyed by `chatId`, chats stay isolated.
- **Day boundary** → `romeDay` uses Europe/Rome, so a late-evening entry lands on
  the correct local day regardless of server UTC.

## Testing

- **`parseGrams`** (`weight.test.ts`): accepts `"3400"`, `" 3400 "`; rejects
  `""`, `"abc"`, `"12.5"`, `"34"`/`"340"` (< MIN), `"340000"` (> MAX), negatives.
- **`formatHistory`**: empty → empty-state line; single → no delta; multiple →
  chronological with `(+Δ)`; a decrease → `(-Δ)`; heading `⚖️ Peso`.
- **`pesoCommand`**: record fresh → `sendMessage("⚖️ Peso di oggi: 3400 g")` +
  `upsert` called with `day = romeDay(now)`; overwrite → ` (aggiornato)`;
  invalid arg → usage hint, `upsert` NOT called; no arg → `list` → history text;
  repo error → `INTERNAL_ERROR`.
- **memory adapter** (`memory/weight.test.ts`): upsert insert vs overwrite
  (`overwritten` flag), `list` ordering + per-chat isolation.
- **pg adapter** (`pg/weight.test.ts`): mock `db.query`; assert upsert SQL uses
  `ON CONFLICT (chat_id, day)` + params order, `list` SQL orders by `day`,
  `mapRow` conversions (incl. `overwritten`).
- **testEnv** (`test/unit/testEnv.ts`): add a `weightRepository` mock
  (`upsert`, `list`) mirroring the `findLastFeed` addition, so command tests can
  drive it.

## Files touched

- **Create**: `migrations/<ts>_create-weights.js`, `src/domain/weight.ts`,
  `src/adapters/pg/weight.ts`, `src/adapters/memory/weight.ts`,
  `test/unit/domain/weight.test.ts`, `test/unit/adapters/pg/weight.test.ts`,
  `test/unit/adapters/memory/weight.test.ts`.
- **Modify**: `src/domain/time.ts` (`romeDay`), `src/domain/commands.ts`
  (`pesoCommand` + `HELP_TEXT`), `src/env.ts` (wire + `Env`), `api/webhook.ts`
  (command), `api/setup.ts` (`COMMANDS`), `src/dev.ts` (dispatch),
  `test/unit/testEnv.ts` (mock), and the README roadmap/commands sections.
