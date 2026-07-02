# poppata-bot — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

A Telegram bot to track an infant's activities — eat, sleep, pee, poop — from natural-language messages, with automatic daily/weekly reports. One baby, one shared group chat (parent + partner), hosted on Vercel with Supabase Postgres.

## Goals

- Log four activity types from free-text Italian (and, best-effort, any language) messages:
  - `inizio poppata dx 9.15` → start feed, right breast, 09:15
  - `fine 9.40` → end the currently-open session at 09:40
  - `pipi` → pee (instant), `cacca` → poop (instant)
  - `nanna 10` → start sleep at 10:00; `fine 10.15` → end it at 10:15
- Warn (with confirmation buttons) before saving anything questionable.
- Auto-report yesterday's stats every day at ~09:00 Rome; on Mondays also the previous ISO week (Mon–Sun).

## Non-goals (for MVP)

- Multiple babies / multi-family tenancy (single baby, single allow-listed chat).
- Editing a saved entry by editing the Telegram message (undo via `/annulla` only).
- Exact 09:00 delivery across DST (accept 1h winter drift — see Cron).

## Stack & architecture

Mirrors the `wehimanbot` reference project:

- **Language/runtime:** TypeScript, Node ≥ 24.
- **Bot:** telegraf 4, webhook-based (no long polling in prod).
- **Hosting:** Vercel serverless functions under `api/`.
- **DB:** Supabase Postgres via `pg` `Pool`; migrations via `node-pg-migrate`.
- **NLU fallback:** Google Gemini (`gemini-2.0-flash` default) via REST.
- **Time:** `luxon` for Europe/Rome zoned time + DST correctness.
- **Tooling:** Vitest (tests), Biome (lint/format).
- **Style:** hexagonal / ports-and-adapters. Domain use-cases are pure `(command) => (env) => Promise<Result<...>>` functions; adapters implement ports; `src/env.ts` wires the graph. Errors flow through a `Result<T, E>` type rather than throwing.

### Layout

```
api/
  webhook.ts            # Telegram updates (POST)
  setup.ts              # register webhook + bot commands
  cron/report.ts        # daily (+ Monday weekly) report; CRON_SECRET-guarded
src/
  domain/
    event.ts            # Event entity, EventType, ports (EventRepo)
    session.ts          # open-session lookup + validation rules
    parse.ts            # intent model + rules parser + Gemini orchestration (ports)
    time.ts             # am/pm-nearest resolver, Rome day/week windows (luxon)
    report.ts           # aggregation: totals, counts, averages
    bot.ts              # use-cases: handleMessage, handleCallback, commands
    result.ts           # Result<T,E>
    logger.ts           # LoggerEnv port
  adapters/
    telegraf/bot.ts     # BotEnv impl (sendMessage, reaction, inline kbd, answerCbQuery)
    pg/event.ts         # EventRepo impl (Supabase)
    pg/pending.ts       # pending_confirmations repo
    gemini/parse.ts     # Gemini JSON-schema call
    memory/*.ts         # in-memory repos for tests + local harness
    console/logger.ts
    console/bot.ts      # BotEnv impl that prints replies/reactions/buttons (local harness)
    db/pool.ts          # pg Pool (Supabase pooled connection)
  env.ts                # makeEnv() — prod wiring (telegraf + pg)
  dev.ts                # local harness entrypoint: stdin → domain pipeline → console bot
  config.ts             # env var parsing/validation
migrations/
docs/superpowers/specs/
```

## Data model (Supabase Postgres)

### `events`
One row per **confirmed** activity. Only real data lives here.

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | `gen_random_uuid()` |
| `chat_id` | `bigint` | Telegram chat |
| `user_id` | `bigint` | who logged it |
| `user_name` | `text` | display name at log time |
| `type` | `text` | `eat` \| `sleep` \| `pee` \| `poop` (extensible) |
| `side` | `text` null | `dx` \| `sx` for feeds; else null |
| `started_at` | `timestamptz` | for eat/sleep = start; for pee/poop = the instant |
| `ended_at` | `timestamptz` null | eat/sleep when closed; null while open or for instant events |
| `source` | `text` | `rules` \| `gemini` (debug/analytics) |
| `raw_text` | `text` | original message |
| `message_id` | `bigint` | Telegram message id (for `/annulla`) |
| `created_at` | `timestamptz` | default `now()` |

- **Open session** = `type in ('eat','sleep') AND ended_at IS NULL`. Invariant: at most one open session per chat (enforced in the app; a partial unique index can back it up).
- Instant events (`pee`/`poop`): `ended_at` stays null permanently.
- Indexes: `(chat_id, started_at)`; partial `(chat_id) where ended_at is null and type in ('eat','sleep')`.

### `pending_confirmations`
Questionable parses awaiting a button press.

| column | type | notes |
|---|---|---|
| `id` | `uuid` pk | value placed in `callback_data` |
| `chat_id` / `user_id` / `user_name` | | |
| `intent` | `jsonb` | proposed action (see Intent) |
| `warning` | `text` | reason shown to the user |
| `message_id` | `bigint` | original message |
| `created_at` | `timestamptz` | default `now()` |

Confirm → apply `intent` (insert event / close open session) + delete row. Annulla → delete row. Stale rows (> 24h) swept opportunistically or in the cron.

## Intent model

Parser output, independent of rules-vs-Gemini:

```ts
type Action = 'start' | 'end' | 'instant';
interface Intent {
  type: 'eat' | 'sleep' | 'pee' | 'poop';
  action: Action;              // eat/sleep: start|end; pee/poop: instant
  side?: 'dx' | 'sx';          // eat only
  at: DateTime;                // resolved Europe/Rome instant
  source: 'rules' | 'gemini';
  confidence: number;          // 1.0 for confident rules; Gemini-provided otherwise
}
```

## Parsing pipeline

Runs for each text message originating from `ALLOWED_CHAT_ID` (others ignored silently).

1. **Normalize** — trim, lowercase, strip accents for matching.
2. **Rules parser** — keyword map + time regex:
   - eat: `poppata|allatta(mento)?|tetta|latte|poppa`
   - sleep: `nanna|dorme|dormit|sonnellino|sleep`
   - pee: `pipì|pipi|plin`
   - poop: `cacca|pupù|pupu|feci|poop`
   - action start: `inizio|inizia|start|comincia`; action end: `fine|finito|finita|stop|end|basta`
   - side: `dx|destra|right` → dx; `sx|sinistra|left` → sx
   - time: `(\d{1,2})[.:h ]?(\d{2})?` → hour, optional minute
   - Derivation: an eat/sleep keyword with no explicit action + a time ⇒ `start`; a bare `fine`/`stop` ⇒ `end` on the open session; pee/poop ⇒ `instant`.
3. **Gemini fallback** — only when rules are not confident (no type found, or conflicting tokens). Strict JSON schema response `{type, action, side, hour, minute, confidence}`. On low `confidence` → treat as questionable (warn).
4. **Resolve time** (`time.ts`, Europe/Rome):
   - Explicit time present: build candidates at `h:mm` and `(h+12):mm` today (and the day-shifted neighbours), pick the one **nearest to the message arrival time**. Hours ≥ 13 are taken as-is (24h). See Time rules.
   - No time: use the message arrival time.
5. **Validate** against session state (`session.ts`) → either save directly (👍 reaction) or open a `pending_confirmation` with inline **[Conferma] [Annulla]**.

## Validation / warning rules

| situation | resolution |
|---|---|
| `start` while a session is already open | **pending**: "C'è già una {tipo} aperta dalle HH:MM. Chiuderla alle HH:MM e iniziare {nuovo}?" Confirm → close old at new start, open new. Annulla → discard. |
| `end` with `ended_at < started_at` | assume crossed midnight → roll end +1 day. Warn (**pending**) only if resulting duration > 12h. |
| `end` with no open session | plain-text error, nothing saved: "Nessuna sessione aperta da chiudere." |
| implausible duration (feed > 90min, sleep > 12h — tunable) | **pending** confirm-to-save |
| Gemini low confidence | **pending** confirm-to-save, echoing the interpretation |
| unparseable | plain-text hint pointing to `/help` |

### Feedback on valid entries

Valid, unambiguous entries save immediately. The feedback depends on the action:

- **`start` (inizio), `pee`, `poop`** → 👍 **reaction** on the user's message (quiet in the group).
- **`end` (fine)** → a short **text reply** that states the computed duration since the matching start, e.g.:
  - `fine poppata` → "Ok, aggiunta ✅ — durata poppata: 45m"
  - sleep → "Ok, aggiunta ✅ — durata nanna: 1h 20m"

  Duration is `ended_at − started_at` of the just-closed session, formatted compactly (`Xh Ym` / `Ym`).

Only questionable entries (any action) produce the [Conferma]/[Annulla] warning reply.

## Bot surface

- **Logging:** any qualifying text message → parse pipeline.
- **Callbacks:** `conf:<pendingId>` / `ann:<pendingId>` from the inline buttons.
- **Commands:**
  - `/start`, `/help` — supported phrases + command list.
  - `/stato` — current open session ("Poppata in corso da 9:15, 22 min") or "nessuna".
  - `/oggi` — today's stats so far; `/ieri` — yesterday's full stats.
  - `/settimana` — current/last week stats.
  - `/annulla` — delete the most recent event in the chat (report what was removed).

Only the allow-listed chat is served; updates from other chats are ignored.

## Reports (Vercel cron)

- **Schedule:** `0 7 * * *` UTC (`api/cron/report.ts`), guarded by `CRON_SECRET` bearer. ≈ 09:00 Rome in summer (CEST); 08:00 in winter (CET) — accepted drift.
- **Daily:** window = *yesterday* `[00:00, 24:00)` Europe/Rome.
- **Weekly (Mondays only, in addition):** previous ISO week, Monday `00:00` → Sunday `24:00` Rome.
- **Metrics:**
  - Sleep total (hours).
  - Eat total (hours) + feed count, split dx/sx.
  - Pee count, poop count.
  - Weekly extras: avg feed duration, longest sleep, avg gap between feeds.
- **Midnight-crossing sessions:** clip each session to the report window (count only the overlapping portion). A session still open on a past day is excluded and flagged in the report footer.
- Delivered to `ALLOWED_CHAT_ID`. Uses `BABY_NAME` in the header if set.

## Config / environment

| var | purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token |
| `DATABASE_URL` | **Supabase pooled/pgbouncer connection string (port 6543)** — required for serverless to avoid exhausting connections |
| `GEMINI_API_KEY` | Gemini REST auth |
| `GEMINI_MODEL` | default `gemini-2.0-flash` |
| `ALLOWED_CHAT_ID` | the one group chat served |
| `CRON_SECRET` | cron bearer auth |
| `WEBHOOK_URL` | base URL for `api/setup.ts` webhook registration |
| `BABY_NAME` | optional, for nicer report headers |
| `DEV_BOT_TOKEN` | optional, for the `dev:bot` polling harness |

Timezone (`Europe/Rome`) is a code constant, not env. The `dev:local` harness needs none of these except (optionally) `DATABASE_URL` / `GEMINI_API_KEY`; it defaults to in-memory storage and can run the rules parser without Gemini.

## Local development

Two ways to exercise the bot without deploying:

1. **Local harness (primary) — `npm run dev:local`.** `src/dev.ts` builds an `Env` wired with the **console bot adapter** (prints replies, reactions, and inline buttons to the terminal instead of calling Telegram) and a repo chosen by env: in-memory by default, or the real Supabase `DATABASE_URL` when set. It reads messages from stdin, one per line, and runs each through the *exact same* domain use-cases as production (`handleMessage`, commands). Special input:
   - a `/command` line runs that command;
   - `conf` / `ann` simulate pressing the last-shown [Conferma]/[Annulla] button;
   - a leading `@name` / `!HH:MM` prefix (optional) overrides sender/arrival-time for testing the am/pm resolver and multi-user cases.
   No Telegram token, network, or ngrok required — fast, deterministic, scriptable (pipe a file of messages in).

2. **Dev bot (optional) — `npm run dev:bot`.** Reuses the reference's polling path (`bot.launch()`) behind a separate `DEV_BOT_TOKEN`, pointed at a dev DB. Gives real Telegram UX (actual reactions, tappable buttons) when you want to validate the end-to-end experience. Not needed for day-to-day iteration.

The console bot adapter is just another `BotEnv` implementation alongside the in-memory repos, so it costs almost nothing given the ports-and-adapters design and keeps the domain the single source of behavior across prod, harness, and tests.

## Testing

- Domain use-cases exercised against **in-memory** adapters (no DB/network).
- Unit coverage:
  - **parser** — a table of Italian phrases (the spec examples + variants, accents, 24h vs bare hours, side synonyms) → expected `Intent`.
  - **time resolver** — am/pm-nearest across morning/evening arrivals, midnight crossing, DST boundary days.
  - **session validation** — each warning rule.
  - **report aggregation** — fixture event sets → expected totals/counts/averages, including midnight-clipping.
- Gemini adapter mocked; a couple of contract tests assert the JSON-schema shape handling.

## Security

- Process only updates whose chat is `ALLOWED_CHAT_ID`.
- Optional: Telegram webhook `secret_token` header check on `api/webhook.ts`.
- Cron endpoint requires `Authorization: Bearer $CRON_SECRET`.

## Key decisions (resolved)

1. Single baby, one shared allow-listed group chat; track which user logged each event.
2. Hybrid parsing: local rules first, Gemini only for leftovers.
3. One open session at a time; warn-and-confirm before saving questionable data.
4. Valid entries: 👍 reaction for `start`/`pee`/`poop`; `end` gets a text reply with the computed session duration. Questionable → [Conferma]/[Annulla], save on confirm.
   - Local testability: primary `dev:local` CLI harness (console bot adapter, stdin messages, no Telegram); optional `dev:bot` polling with `DEV_BOT_TOKEN`.
5. Reports: sleep h, eat h + count (dx/sx), pee/poop counts, + weekly averages/longest; ISO Mon–Sun week; Europe/Rome.
6. `/annulla` undoes the last event; commands `/oggi /ieri /settimana /stato /help /start`.
7. Cron at fixed `0 7 * * *` UTC (accept winter drift).
8. Bare times resolve am/pm nearest to message arrival; ≥13 taken as 24h.

## Deferred / future

- Multiple babies or per-user private chats.
- Message-edit re-parsing.
- Exact-09:00 year-round delivery (two-cron + per-day idempotency guard).
- Additional activity types (temperature, medicine, weight) — the `type` column is already open-ended.
