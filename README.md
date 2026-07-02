# poppata-bot 🍼

A Telegram bot that logs an infant's activities — **eat / sleep / pee / poop** — from
natural-language Italian messages in a family group chat, and posts automatic daily
and weekly reports.

- **Language/runtime:** TypeScript, Node ≥ 24, ESM.
- **Architecture:** hexagonal / ports-and-adapters. Pure domain use-cases
  (`(command) => (env) => Promise<Result<…>>`); adapters implement the ports;
  errors flow through a `Result<T,E>` type instead of throwing.
- **Infra:** Supabase Postgres (`pg`), Telegram via **telegraf** webhook on
  **Vercel** serverless functions, **Google Gemini** as a fallback parser,
  **luxon** for Europe/Rome time. Tests with **Vitest**, lint/format with **Biome**.

Single baby, single allow-listed group chat.

---

## Roadmap

? DB table for chat
  - create new chat and add in allow-list
- retry if Gemini API fails - 2 retries with a bit of wait
- mini app telegram that shows graphs / stats
- make it super easy to host yourself ?


## What it understands

Free-text messages (Italian first; Gemini best-effort for anything the rules miss):

| You type | It logs |
|---|---|
| `inizio poppata dx 9.15` | feed start, right breast, 09:15 |
| `poppata sx` | feed start, left breast, now |
| `fine 9.40` | closes the open feed/sleep at 09:40 (replies with the duration) |
| `nanna 22` / `fine 6.30` | sleep start / end (handles crossing midnight) |
| `pipì` | pee (instant) |
| `cacca` | poop (instant) |

- A valid **start / pee / poop** gets a quiet 👍 reaction; a **fine** gets a short text reply with the computed duration.
- Anything questionable (starting while a session is open, an implausibly long duration, a low-confidence Gemini guess) asks for **[Conferma] / [Annulla]** before saving.
- Bare times resolve to whichever a.m./p.m. is **nearest to the message time**; `13`–`23` are taken as 24h.

### Commands

`/stato` (current open session) · `/oggi` · `/ieri` · `/settimana` · `/annulla` (undo last event) · `/help` · `/start`

### Reports

A cron posts **yesterday's** stats daily at `0 7 * * *` UTC (≈09:00 Rome in summer, 08:00 in winter — accepted drift). On **Mondays** it also posts the previous ISO week (Mon–Sun). Stale confirmation prompts (>24h) are swept in the same job.

---

## Local development (no cloud needed)

The fastest way to exercise the whole bot is the **stdin harness** — it wires the
real domain use-cases to a console "bot" and in-memory storage, so there's no
Telegram token, database, or network involved.

```bash
npm install
npm run dev:local
```

Then type messages, one per line:

```
inizio poppata dx 9.15     # → 👍 reaction
fine 9.40                  # → "durata poppata: 25m"
/stato                     # → run a command
pipì                       # → 👍
conf                       # → press the last [Conferma] button
ann                        # → press the last [Annulla] button
@mamma nanna 22            # → override the sender name
!23:50 fine                # → override the message arrival time
/oggi  /ieri  /settimana  /annulla  /help
/report  /report-week      # → fire the daily/weekly report locally
```

The console parser is **rules-only** (no Gemini locally), which the design allows.

### Scripts

| script | what it does |
|---|---|
| `npm run dev:local` | stdin harness (in-memory, console) |
| `npm run check` | Biome + `tsc --noEmit` + Vitest (run this before committing) |
| `npm test` | Vitest once |
| `npm run test:watch` | Vitest watch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:apply` | Biome check / check-and-write |
| `npm run build` | `tsc` compile to `dist/` (sanity; Vercel builds functions itself) |
| `npm run migrate:up` / `migrate:down` | apply / roll back DB migrations |

---

## Setup (one-time)

You need three external things (a Telegram bot, a Supabase database, a Gemini key)
and two generated secrets.

### 1. Telegram bot

1. Message **[@BotFather](https://t.me/BotFather)** → `/newbot` → pick a name and username → copy the token → this is **`BOT_TOKEN`**.
2. **Turn off privacy mode** (critical — otherwise the bot only receives `/commands`, not free text like `inizio poppata 9.15`):
   `@BotFather` → `/setprivacy` → pick your bot → **Disable**.
3. Create a Telegram **group** (use a private test group first), and **add the bot to it**. If you changed privacy mode after adding it, **remove and re-add** the bot so the change takes effect — or make the bot a **group admin** (admins see all messages regardless).
4. Get the group's chat id → **`ALLOWED_CHAT_ID`**. Send any message in the group, then open
   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
   and read `message.chat.id`. Groups are negative; supergroups start with `-100…`.

### 2. Supabase database

Create a project, then open the **Connect** button (top of the dashboard). You'll see three connection strings — you need **two** of them (replace `[YOUR-PASSWORD]` with your database password; reset it under Settings → Database if needed):

| String | Port | Use it as |
|---|---|---|
| **Transaction pooler** (`…pooler.supabase.com`) | **6543** | `DATABASE_URL` in **Vercel** (serverless-safe) |
| **Session pooler** (`…pooler.supabase.com`) | **5432** | `DATABASE_URL` in your **local `.env`** for `migrate:up` |
| Direct (`db.<ref>.supabase.co`) | 5432 | ⚠️ IPv6-only — usually unreachable; skip it |

Then create the tables (uses the **Session pooler** string in your local `.env`):

```bash
npm run migrate:up
```

You should see `events` and `pending_confirmations` appear in the Supabase Table Editor. The migration also creates a **partial unique index** enforcing at most one open eat/sleep session per chat.

### 3. Gemini

Get an API key at **[Google AI Studio](https://aistudio.google.com/)** → **`GEMINI_API_KEY`**. The model defaults to `gemini-2.0-flash` (`GEMINI_MODEL` to override).

### 4. Generate the two secrets

```bash
openssl rand -hex 32   # → CRON_SECRET
openssl rand -hex 32   # → WEBHOOK_SECRET   (Telegram allows A–Z a–z 0–9 _ - ; hex is fine)
```

---

## Environment variables

| var | required | purpose |
|---|:--:|---|
| `BOT_TOKEN` | ✅ | Telegram bot token |
| `ALLOWED_CHAT_ID` | ✅ | the group chat(s) served — one negative id, or several comma-separated (e.g. `-100111,-100222`) to run the same baby in multiple groups |
| `DATABASE_URL` | ✅ | Supabase connection string — **Transaction pooler (6543)** on Vercel; **Session pooler (5432)** locally for migrations |
| `GEMINI_API_KEY` | ✅ | Gemini REST key |
| `CRON_SECRET` | ✅ | bearer that guards the report cron |
| `WEBHOOK_SECRET` | ✅ | secret token Telegram echoes back on every webhook call (verified server-side) |
| `WEBHOOK_URL` | ✅ | deployment base URL, e.g. `https://poppata-bot.vercel.app` |
| `GEMINI_MODEL` | — | defaults to `gemini-2.0-flash` |
| `BABY_NAME` | — | shown in report headers |

`.env.sample` lists them for local use. **Timezone (`Europe/Rome`) is a code constant, not an env var.**

---

## Deploy (Vercel)

> **Key gotcha:** Vercel applies env vars to **new** deployments only. Always set/change env vars **then redeploy**, otherwise the running functions won't see them.

1. **Import the repo** into Vercel (or `vercel` CLI). It's a functions-only project — the included `vercel.json` sets the cron and function limits, and `public/index.html` satisfies Vercel's output-directory check.
2. **Set the environment variables** above in the Vercel project (Production). Use the **Transaction pooler (6543)** string for `DATABASE_URL` here.
3. **Deploy** (or redeploy after adding the env vars).
4. **Register the webhook + bot commands** once (also re-run this whenever you change `WEBHOOK_URL` or `WEBHOOK_SECRET`):
   ```bash
   curl -X POST "https://<your-app>.vercel.app/api/setup"
   ```
   Success returns `{"ok":true,"webhook":"…/api/webhook"}`.
5. **Test it:** in the group, send `inizio poppata dx 9.15` → the bot reacts 👍; `fine 9.40` → it replies with the duration.

### Endpoints

| route | method | purpose |
|---|---|---|
| `/api/webhook` | POST | receives Telegram updates (verifies the secret header) |
| `/api/setup` | POST | registers the webhook + bot commands (manual, one-time) |
| `/api/cron/report` | GET | daily/weekly report; requires `Authorization: Bearer $CRON_SECRET` |

Test the cron manually:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" "https://<your-app>.vercel.app/api/cron/report"
```

---

## Troubleshooting

- **Bot doesn't react to free text (but `/commands` work):** privacy mode is still on. `@BotFather → /setprivacy → Disable`, then remove & re-add the bot to the group (or make it admin).
- **Bot does nothing at all, no error:** `ALLOWED_CHAT_ID` is wrong — every update from any other chat is silently dropped. Re-check it via `getUpdates`.
- **`/api/setup` or messages return 500:** open **Vercel → deployment → Logs**. Common causes: an env var missing (`… is not set`) or set without a redeploy; a `pg` connection error (wrong `DATABASE_URL`, or migrations not run).
- **Webhook shows a 401 in `getWebhookInfo`:** `WEBHOOK_SECRET` in Vercel differs from what `/api/setup` registered — fix it and re-run `/api/setup`. Check with:
  ```bash
  curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
  ```
- **`migrate:up` hangs or errors:** you used the IPv6-only Direct string, or didn't replace `[YOUR-PASSWORD]`. Use the **Session pooler (5432)** string.

---

## Project structure

```
api/                      Vercel serverless functions
  webhook.ts              Telegram updates → domain use-cases (secret-verified)
  setup.ts                register webhook + bot commands
  cron/report.ts          daily (+ Monday weekly) report, CRON_SECRET-guarded
src/
  domain/                 pure core — no I/O, no framework imports
    result.ts logger.ts time.ts
    event.ts parse.ts pending.ts session.ts report.ts
    bot.ts commands.ts db.ts
  adapters/               port implementations
    pg/{event,pending}.ts db/pool.ts
    telegraf/bot.ts gemini/parse.ts
    memory/* console/* noop/*   (used by dev:local + tests)
  config.ts env.ts dev.ts
migrations/               node-pg-migrate migration(s)
test/unit/                Vitest suites (domain + adapters + api guards)
docs/superpowers/         design spec + implementation plans
```
