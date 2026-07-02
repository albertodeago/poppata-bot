# poppata-bot

Telegram bot that logs an infant's activities (eat / sleep / pee / poop) from
natural-language Italian messages, with daily/weekly reports. Hexagonal
TypeScript; Supabase Postgres; Telegram via telegraf webhook on Vercel; Google
Gemini as a fallback parser.

## Local development

- `npm run dev:local` — stdin harness (in-memory, console output, no cloud). Type
  messages like `inizio poppata dx 9.15`, `fine 9.40`, `pipì`, `/oggi`, or
  `conf`/`ann` to simulate the confirmation buttons.
- `npm run check` — Biome + typecheck + tests.

## Environment (Vercel project settings)

| var | purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token |
| `ALLOWED_CHAT_ID` | the one group chat served |
| `DATABASE_URL` | Supabase **pooled** connection string (port 6543) |
| `GEMINI_API_KEY` | Gemini REST key |
| `GEMINI_MODEL` | optional, default `gemini-2.0-flash` |
| `CRON_SECRET` | bearer for the report cron |
| `WEBHOOK_URL` | deployment base URL (e.g. `https://poppata-bot.vercel.app`) |
| `WEBHOOK_SECRET` | secret token Telegram echoes back on each webhook call (generate e.g. `openssl rand -hex 32`) |
| `BABY_NAME` | optional, for report headers |

## Deploy

1. Create the Supabase project; put the pooled `DATABASE_URL` in `.env`, then
   `npm run migrate:up` to create the tables.
2. Set the env vars above in Vercel and deploy.
3. Register the webhook + commands once: `curl -X POST "$WEBHOOK_URL/api/setup"`.
4. The daily report runs at `0 7 * * *` UTC (≈09:00 Rome in summer); Mondays also
   send the previous ISO week.
