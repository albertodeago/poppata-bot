# Design: Type prompt (Poppata / Nanna) for a typeless start

Date: 2026-07-03

## Goal

When a message expresses a **start** but no recognizable **type**, ask which type
with two inline buttons instead of giving up.

- `inizio` (also `inizio 9.15`, `comincia`, `start`) → bot sends
  `Poppata o nanna? 🍼` with buttons `[Poppata] [Nanna]`.
- Tap **Nanna** → save a `sleep` start at the resolved time; reply
  `Nanna iniziata alle HH:MM ✅`.
- Tap **Poppata** → chain into the **existing** side prompt
  (`Per quale seno? 🤱 [Sinistro] [Destro]`, with the last-breast hint). Tapping a
  side saves the `eat` start — all existing code.

Today a typeless start falls through to Gemini and then `HELP_HINT`. This replaces
that outcome for start messages.

## Scope decisions (confirmed with user)

- **Trigger = any start with no type.** Fires whenever the rules parser yields
  `action: "start"` and no `type`. A given time is preserved into the chosen event
  (`inizio 9.15` → the eventual event starts at 09:15).
- **Skip Gemini.** The type prompt fires directly from the rules verdict, before
  the Gemini fallback: deterministic, and it works in local dev (no Gemini there).
  A start word with no type carries no type info for Gemini to recover anyway.
- **Copy**: prompt `Poppata o nanna? 🍼`; buttons `Poppata` / `Nanna` (no emoji on
  the buttons, matching `Sinistro` / `Destro`).

## Non-goals

- No DB migration; no schema change.
- No change to `parse.ts` (the rules parser already sets `action:"start"` for a
  bare start word).
- No `decide()` on the button path (an already-open session is auto-closed by
  `applyIntent`, no extra "sei sicuro?" — matches the `dx`/`sx` precedent).
- No third option / skip button — YAGNI.

## Mechanism

Reuse the pending-confirmation store, exactly like the side prompt. A type prompt
is a pending row holding a start intent; it is distinguished from `conf`/`ann` and
`dx`/`sx` only by the callback verb. Callback data stays generic
(`verb:pendingId`), so the new `eat:` / `sleep:` verbs need no adapter routing —
only rendering.

**Typeless intent, without widening `Intent`.** The pending requires a full
`Intent`, but `type` isn't known yet. Rather than make `Intent.type` optional
(which ripples through `newEventFrom`, `describeIntent`, `decide`, `needsSide`),
the type-prompt pending stores the intent with a **placeholder `type: "sleep"`
that the button verb authoritatively overwrites** — the callback always sets
`type` from the verb and never trusts the stored value. Nothing reads the pending
between creation and the tap, so the placeholder is never observed. (Same spirit
as the side prompt storing an intent whose `side` is still empty.) Verbs are the
`EventType` values `eat` / `sleep`, consistent with `dx` / `sx` being the `Side`
values.

### Domain — `src/domain/bot.ts`

- `BotEnv.bot` gains `sendTypePrompt(chatId, text, pendingId): Promise<void>`.
- New const `TYPE_PROMPT = "Poppata o nanna? 🍼"`.
- New `promptType(env, ctx, at)`: build the placeholder start intent
  `{ type: "sleep", action: "start", at, source: "rules", confidence: 1 }`, create
  a pending storing it, then `sendTypePrompt(chatId, TYPE_PROMPT, pendingId)`.
  (`confidence: 1` — the user picks explicitly, so no re-confirmation.)
- `handleMessage`: right after `parseRules` (before the Gemini block), add
  ```ts
  if (action === "start" && !type) {
    const at = (hasTime && hour !== undefined)
      ? resolveClock(arrival, hour, minute).toJSDate()
      : arrival.toJSDate();
    await promptType(env, ctx, at);   // ctx built as in the normal path
    return;
  }
  ```
  `fine` (`action:"end"`), `pipì`/`cacca` (`action:"instant"`), and bare numbers
  (`action:undefined`) are unaffected.
- `handleCallback`: new branch before the `conf` fallthrough:
  ```ts
  if (verb === "eat" || verb === "sleep") {
    const intent = { ...p.intent, type: verb };
    if (needsSide(intent)) {                 // eat with no side → chain to side prompt
      await promptSide(env, ctx, intent, cb.at);
      // clear old keyboard, delete type pending, answerCallback
      return;
    }
    // sleep → save directly
    applyIntent(intent, ctx) → sendMessage(`${startedText(intent)} ✅`)
    // clear keyboard, delete pending, answerCallback (same order as dx/sx branch)
  }
  ```

### Adapters / harness

**`adapters/telegraf/bot.ts`** — implement `sendTypePrompt`:
```
inline_keyboard: [[
  { text: "Poppata", callback_data: `eat:${pendingId}` },
  { text: "Nanna",   callback_data: `sleep:${pendingId}` },
]]
```

**`adapters/console/bot.ts`** — implement `sendTypePrompt`: print
`[Poppata] [Nanna]`, set `lastPendingId` + `lastConfirmationMessageId`, hint
`→ scrivi "eat" o "sleep"`.

**`src/dev.ts`** — add `"eat"` / `"sleep"` to the tap-intercept list (sent as
`` `${verb}:${lastPendingId}` ``). Quirk: this makes literal `sleep` a tap token,
not a nap message, in `dev:local` (use `nanna` / `dorme` for a nap). Minor.

**`test/unit/testEnv.ts`** — add `sendTypePrompt: vi.fn()` to the bot mock.

## Tests — `test/unit/domain/bot.test.ts`

- `inizio` → `sendTypePrompt` called, pending created, **`parser.parse` not
  called**, no help hint, no insert.
- `inizio 9.15` → stored pending intent `at` = 09:15.
- callback `sleep:pX` → insert a `sleep` start, reply `startedText ✅`, keyboard
  cleared, pending deleted.
- callback `eat:pX` → `sendSidePrompt` called (chained), old pending deleted, no
  insert yet; then `dx:` on the new pending inserts an `eat` start with
  `side: "dx"`.
- `telegraf/bot.test.ts`: `sendTypePrompt` builds `eat:` / `sleep:` inline buttons.

Existing tests (`inizio poppata dx 9.15`, `poppata`, `fine`, etc.) are unchanged —
those all have a type, so they skip the new branch.

## Docs

- `README.md` dev section: add `eat` / `sleep` to the button-sim command list and
  note the type prompt.
- `commands.ts` `/help`: light touch noting a bare `inizio` asks poppata vs nanna.

## Flows

```
"inizio"                 → [Poppata][Nanna] → Nanna → "Nanna iniziata alle HH:MM ✅"
"inizio"                 → [Poppata][Nanna] → Poppata → [Sinistro][Destro] → tap → "… ✅"
"inizio 9.15"            → [Poppata][Nanna] → chosen event starts at 09:15
"inizio poppata"         → [Sinistro][Destro] (unchanged; type known)
"inizio poppata dx 9.15" → 👍 (unchanged; type + side + time given)
"fine" / "pipì" / "9"    → unchanged (not a typeless start)
```
