# poppata-bot 🍼

A Telegram bot that logs an infant's activities — **eat / sleep / pee / poop / weight** — from
natural-language Italian messages in a family group chat, and posts automatic daily
and weekly reports.

- **Language/runtime:** TypeScript, Node ≥ 24, ESM.
- **Architecture:** hexagonal / ports-and-adapters. Pure domain use-cases
  (`(command) => (env) => Promise<Result<…>>`); adapters implement the ports;
  errors flow through a `Result<T,E>` type instead of throwing.
- **Infra:** Supabase Postgres (`pg`), Telegram via **telegraf** webhook on
  **Vercel** serverless functions, **Google Gemini** as a fallback parser,
  **luxon** for Europe/Rome time. Tests with **Vitest**, lint/format with **Biome**.

One baby per chat. Chats **register themselves** with `/start` (or by adding the
bot to a group) — no env allow-list. A single deployment serves up to `MAX_CHATS`
(default 5) chats; beyond that, new chats get a prefilled "request access" link.

---

## Roadmap

- [x] mini app telegram that shows graphs / stats
- [ ] retrofit forgotten events (e.g. it's 20.15 and the user remembers that he skipped a session of 6.30-7.00). A command like `/retrofit 6.30-7.00 poppata dx` would create a new event in the past, and if it overlaps with an existing event, it would ask for confirmation before saving.

## What it understands

Free-text messages are Italian first; Gemini is a best-effort fallback for anything the rules miss.

| You type | What happens |
|---|---|
| `inizio poppata dx 9.15` | starts a feed on the right breast at 09:15 |
| `poppata sx` | starts a feed on the left breast now, and replies with the assumed time |
| `poppata` | asks **[Sinistro] / [Destro]**, then starts the feed at the message time |
| `inizio` / `inizio 9.15` | asks **[Poppata] / [Nanna]** before saving |
| `nanna 22` | starts a sleep session at 22:00 |
| `fine` | closes the open feed/sleep now, and replies with the duration |
| `fine 9.40` | closes the open feed/sleep at 09:40, and replies with the duration |
| `nanna 22` / `fine 6.30` | handles a sleep that crosses midnight |
| `pipì`, `pipi`, `plin`, `pisciata` | logs pee as an instant event |
| `cacca`, `popò`, `pupù`, `cacata` | logs poop as an instant event |
| `che seno?` / `ultimo seno?` | replies with the latest recorded breast side |
| `annulla` | removes the last event, same as `/annulla` |

- A saved instant event, or a start with all needed details and an explicit time, gets a quiet 👍 reaction.
- A start that defaults to **now** replies with the time it used; a **fine** replies with the computed duration.
- Missing information is handled with buttons: feed side (**Sinistro/Destro**) or session type (**Poppata/Nanna**).
- Anything questionable (starting while a session is open, an implausibly long duration, a low-confidence Gemini guess) asks for **[Conferma] / [Annulla]** before saving.
- Bare times resolve to whichever a.m./p.m. is **nearest to the message time**; `13`–`23` are taken as 24h.
- Weight is tracked with `/peso`, not free text.

### Commands

| Command | Use it for |
|---|---|
| `/start [nome]` | register or greet the chat; optionally set the baby name at once |
| `/nome [nome]` | show the current baby name, or set/replace it |
| `/stato` | show the current open feed or sleep session |
| `/oggi` | show today's stats so far |
| `/ieri` | show yesterday's stats |
| `/settimana` | show the current ISO week's stats |
| `/scaletta` | show today's events one by one |
| `/annulla` | remove the most recently saved event |
| `/seno` | show the latest recorded breast side |
| `/peso [grammi]` | show weight history, or record/update today's weight |
| `/grafici` | apri la mini app con grafici e statistiche |
| `/report on\|off` | turn the scheduled reports (daily + weekly) on/off for this chat; default is on |
| `/help` | show the in-chat help |

The local console harness also accepts `/report` and `/report-week` to fire scheduled reports manually.

### Chat registration

The bot serves a chat only after it has a config row. A chat gets one by:

- being **added to a group** — the bot auto-registers and posts a welcome, or
- someone running **`/start`** (optionally `/start Mario` to set the name at once).

Until then, the bot ignores everything except `/start` and `/help` (no parsing, no
Gemini). Set/replace the name anytime with **`/nome Mario`**; bare **`/nome`** shows
the current one. The name is optional — reports just omit it when unset.

When the deployment is already serving `MAX_CHATS` chats, a new chat's `/start`
replies with a **prefilled GitHub-issue link** (carrying the chat id) so the owner
can enable it manually with `npm run enable-chat -- <chatId> [nome]`.

### Reports

A cron posts **yesterday's** stats daily at `0 7 * * *` UTC (≈09:00 Rome in summer, 08:00 in winter — accepted drift). On **Mondays** it also posts the previous ISO week (Mon–Sun). Stale confirmation prompts (>24h) are swept in the same job.

### Stats Mini App

`/grafici` posts a button that opens a **Telegram Mini App** (`public/app.html`,
served by Vercel) with playful charts of feeds, sleep, pee, poop and weight over
**Giorno / Settimana / Mese**. It reads `GET /api/stats`, which validates the
Telegram `initData` HMAC (`BOT_TOKEN`) and checks group membership via
`getChatMember` before returning anything — the Postgres connection is never
exposed to the browser.

**One-time setup:** register a direct-link Mini App with BotFather (`/newapp` →
pick the bot → short name, e.g. `stats` → Web App URL
`https://<deployment>/app.html`), set `MINIAPP_URL=https://t.me/<botusername>/<shortname>`
in the environment, then re-run `/api/setup`.

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
/start Mario               # → register this chat; set the baby name
/nome Gigi                 # → change the name; "/nome" shows the current one
inizio poppata dx 9.15     # → 👍 reaction
fine 9.40                  # → "durata poppata: 25m"
/stato                     # → run a command
/peso 3400                 # → registra il peso di oggi; "/peso" mostra lo storico
pipì                       # → 👍
conf                       # → press the last [Conferma] button
ann                        # → press the last [Annulla] button
sx / dx                    # → tap the [Sinistro] / [Destro] side button
eat / sleep                # → tap the [Poppata] / [Nanna] type button
@mamma nanna 22            # → override the sender name
!23:50 fine                # → override the message arrival time
/oggi  /ieri  /settimana  /scaletta  /annulla  /help
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
| `npm run enable-chat -- <chatId> [nome]` | register a chat manually (bypasses the cap; needs `DATABASE_URL`) |

---

## Setup (one-time)

You need three external things (a Telegram bot, a Supabase database, a Gemini key)
and two generated secrets.

### 1. Telegram bot

1. Message **[@BotFather](https://t.me/BotFather)** → `/newbot` → pick a name and username → copy the token → this is **`BOT_TOKEN`**.
2. **Turn off privacy mode** (critical — otherwise the bot only receives `/commands`, not free text like `inizio poppata 9.15`):
   `@BotFather` → `/setprivacy` → pick your bot → **Disable**.
3. Create a Telegram **group** (use a private test group first), and **add the bot to it**. If you changed privacy mode after adding it, **remove and re-add** the bot so the change takes effect — or make the bot a **group admin** (admins see all messages regardless). No chat id to configure: adding the bot (or `/start`) registers the chat itself.

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

You should see `events`, `pending_confirmations`, `weights`, and `chat_configs` appear in the Supabase Table Editor. The migrations also create a **partial unique index** enforcing at most one open eat/sleep session per chat.

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
| `DATABASE_URL` | ✅ | Supabase connection string — **Transaction pooler (6543)** on Vercel; **Session pooler (5432)** locally for migrations |
| `GEMINI_API_KEY` | ✅ | Gemini REST key |
| `CRON_SECRET` | ✅ | bearer that guards the report cron |
| `WEBHOOK_SECRET` | ✅ | secret token Telegram echoes back on every webhook call (verified server-side) |
| `WEBHOOK_URL` | ✅ | deployment base URL, e.g. `https://poppata-bot.vercel.app` |
| `GEMINI_MODEL` | — | defaults to `gemini-2.0-flash` |
| `MAX_CHATS` | — | max chats that may self-register (default `5`) |
| `REPO_ISSUES_URL` | — | base repo issues URL for the "bot full" request-access link (default `https://github.com/albertodeago/poppata-bot/issues`) |

`.env.sample` lists them for local use. Chats are configured **at runtime** (`/start`, `/nome`), not via env. **Timezone (`Europe/Rome`) is a code constant, not an env var.**

---

## Deploy (Vercel)

> **Key gotcha:** Vercel applies env vars to **new** deployments only. Always set/change env vars **then redeploy**, otherwise the running functions won't see them.

1. **Import the repo** into Vercel (or `vercel` CLI). It's a functions-only project — the included `vercel.json` sets the cron and function limits, and `public/index.html` satisfies Vercel's output-directory check.
2. **Set the environment variables** above in the Vercel project (Production). Use the **Transaction pooler (6543)** string for `DATABASE_URL` here.
3. **Deploy** (or redeploy after adding the env vars).
4. **Register the webhook + bot commands** once (also re-run this whenever you change `WEBHOOK_URL` or `WEBHOOK_SECRET`). The endpoint is guarded by `CRON_SECRET` — pass it as a bearer token:
   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<your-app>.vercel.app/api/setup"
   ```
   Success returns `{"ok":true,"webhook":"…/api/webhook"}`.
5. **Test it:** in the group, send `inizio poppata dx 9.15` → the bot reacts 👍; `fine 9.40` → it replies with the duration.

### Endpoints

| route | method | purpose |
|---|---|---|
| `/api/webhook` | POST | receives Telegram updates (verifies the secret header) |
| `/api/setup` | POST | registers the webhook + bot commands (manual, one-time); requires `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/report` | GET | daily/weekly report; requires `Authorization: Bearer $CRON_SECRET` |

Test the cron manually:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" "https://<your-app>.vercel.app/api/cron/report"
```

---

## Troubleshooting

- **Bot doesn't react to free text (but `/commands` work):** privacy mode is still on. `@BotFather → /setprivacy → Disable`, then remove & re-add the bot to the group (or make it admin).
- **Bot does nothing at all, no error:** the chat isn't registered — send `/start` (or re-add the bot). Unregistered chats are silently dropped. If it's a fresh add that got no welcome, `my_chat_member` isn't in the webhook's `allowed_updates`: re-run `/api/setup`.
- **`/start` says the bot is full:** the deployment is at `MAX_CHATS`. Raise it, or run `npm run enable-chat -- <chatId> [nome]` for that chat.
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
    event.ts parse.ts pending.ts session.ts report.ts weight.ts
    chatConfig.ts registration.ts
    bot.ts commands.ts db.ts
  adapters/               port implementations
    pg/{event,pending,weight,chatConfig}.ts db/pool.ts
    telegraf/bot.ts gemini/parse.ts
    memory/* console/* noop/*   (used by dev:local + tests)
  config.ts env.ts dev.ts
migrations/               node-pg-migrate migration(s)
scripts/enable-chat.ts    manually register a chat (bypasses the cap)
test/unit/                Vitest suites (domain + adapters + api guards)
docs/superpowers/         design spec + implementation plans
```
