# Design: Ask breast side on feed start + destro/sinistro aliases

Date: 2026-07-03

## Goal

Two related additions to feed (`eat`) handling:

1. **Ask for the breast side when it is missing.** A feed *start* must never be
   persisted without a side. When the parsed intent is an `eat` start with no
   `side`, the bot pops two inline buttons (`Sinistro` / `Destro`) and completes
   the save when the user taps one.
2. **`destro` / `sinistro` aliases (input + output).** Accept the masculine
   forms as spoken input (alongside the existing `destra` / `sinistra`), and
   display `destro` / `sinistro` in per-event bot copy and button labels instead
   of the abbreviations `dx` / `sx`.

Storage stays canonical: the `Side` type and DB rows remain `dx` / `sx`. The
alias is purely a parsing-input and display concern.

## Scope decisions (confirmed with user)

- **Ask on every feed start** without a side — including after a "session already
  open" confirmation and a low-confidence Gemini confirmation. One invariant:
  *an `eat` start is never saved without a side.*
- **Reports stay compact** — the daily/weekly stat line keeps `dx N, sx N`
  (terse column labels; expanding them bloats the line). No change to `report.ts`.
- **Side-tap confirmation copy**: `Poppata iniziata alle 09:15 — seno destro ✅`.
- **Typed side, no time** (`poppata dx`): the existing "assumed start time" reply
  also echoes the side now, for consistency —
  `Poppata iniziata alle 09:15 — seno destro`. The quiet-👍 path (start *with* an
  explicit time) is unchanged — a reaction carries no text to echo into.

## Non-goals

- No DB migration; no change to the Gemini enum (`dx | sx | none`).
- No side concept for `sleep` / `pee` / `poop` / `end`.
- No "non so / skip" button — YAGNI.

## Mechanism

Reuse the existing pending-confirmation store. A side prompt is a pending row
holding the side-less intent; it is distinguished from a `conf`/`ann` prompt only
by the callback verb. No schema change (the intent JSON simply has no `side`).

Callback data is already generic (`verb:pendingId`, split on `:`), so the new
`dx:` / `sx:` button verbs need no adapter-routing changes — only rendering.

### Domain — `src/domain/`

**`event.ts`**
- Add `SIDE_LABEL: Record<Side, string> = { dx: "destro", sx: "sinistro" }`,
  beside `LABEL`.

**`parse.ts`**
- `SIDE_DX = /\b(dx|destra|destro|right)\b/`
- `SIDE_SX = /\b(sx|sinistra|sinistro|left)\b/`

**`bot.ts`**
- `BotEnv.bot` gains `sendSidePrompt(chatId, text, pendingId): Promise<void>`.
- `describeIntent`: push `SIDE_LABEL[intent.side]` instead of the raw `intent.side`.
- New `needsSide(intent)` = `intent.type === "eat" && intent.action === "start" && !intent.side`.
- New `promptSide(env, ctx, intent)`: create a pending storing the intent, then
  `sendSidePrompt(chatId, SIDE_PROMPT, pendingId)` with `SIDE_PROMPT = "Per quale seno? 🤱"`.
- Shared `startedText(intent)` formatter: `\`${cap(LABEL[type])} iniziata alle ${hhmm(at)}\``,
  plus ` — seno ${SIDE_LABEL[side]}` when a side is present. Used by:
  - `save()`'s no-explicit-time start branch.
  - the side-tap confirmation (which appends ` ✅`).
- `handleMessage`, `save` decision branch: `if (needsSide) promptSide(...) else save(...)`.
- `handleCallback`:
  - `conf` branch: if the confirmed intent `needsSide`, divert to `promptSide`
    (clears the confirm keyboard, deletes the confirm pending, answers callback),
    chaining open-session / low-confidence confirmations into the side prompt.
  - new `dx` / `sx` verbs: set `intent.side = verb`, `applyIntent` (which re-reads
    and auto-closes any open session as today), reply `startedText(intent) + " ✅"`,
    clear keyboard, delete pending, answer callback.

### Adapters / harness

**`adapters/telegraf/bot.ts`** — implement `sendSidePrompt`:
```
inline_keyboard: [[
  { text: "Sinistro", callback_data: `sx:${pendingId}` },
  { text: "Destro",   callback_data: `dx:${pendingId}` },
]]
```

**`adapters/console/bot.ts`** — implement `sendSidePrompt`: print
`[Sinistro] [Destro]`, set `lastPendingId` + `lastConfirmationMessageId`, hint
`→ scrivi "sx" o "dx"`.

**`src/dev.ts`**
- Accept `sx` / `dx` (alongside `conf` / `ann`) as button-sim inputs, sending
  `` `${verb}:${lastPendingId}` ``.
- Fix latent harness bug: it clears `lastPendingId` unconditionally after a
  callback, which would clobber a *new* prompt opened by that callback. Snapshot
  the id before the call and clear only if unchanged, so `conf → side-prompt → dx`
  chains locally.

**`test/unit/testEnv.ts`** — add `sendSidePrompt: vi.fn()` to the bot mock.

## Tests

- `parse.test.ts`: `poppata destro` → `side: "dx"`; `poppata sinistro` → `side: "sx"`.
- `bot.test.ts`:
  - Repurpose the `"poppata"` (no side, no time) test → now expects `sendSidePrompt`
    / pending created, **no** insert.
  - Feed start with time but no side (`inizio poppata 9.15`) → side prompt.
  - `dx:pX` callback → insert with `side: "dx"`, confirmation text contains
    `seno destro`, keyboard cleared, pending deleted.
  - `conf` of an open-session feed start → diverts to `sendSidePrompt`, no insert yet.
  - `describeIntent` / confirm copy shows `destro` (not `dx`). (Covered via a
    low-confidence eat-start confirm, or a direct `describeIntent` assertion.)
- `telegraf/bot.test.ts`: `sendSidePrompt` builds `sx:` / `dx:` inline buttons.
- Existing `inizio poppata dx 9.15` test (side given, with time) is unchanged —
  still a quiet 👍 save.

## Docs

- `README.md` dev section: add `sx` / `dx` to the button-sim command list and note
  the side prompt.
- `commands.ts` `/help`: light touch noting `destro` / `sinistro` are accepted and
  that the side is asked when omitted.

## Flows

```
"poppata dx 9.15"        → 👍 (unchanged; side given, time given)
"poppata dx"             → "Poppata iniziata alle HH:MM — seno destro" (side echoed; #3)
"poppata"                → [Sinistro][Destro] → tap → "… — seno destro ✅"
"poppata" (nanna open)   → confirm close+start → tap conf → [Sinistro][Destro] → tap
low-confidence "poppata" → "Ho capito: poppata…? Confermi?" → conf → [Sinistro][Destro] → tap
"poppata destro"         → 👍 / assumed-time reply (alias parsed to side dx)
```
