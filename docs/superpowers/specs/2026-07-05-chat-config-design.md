# Design: Per-chat configuration + self-serve registration

Date: 2026-07-05

## Goal

Make the bot a **single hosted deployment that many families can onboard
themselves**, without the owner editing env vars and redeploying. Replace the two
"single-baby" env knobs (`BABY_NAME`, `ALLOWED_CHAT_ID`) with a per-chat
`chat_configs` table. A chat self-registers via `/start` (or by being added to a
group); the row is **both its config and its access gate**.

v1 stores exactly one configurable field: the **baby name** (optional). Reports,
parser, replies and `Europe/Rome` all stay hardcoded — this is "any
Italian-speaking, Rome-timezone family can onboard without touching env", **not**
internationalization.

## Scope decisions (confirmed with user)

- **Tenancy: one hosted bot, many families.** The `chat_configs` row is the gate —
  no row ⇒ the bot processes nothing except the entry points that can create one.
- **Config v1 = baby name only.** Nullable; a chat works without it (reports already
  omit the name gracefully). Added/changed anytime via `/nome`.
- **Registration is explicit and cheap.** `/start` registers; being **added to a
  group** (`my_chat_member`) auto-registers + greets. Both share one register path.
- **Anyone in the chat** may register and rename (intra-family trust; the exposure
  is cross-chat, handled by the cap below).
- **Cap = 5 registered chats.** Counts existing (backfilled) chats too — today 2 are
  allow-listed, so 3 free slots remain. On the 6th, the bot does **not** register —
  it replies with a **prefilled GitHub-issue link** (carrying the chatId + chat
  title) so the owner can enable it manually.
- **Owner enables an over-cap chat** with a one-off script: `npm run enable-chat --
  <chatId> [nome]` (upserts a row, bypasses the cap). No in-chat admin command, no
  `OWNER_USER_ID` — deferred.
- **Cost control (Layer 1): DROPPED during implementation.** Gating Gemini behind
  `hasBabySignal` would silently drop genuine keyword-less events (e.g. "credo abbia
  sporcato il pannolino" — a real poop Gemini catches today), so it trades away
  natural-language recall. The row-gate + 5-chat cap already bound Gemini cost to
  trusted chats; if it ever bites, a per-chat daily rate cap (recall-preserving) is
  the better lever. Gemini fallback is unchanged.
- **Cutover: straight swap.** Backfill existing chat(s) from `BABY_NAME` /
  `ALLOWED_CHAT_ID`, deploy, then remove both env vars (from project files here; the
  owner removes them from Vercel).
- **One baby per chat** — keeps the `one_open_session_per_chat` index. Twins out of
  scope.

## Non-goals (YAGNI)

- No timezone/language config, no i18n — `Europe/Rome` + Italian stay hardcoded.
- No multi-step wizard — one field doesn't justify a config state machine that fights
  the event parser. `/start [nome]` + `/nome <x>` cover it. A future `/config <key>
  <value>` generalizes if more fields arrive; not built now.
- No new `bot` interface method — the request-access link is a plain (auto-linked)
  URL in the message text, not an inline button, so no adapter surface is added.
- No in-chat admin command (`/enable`) and no owner-identity concept — the
  `enable-chat` script is enough.
- No per-chat rate limit / blocklist (Layer 3) — add only if abuse materializes.
- No speculative config columns — new fields = new migration, cheap.
- No change to `events` / `weights` / `pending_confirmations` schemas or queries.

## Storage approach (decision)

**New `chat_configs` table + `ChatConfigRepository` port**, mirroring exactly how
`weights` was added (dedicated table + port, one-module-per-concern). The data
layer is already `chat_id`-keyed everywhere, so this is purely additive.

### Migration — `chat_configs`

```
chat_configs
  chat_id         bigint  PRIMARY KEY
  baby_name       text    NULL
  created_by_name text    NULL      -- audit: who registered
  created_at      timestamptz NOT NULL DEFAULT NOW()
```

A **second migration enables RLS** on `chat_configs` (same pattern as
`migrations/1783300000000_enable-rls.js`: `ENABLE ROW LEVEL SECURITY`, no policy —
the bot uses the BYPASSRLS `postgres` role over direct SQL, so this only closes the
public PostgREST door). The existing RLS migration already ran, so this is a new
one, not an edit.

## Config additions (`src/config.ts`)

Two new fields, env-sourced with defaults (so tuning needs no code edit):

```ts
maxChats: number;        // MAX_CHATS, default 5
repoIssuesUrl: string;   // REPO_ISSUES_URL, default = the repo issues URL below
```

`repoIssuesUrl` default: `https://github.com/albertodeago/poppata-bot/issues`. The
owner is making the repo public so the prefilled-issue link works for anyone; the
env override exists only if the slug ever changes.

Removed at cutover: `babyName`, `allowedChatIds` (+ the `ALLOWED_CHAT_ID`
validation block).

## Mechanism

### `ChatConfigRepository` port + pg + memory adapters

Port (`src/domain/chatConfig.ts`), mirroring `weight.ts`:

```ts
export interface ChatConfig { chatId: number; babyName?: string; }

export interface ChatConfigRepository {
  get(chatId: number): Promise<Result<ChatConfig | null>>;
  count(): Promise<Result<number>>;
  create(input: { chatId: number; createdByName: string }): Promise<Result<ChatConfig>>;
  setBabyName(chatId: number, babyName: string): Promise<Result<ChatConfig>>;
  listAll(): Promise<Result<ChatConfig[]>>;
}
export interface ChatConfigEnv { chatConfigRepository: ChatConfigRepository; }
```

- **pg** (`src/adapters/pg/chatConfig.ts`): `create` = `INSERT ... ON CONFLICT
  (chat_id) DO NOTHING RETURNING *` then `get` fallback; `setBabyName` = `UPDATE`;
  `count` = `SELECT count(*)`; `listAll` = `SELECT * ORDER BY created_at`.
- **memory** (`src/adapters/memory/chatConfig.ts`): a `Map<number, ChatConfig>`, for
  `dev.ts` + tests.

### Wiring

- `src/env.ts`: construct `chatConfigRepository` (like the other pg repos) and add it
  to `Env`; pass it into `makeTelegrafAdapter` (needed by the gate).
- `src/dev.ts`: add the memory repo to the env object.
- `src/config.ts`: add `maxChats` / `repoIssuesUrl`.

### Register flow (domain) — `src/domain/registration.ts`

Shared by `/start` and the `my_chat_member` add-event:

```
register(chatId, createdByName, name?) (env):
  existing = get(chatId)
  if existing: (idempotent — no slot consumed)
     if name given → setBabyName; reply confirmation
     else → reply welcome + /nome hint
     return
  if count() >= maxChats:
     reply REGISTER_FULL (with prefilled-issue link)
     return
  create({chatId, createdByName})
  if name given → setBabyName
  reply welcome (+ name confirmation if set)
```

`describeIssueLink(chatId, chatTitle)` builds
`${repoIssuesUrl}/new?title=<enc>&body=<enc>` where body embeds the chat title +
`ChatId: <chatId>`. Both params URL-encoded. Telegram auto-links the URL.

### Commands (`src/domain/commands.ts`)

- **`startCommand`** rewritten: `(chatId, userName, arg, now?) => register(...)`. `arg`
  is the optional inline name from `/start Mario`.
- **`nomeCommand`**: `(chatId, userName, arg)` — `arg` empty ⇒ show current name (or
  hint); else `setBabyName` (registers first if somehow missing) and confirm.
- **`HELP_TEXT`**: add `/nome Mario — imposta il nome del bimbo/a`.

Copy (Italian):
- Welcome (fresh): `Ciao! 👋 Bot attivato in questa chat.` + `/nome` hint + `HELP_TEXT`.
- Name set: `👶 Nome impostato: <nome>` (or `aggiornato`).
- `/nome` no arg, name set: `👶 Nome attuale: <nome>`; unset: usage hint.
- Register full: `Mi dispiace, il bot ha raggiunto il numero massimo di chat (5).`
  + ` Richiedi l'attivazione qui: <url>`.

### Registration gate (`src/adapters/telegraf/bot.ts`)

Replace the `allowedChatIds` middleware with a **registration-aware** one:

```
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return next();
  const isStart = ctx.updateType === "message"
                  && ctx.message?.text?.startsWith("/start");
  const isHelp  = ctx.updateType === "message"
                  && ctx.message?.text?.startsWith("/help");
  const isAdd   = ctx.updateType === "my_chat_member";
  if (isStart || isHelp || isAdd) return next();   // entry points always pass
  const reg = await env.chatConfigRepository.get(chatId);
  if (!reg.success || !reg.data) return;           // unregistered: drop, no parse/Gemini
  return next();
});
```

One PK lookup per update for registered chats — acceptable. `makeTelegrafAdapter`
gains `ChatConfigEnv` in its arg type.

### Auto-welcome on add (`api/webhook.ts` + `api/setup.ts`)

- **`setup.ts`**: add `"my_chat_member"` to `allowed_updates` in `setWebhook`
  (otherwise Telegram never delivers the event). Re-run `/api/setup` after deploy.
- **`webhook.ts`**: `bot.on("my_chat_member", …)` — when the bot's new status is
  `member`/`administrator` (previously `left`/`kicked`), call `register(chatId,
  addedByName)` with the chat title for the issue link. Also register the new
  `bot.command("nome", …)`; keep `/start` calling the rewritten `startCommand`.

### Cron (`api/cron/report.ts`)

Replace `env.config.allowedChatIds` with `chatConfigRepository.listAll()`; per-chat
`babyName` comes from each row (not env). The stale-pending sweep is unchanged.

### Layer 1 — gate Gemini (DROPPED)

Not implemented. The premise ("keyword-less events are already ignored today") was
wrong — Gemini *does* catch them (proven by existing tests, e.g. "credo abbia
sporcato il pannolino"). Gating on `hasBabySignal` would regress natural-language
recall for a now-marginal saving (row-gate already limits Gemini to ≤`MAX_CHATS`
trusted chats). `handleMessage` is left unchanged.

### `enable-chat` script

`scripts/enable-chat.ts` + `package.json`: `"enable-chat": "tsx scripts/enable-chat.ts"`.
Loads `.env` (session pooler `DATABASE_URL`), reads `argv` (`<chatId> [nome]`),
upserts a `chat_configs` row (create + optional `setBabyName`), logs the result.
Bypasses the cap by construction (direct insert).

### Backfill / cutover (straight swap)

1. Migration or one-off: for each id in the current `ALLOWED_CHAT_ID`, insert a
   `chat_configs` row with `baby_name = BABY_NAME`.
2. Deploy (cron + gate now read the table).
3. Re-run `/api/setup` (registers `my_chat_member` + the `/nome` command).
4. Remove `BABY_NAME` / `ALLOWED_CHAT_ID` from `config.ts`, `.env.sample`, `README`.
   Owner removes them from Vercel.

## Tests

**`test/unit/adapters/memory/chatConfig.test.ts`** — create/get/setBabyName/count/
listAll; `create` idempotent on same chatId.

**`test/unit/domain/registration.test.ts`**
- Fresh chat under cap → row created, welcome sent.
- `/start Mario` → row + name set.
- Already-registered `/start` → no new row (count unchanged), greet.
- `count == maxChats`, new chat → no row; message contains the issue URL with the
  chatId embedded in it.

**`test/unit/domain/commands.test.ts`** — `nomeCommand`: set, overwrite, bare-`/nome`
shows current / hint.

**Gate** (`test/unit/adapters/telegraf/…` or a focused harness) — unregistered chat:
`/start` and `my_chat_member` pass; free text is dropped and the parser/Gemini is
**not** called. Registered chat: free text flows.

**Cron** (`test/unit/api/…` guard-style) — iterates `listAll()`; a chat with a name
gets the named header, one without gets the plain header.

**Layer 1** — dropped; no test. Existing `handleMessage` behaviour (Gemini on every
`confidence === 0`) is retained and its tests are unchanged.

## Docs

- `README.md`: drop `BABY_NAME` / `ALLOWED_CHAT_ID` from the env table and setup
  steps; document `/start`, `/nome`, the 5-chat cap + request-access flow, the
  `enable-chat` script, and `MAX_CHATS` / `REPO_ISSUES_URL`. Update "Single baby,
  single allow-listed group chat" line and the roadmap bullet.
- `.env.sample`: remove the two vars; add `MAX_CHATS` / `REPO_ISSUES_URL` (optional).

## Flows

```
add bot to group (slot free)  → auto-register + welcome + /nome hint
add bot to group (5 full)     → request-access message w/ prefilled issue link
/start          (registered)  → greet + help
/start Mario    (fresh)       → register + "Nome impostato: Mario"
/nome Gigi                    → "Nome impostato: Gigi" (aggiornato)
/nome           (name set)    → "Nome attuale: Gigi"
free text in unregistered chat → ignored (no parse, no Gemini)
cron                          → one report per row in chat_configs, name from row
npm run enable-chat -- -100…  → owner enables an over-cap chat
```

## Open questions

- None. Repo is being made public; `REPO_ISSUES_URL` defaults to
  `https://github.com/albertodeago/poppata-bot/issues`.
