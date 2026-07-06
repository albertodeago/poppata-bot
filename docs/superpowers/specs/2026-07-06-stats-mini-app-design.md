# Design: Telegram Mini App — baby stats & graphs

Date: 2026-07-06

## Goal

Give each family a **visual dashboard of their baby's stats** — feeds, sleep, pee,
poop, weight — as a Telegram Mini App launched from the group chat. A `/grafici`
command posts a button; tapping it opens a Vercel-hosted page that fetches
aggregated stats and draws playful, brutalist charts with topic + timeframe
toggles. Read-only; the bot remains the sole write path.

The visual design already exists as a prototype
(`stats-prototype/baby-stats-tracker.html`) — this spec ports it to real data,
Italian copy, and a secure data endpoint.

## Scope decisions (confirmed with user)

- **Telegram Mini App only** (not a standalone browser app). Launched from inside
  Telegram so `initData` gives a signed viewer identity for free — zero login.
- **Auth = two layers, neither bypassable:**
  1. **Authenticity:** `api/stats` recomputes the `initData` HMAC-SHA256 with
     `BOT_TOKEN` and rejects a bad hash or stale `auth_date`. A client cannot forge
     a `userId`. (Same trust model as the `WEBHOOK_SECRET` gate on `api/webhook`.)
  2. **Authorization:** `getChatMember(chatId, userId)` — data returns only if the
     verified user is an active member of that group. A guessed/forwarded link
     exposes nothing to a non-member.
- **Group launch ⇒ direct-link Mini App.** `web_app` buttons are private-chat only,
  so the group uses a BotFather-registered **direct-link Mini App**
  (`/newapp`), opened via a plain `url` button
  `t.me/<bot>/<app>?startapp=<chatId>`. The `chatId` rides in `start_param`;
  `initData` from a group does **not** contain the group's numeric id.
- **`start_param` carries the raw `chatId`, unsigned.** The `getChatMember` gate
  makes signing unnecessary (a forged/guessed id is blocked by the membership
  check, not by secrecy).
- **Eat chart = feed count** (breast + bottle combined) per bucket. The two summary
  cards carry the richness: breast/bottle split, avg feed duration, dx/sx, bottle ml.
- **Timeframes: Giorno / Settimana / Mese.** Giorno = 8×3h intraday buckets
  (midnight→now Rome); Settimana = 7 daily bars (ISO Mon–Sun); Mese = last 30 days,
  daily bars. Mese is a **new window** (bot currently knows only today/yesterday/week).
- **Weight = line of real readings in kg.** Sparse (≤1/day, irregular); convert from
  stored grams. Timeframe sets the line's range; Giorno shows latest value + delta
  (no bars — intraday is meaningless for weight).
- **Language: Italian**, matching the whole bot UX.
- **One combined `/api/stats` payload** (all topics × all timeframes + weight series)
  in one call; topic/timeframe switches are client-side, no refetch.

## Non-goals (YAGNI)

- No standalone-browser access / Telegram Login Widget — Mini-App-only. (The page
  can stay structured to bolt it on later, but nothing is built for it now.)
- No chart library and no build step — port the prototype's hand-rolled `<canvas>`
  drawing; single static file, matching the repo's zero-runtime-dep ethos.
- No write actions in the Mini App (no logging events, no editing) — read-only.
- No signed `start_param` token — membership check covers it.
- No caching layer / precomputed rollups — one `listSince` + one `weights.list`
  per load is cheap at this scale.
- No new DB table or migration, no schema/query change to `events` / `weights`.
- No per-user preferences persisted server-side (the prototype's `localStorage` of
  last topic/frame is fine to keep, client-only).
- No twins / multi-baby — one baby per chat, unchanged.

## Config additions (`src/config.ts`)

One new field, env-sourced:

```ts
miniAppUrl: string;   // MINIAPP_URL, e.g. https://t.me/PoppataBot/stats
```

Used by `/grafici` to build the launch button (`${miniAppUrl}?startapp=<chatId>`).
No default — `required("MINIAPP_URL")` — since the deep link only exists once the
app is registered in BotFather. `BOT_TOKEN` (already present) is reused for initData
validation; no auth secret is added.

## Architecture (fits the hexagon)

### `public/app.html` — the Mini App page (view only)

Port of the prototype, changed to:
- Load `https://telegram.org/js/telegram-web-app.js`; call `Telegram.WebApp.ready()`
  + `.expand()`; read the **raw** `Telegram.WebApp.initData` string. `initDataUnsafe`
  is used only for display, never trusted.
- On load, `fetch('/api/stats', { headers: { 'X-Telegram-Init-Data': initData } })`
  once, store the payload, render client-side. The client sends **only** the raw
  `initData`; the server derives `chatId` from the *signed* `start_param` inside it
  (no unsigned query param — see below).
- Swap sample-data generators for the fetched payload; topics/timeframes switch
  purely in JS (payload holds all of them).
- Italian labels: Poppate / Nanna / Pipì / Cacca / Peso; Giorno / Settimana / Mese.
- Weight topic draws the readings line (kg); Giorno shows latest + delta.
- Strip prototype-only `data-od-id` attributes.
- Error/empty states: unregistered/forbidden → friendly "non autorizzato" panel;
  no data yet → empty-state copy.

### `src/domain/stats.ts` — new pure module

```ts
buildStatsPayload(input: {
  events: BabyEvent[];      // listSince(chatId, monthStart, now)
  weights: WeightReading[]; // weights.list(chatId)
  babyName?: string;
  now: Date;
}): StatsPayload
```

- Buckets the month window into sub-periods per timeframe and calls the existing
  `aggregate` (from `report.ts`) on each sub-window — the existing overlap logic
  makes duration bucketing (a sleep spanning buckets) correct for free.
- Giorno: 8×3h sub-windows from Rome midnight; only elapsed buckets have data.
- Settimana: 7 day sub-windows from ISO week start.
- Mese: 30 day sub-windows ending today.
- Per count topic (eat/sleep/pee/poop): `{ buckets: number[], labels: string[],
  total, avgPerDay, + topic extras }`. Eat extras: `feedCount, bottleCount,
  bottleMl, avgFeedMs, feedDx, feedSx`. Sleep extras: `longestSleepMs` (week/month).
- Weight: map readings → `{ day, kg }[]`, filtered to the selected range client-side
  (send full list; ranges are small).
- Carries `openSession?: 'eat'|'sleep'` for the subtle "sessione aperta" note
  (excluded from totals — parity with reports' `openExcluded`).
- Pure and deterministic (takes `now`); unit-tested like `report.ts`.

New Rome window helper in `src/domain/time.ts`:
`lastNDaysWindow(now, n)` and a `bucketWindows(window, count | 'daily')` helper (or
inline in `stats.ts` — decide during implementation, keep `time.ts` the home for
zone math).

### `src/domain/miniapp.ts` — new pure module

```ts
validateInitData(raw: string, botToken: string, maxAgeSec: number):
  Result<{ userId: number; startParam?: string; authDate: number }>

authorizeDecision(params: { chatId: number; userId: number }):
  'self' | 'needs-membership'   // chatId === userId (private) ⇒ 'self' (auto-ok)
```

- HMAC per Telegram spec: `secret = HMAC_SHA256("WebAppData", botToken)`;
  `dataCheck = sorted "k=v" lines (excluding hash) joined by "\n"`;
  compare `HMAC_SHA256(dataCheck, secret)` hex to the provided `hash`
  (constant-time). Reject if `now - auth_date > maxAgeSec` (default 24h).
- `node:crypto` only; no new dependency. Unit-tested with fixed token/hash vectors.

### `api/stats.ts` — new serverless function

```
GET /api/stats   header: X-Telegram-Init-Data: <raw initData>

1. validateInitData(header, BOT_TOKEN, 24h) → userId, startParam  (401 on failure)
2. chatId = Number(startParam); require finite                   (400 on failure)
   — startParam is inside the signed initData, so it cannot be tampered
3. authorize:
     if chatId === userId → ok (private chat, viewer is the chat)
     else getChatMember(chatId, userId); ok iff status ∈
       {creator, administrator, member, restricted}             (403 otherwise)
4. events  = listSince(chatId, monthStart(now), now)
   weights = weights.list(chatId)
   name    = chatConfigRepository.get(chatId)?.babyName
5. return buildStatsPayload({ events, weights, babyName: name, now })  (200 JSON)
```

- Reuses `makeEnv()` (pool, repos, telegraf). `getChatMember` via
  `env.telegrafBot.telegram.getChatMember`.
- `maxDuration` in `vercel.json` (10s, like `webhook`). No cron.
- On any thrown error → 500 with generic body; details logged (mirrors `webhook.ts`).

### `api/webhook.ts` — `/grafici` command

Add `bot.command("grafici", …)`: reply with an inline keyboard `url` button
→ `${config.miniAppUrl}?startapp=${ctx.chat.id}`, Italian caption
(e.g. "📊 Apri le statistiche"). The button opens the direct-link Mini App; in a
private chat `startapp` = the user's own id (authorized as `self`).

### `api/setup.ts` — command list

Add `{ command: "grafici", description: "Grafici e statistiche" }` to `COMMANDS`.
No `allowed_updates` change (it's a normal message command). Re-run `/api/setup`
after deploy.

### `src/dev.ts` — local harness

`/grafici` in the console harness prints the would-be launch URL (or a note) — the
Mini App itself isn't exercised locally; `stats.ts` is covered by unit tests and
the page can be opened against a deployed `api/stats`.

## Data contract

```jsonc
GET /api/stats   (header: X-Telegram-Init-Data: <raw initData>)  →  200
{
  "babyName": "Mochi",              // optional
  "generatedAt": "2026-07-06T…Z",
  "day":   { "labels": ["00","03",…],
             "eat":  { "buckets":[…], "total":7, "feedCount":5, "bottleCount":2,
                       "bottleMl":180, "avgFeedMs":1080000, "feedDx":3, "feedSx":2 },
             "sleep":{ "buckets":[…], "total":…, "longestSleepMs":… },
             "pee":  { "buckets":[…], "total":…, "avgPerDay":… },
             "poo":  { "buckets":[…], "total":…, "avgPerDay":… } },
  "week":  { … same shape, 7 daily buckets … },
  "month": { … same shape, 30 daily buckets … },
  "weight": [ { "day": "2026-06-20", "kg": 5.9 }, … ],   // real readings, chronological
  "openSession": "sleep"            // optional
}

401 unauthorized (bad/stale initData) · 400 bad chatId · 403 not a member · 500 error
```

## Topic → metric mapping (Italian UI)

| Topic | Chart (per bucket) | 2 summary cards |
|---|---|---|
| 🍼 Poppate | feed count (breast+bottle) | breast/bottle split + avg feed duration · dx/sx + bottle ml |
| 😴 Nanna | sleep hours | totale · (sett./mese) sonno più lungo |
| 💦 Pipì | count | totale · media/giorno |
| 💩 Cacca | count | totale · media/giorno |
| ⚖️ Peso | line of real readings (kg) | ultimo · variazione sul periodo |

## Tests

- **`test/unit/domain/stats.test.ts`** — bucketing + aggregation: a sleep spanning
  two 3h buckets splits by overlap; eat feed-count vs bottle ml separation; weekly
  `longestSleepMs`; weight g→kg mapping; empty-window → zeroed buckets; `openSession`
  surfaced and excluded from totals.
- **`test/unit/domain/miniapp.test.ts`** — `validateInitData`: valid vector passes;
  tampered field / wrong hash / stale `auth_date` rejected; `start_param` extracted.
  `authorizeDecision`: `chatId === userId` ⇒ `self`; else `needs-membership`.
- **`test/unit/api/stats.test.ts`** (guard-style, like `api/webhook.test.ts`) —
  bad initData → 401; missing/NaN chatId → 400; non-member (`getChatMember` returns
  `left`) → 403; member → 200 with payload; `chatId === userId` short-circuits
  without calling `getChatMember`.
- **`test/unit/api/setup.test.ts`** — `grafici` present in `setMyCommands`.
- Existing `report.ts` tests unchanged (its aggregation is reused, not modified).

## Docs

- `README.md`: add `/grafici` to the commands table; document the Mini App (what it
  shows, the BotFather `/newapp` setup, `MINIAPP_URL`); tick the roadmap bullet
  "mini app telegram that shows graphs / stats".
- `.env.sample`: add `MINIAPP_URL`.
- Note the one-time manual setup: BotFather `/newapp` (short name + Vercel Web App
  URL), then re-run `/api/setup`.

## Setup checklist (manual, one-time)

1. BotFather → `/newapp` → pick the bot, set short name (e.g. `stats`), Web App URL
   = `https://<deployment>/app.html`.
2. Set `MINIAPP_URL=https://t.me/<botusername>/<shortname>` in Vercel env.
3. Deploy; re-run `/api/setup` (registers the `/grafici` command).

## Open questions

- None. All decisions confirmed with the user.
