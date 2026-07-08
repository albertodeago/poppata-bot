# Design: Per-chat toggle for scheduled reports

Date: 2026-07-08

## Goal

Let each chat turn **off** the reports the cron pushes on a schedule, and turn
them back on. Today `api/cron/report.ts` iterates every registered chat and sends
a **daily** report every day plus a **weekly** report on Mondays; there is no way
to opt out short of removing the chat.

One switch silences **all** scheduled reports (daily *and* weekly) for a chat.
On-demand commands (`/oggi`, `/ieri`, `/settimana`, `/scaletta`, `/grafici`) are
unaffected — this only governs the unsolicited, cron-pushed messages.

## Scope decisions (confirmed with user)

- **One toggle covers both daily and weekly.** Mental model: "stop the automatic
  messages". Not two independent switches.
- **Command mirrors `/nome`.** `/report on` enables, `/report off` disables, bare
  `/report` shows the current state. Explicit state, no flip ambiguity.
- **Default = enabled.** New column defaults to `true`; existing chats keep getting
  reports with no behaviour change until someone opts out.
- **Handler lives in `src/domain/registration.ts`**, next to `nomeCommand` — that
  module already owns the chat-config-touching commands.
- **Menu label:** `Report automatici on/off`.

## Non-goals (YAGNI)

- No separate daily/weekly toggles, no per-report-type granularity.
- No schedule/time customization.
- No new table — a single boolean column on the existing `chat_configs`.
- No admin/owner concept; anyone in the chat may toggle (same intra-family trust as
  `/nome`).

## Storage approach (decision)

**Add one boolean column to `chat_configs`** and filter in the cron loop. Mirrors
exactly how `baby_name` was added (dedicated field + repo method + `/nome`-style
command). Chosen over filtering in SQL (hides intent, harder to unit-test the
"skip disabled" behaviour) and over a separate prefs table (over-engineered for one
boolean).

### Migration — `add-report-toggle`

New file `migrations/<ts>_add-report-toggle.js` (do not edit an existing migration):

```js
export const up = (pgm) => {
  pgm.addColumn("chat_configs", {
    reports_enabled: { type: "boolean", notNull: true, default: true },
  });
};
export const down = (pgm) => {
  pgm.dropColumn("chat_configs", "reports_enabled");
};
```

Existing rows backfill to `true` via the column default — no data migration needed.

## Mechanism

### Domain port (`src/domain/chatConfig.ts`)

- `ChatConfig` gains `reportsEnabled: boolean` — **always present** (the column has a
  `NOT NULL DEFAULT`), so not optional like `babyName`.
- New repository method:

```ts
/** Enable/disable the scheduled (cron) reports for a chat. */
setReportsEnabled(chatId: number, enabled: boolean): Promise<Result<ChatConfig>>;
```

### pg adapter (`src/adapters/pg/chatConfig.ts`)

- `COLUMNS` → `"chat_id, baby_name, reports_enabled"`.
- `mapRow` maps `reports_enabled` → `reportsEnabled` (boolean straight through).
- `setReportsEnabled` mirrors `setBabyName`:

```sql
INSERT INTO chat_configs (chat_id, reports_enabled)
VALUES ($1, $2)
ON CONFLICT (chat_id) DO UPDATE SET reports_enabled = EXCLUDED.reports_enabled
RETURNING chat_id, baby_name, reports_enabled
```

- `create` is unchanged: it does not set `reports_enabled`, so the DB `DEFAULT true`
  applies, and the `RETURNING` (now including the column) reflects it.

### memory adapter (`src/adapters/memory/chatConfig.ts`)

- `create` sets `reportsEnabled: true` on the new row.
- Add `setReportsEnabled`.
- **Bug fix along the way:** the current `setBabyName` rebuilds the row as
  `{ chatId, babyName }`, which would now discard `reportsEnabled`. Change both
  setters to preserve sibling fields, e.g. read the existing row (default
  `reportsEnabled: true` if absent) and spread it:

```ts
setBabyName: async (chatId, babyName) => {
  const prev = byChat.get(chatId);
  const updated = { chatId, babyName, reportsEnabled: prev?.reportsEnabled ?? true };
  byChat.set(chatId, updated);
  return R.success(updated);
},
setReportsEnabled: async (chatId, enabled) => {
  const prev = byChat.get(chatId);
  const updated = {
    chatId,
    ...(prev?.babyName ? { babyName: prev.babyName } : {}),
    reportsEnabled: enabled,
  };
  byChat.set(chatId, updated);
  return R.success(updated);
},
```

`create` likewise keeps `reportsEnabled: true`. (Keep `babyName` optional in the
stored object so `get` matches the pg shape where an unset name is absent.)

### Command — `/report on|off` (`src/domain/registration.ts`)

New `reportCommand(chatId, arg)` next to `nomeCommand`, same `RegEnv`
(`ChatConfigEnv & BotEnv & LoggerEnv`) and same error handling:

```
reportCommand(chatId, arg)(env):
  cur = get(chatId)                     // internal error → INTERNAL_ERROR
  trimmed = arg.trim().toLowerCase()
  if trimmed == "":                     // show state
     reply cur.reportsEnabled ? REPORT_ON_STATE : REPORT_OFF_STATE
     return
  if trimmed is "on"/"off":
     set = setReportsEnabled(chatId, trimmed == "on")   // error → INTERNAL_ERROR
     reply trimmed=="on" ? REPORT_ENABLED : REPORT_DISABLED
     return
  reply REPORT_USAGE                    // unrecognized arg
```

Copy (Italian):

```
REPORT_ON_STATE  = "📊 Report automatici: attivi"
REPORT_OFF_STATE = "📊 Report automatici: disattivati"
REPORT_ENABLED   = "🔔 Report automatici riattivati."
REPORT_DISABLED  = "🔕 Report automatici disattivati."
REPORT_USAGE     = "Usa /report on oppure /report off."
```

Note on state when the row is unregistered: `/report` only reaches registered chats
(the telegraf gate lets through only `/start`, `/help`, and `my_chat_member` for
unregistered chats), so `cur` is always non-null here. Guard defensively anyway
(treat a missing row's state as enabled, matching the default).

### Wiring (`api/webhook.ts`)

Add alongside the other `bot.command(...)` handlers, stripping the prefix like
`/nome`:

```ts
bot.command("report", async (ctx) => {
  const arg = ctx.message.text.replace(/^\/report(@\S+)?\s*/, "");
  await reportCommand(ctx.chat.id, arg)(env);
});
```

Import `reportCommand` from `../src/domain/registration.js`.

### Help + menu

- `HELP_TEXT` (`src/domain/commands.ts`): add
  `"/report on|off — attiva/disattiva i report automatici"` in the Comandi block.
- `COMMANDS` (`api/setup.ts`): add
  `{ command: "report", description: "Report automatici on/off" }`.

### Cron (`api/cron/report.ts`)

Inside the `for (const chat of chats)` loop, skip disabled chats before sending:

```ts
if (!chat.reportsEnabled) {
  env.logger.info(`Cron: skipping chat ${chat.chatId} (reports disabled)`);
  continue;
}
```

`listAll()` still returns every chat (its meaning is unchanged); the skip is
explicit at the call site. The stale-pending sweep after the loop is unchanged and
still runs regardless of per-chat toggles.

## Tests

**`test/unit/adapters/memory/chatConfig.test.ts`**
- new row from `create` has `reportsEnabled === true`.
- `setReportsEnabled(false)` then `get` → `false`; `setReportsEnabled(true)` → `true`.
- `setBabyName` preserves an existing `reportsEnabled` (regression for the wipe bug).
- `setReportsEnabled` preserves an existing `babyName`.

**`test/unit/adapters/pg/chatConfig.test.ts`**
- `mapRow`/query returns `reportsEnabled` from the `reports_enabled` column.
- `setReportsEnabled` issues the upsert and returns the mapped row.

**`test/unit/domain/registration.test.ts`** (or the commands test, wherever
`nomeCommand` is tested)
- `/report` bare → state message reflects `reportsEnabled`.
- `/report off` → `setReportsEnabled(id, false)` called; disabled reply.
- `/report on` → `setReportsEnabled(id, true)` called; enabled reply.
- `/report pippo` → usage hint; no `setReportsEnabled` call.

**`test/unit/api/cron/report.test.ts`**
- a chat with `reportsEnabled === false` receives **no** daily and **no** weekly
  report; an enabled chat still does. (Assert via the bot/report spies already used
  by the existing cron test.)

## Docs

- `README.md`: document `/report on|off` in the commands list and note that
  scheduled reports can be turned off per chat (default on).

## Flows

```
/report            (enabled)   → "📊 Report automatici: attivi"
/report            (disabled)  → "📊 Report automatici: disattivati"
/report off                    → "🔕 Report automatici disattivati." + cron skips this chat
/report on                     → "🔔 Report automatici riattivati."  + cron resumes
/report qualcosa               → "Usa /report on oppure /report off."
cron, chat disabled            → no daily, no weekly for that chat (others unaffected)
existing chat (pre-migration)  → reports_enabled defaults true → unchanged behaviour
```

## Deploy

1. Run the migration (adds `reports_enabled`, backfills `true`).
2. Deploy (cron now reads + honours the column; `/report` handler live).
3. Re-run `/api/setup` to refresh the Telegram command menu (adds `/report`).
   No `allowed_updates` change — `/report` is a plain message command.

## Open questions

- None.
