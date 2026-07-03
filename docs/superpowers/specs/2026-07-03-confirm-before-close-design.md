# Design: Confirm before a start closes an open session (all paths)

Date: 2026-07-03

## Goal

Make session-close behavior **consistent across every entry path**: a *start* that
would close an already-open session must always ask first. Today only the
high-confidence text path (`poppata dx 9.15` → `decide()`) confirms; three paths
close silently.

**Guiding principle:** *a start never silently closes an open session.* Every
confirmation message states the full effect (including the close); tapping
**Conferma** always commits; a confirmed start replies with a text line.

## Background — the three silent-close paths

Only `decide()` in `handleMessage` inserts a "close the open one?" confirmation,
and it is reached only on the high-confidence text path. Everything else funnels a
start straight into `applyIntent`, whose start branch auto-closes any open session
with no prompt (`bot.ts:125-131`):

1. **`inizio` button flow** — `inizio` → tap type → [tap side] → save. `handleMessage`
   returns early (`bot.ts:435-448`) before `decide()`.
2. **`dx`/`sx` side tap** — `applyIntent` auto-closes, no mention.
3. **Low-confidence Gemini starts** — `handleMessage` asks *"Ho capito X. Confermi?"*
   (confirming the *interpretation*) and returns before `decide()` (`bot.ts:518-526`);
   tapping conferma then silently closes any open session.

Note: the silent close on the button path was an explicit non-goal of the
`inizio-type-prompt` design ("No `decide()` on the button path… matches the `dx`/`sx`
precedent"). This spec reverses that call.

## Scope decisions (confirmed with user)

- **Every close path** confirms — button flow, side taps, and low-confidence
  confirms. Full consistency, not just the button flow.
- **Confirm reply is a text line.** After a confirmed close+start the bot replies
  `Poppata/Nanna iniziata alle HH:MM ✅` (with ` — seno destro` for feeds), matching
  the non-collision button flow. This requires changing the shared `feedbackFor` so
  the **existing text-path** confirm also replies with the line instead of a 👍 —
  a small, consistency-improving change to a path beyond the button flow.
- **Gate at the type-tap**, not at the final commit. The type is known there, the
  confirm lands before drilling into side (cancelling wastes no side tap), and every
  downstream `dx`/`sx` path is then guaranteed already-confirmed.

## Non-goals

- No DB migration; no schema change.
- No change to `parse.ts`, `session.ts` (`decide` unchanged), or `applyIntent`.
- No adapter changes — `sendConfirmation` already exists.
- No richer "closed duration" copy on the confirm reply — YAGNI (a separate option
  was offered and declined).
- No change to `dx`/`sx` or `conf` branch **logic** — every path reaching them is
  now already-confirmed. (`conf`'s feedback changes only via `feedbackFor`.)

## Why gate at the type-tap (approaches considered)

`applyIntent` is the single writer that performs the close. Rather than push UI into
that pure writer, gate **before** it and reuse `decide()` + the pending-confirmation
store.

- **Gate at the final commit (after side selection)** — rejected: the confirm lands
  dead-last, after the user already tapped through side; cancelling wastes taps.
- **Generic "chiudere?" before the type prompt** — rejected: can't name the new type
  (`…e iniziare poppata?`) since it isn't chosen yet; adds a prompt.
- **Gate at the type-tap** — chosen: type is known, confirm precedes side, and all
  downstream taps inherit the confirmation.

## Mechanism

All changes are in `src/domain/bot.ts`.

### 1. `handleCallback` — gate the `eat`/`sleep` type branch through `decide`

Before saving, read the open session and run `decide`. A start over an open session
returns `confirm`; over nothing it returns `save`.

```ts
if (verb === "eat" || verb === "sleep") {
  const intent: Intent = { ...p.intent, type: verb };
  const openRes = await env.eventRepository.findOpenSession(ctx.chatId);
  if (!openRes.success) {
    env.logger.error("findOpenSession (type) failed", openRes.error);
    await env.bot.answerCallback(cb.id, "Errore");
    return;
  }
  const decision = decide(intent, openRes.data);
  if (decision.kind === "confirm") {
    await createPending(env, ctx, decision.intent, decision.warning);
    await env.bot.clearKeyboard(cb.chatId, cb.messageId);
    await env.pendingRepository.delete(p.id);
    await env.bot.answerCallback(cb.id);
    return;
  }
  // decision.kind === "save" (start over nothing) — today's behavior:
  if (needsSide(intent)) {           // eat, no side → chain to side prompt
    await promptSide(env, ctx, intent, cb.at);
    await env.bot.clearKeyboard(cb.chatId, cb.messageId);
    await env.pendingRepository.delete(p.id);
    await env.bot.answerCallback(cb.id);
    return;
  }
  const applied = await applyIntent(intent, ctx)(env);  // sleep → save directly
  if (!applied.success) { /* log + answerCallback("Errore") */ return; }
  await env.bot.sendMessage(ctx.chatId, `${startedText(intent)} ✅`);
  await env.bot.clearKeyboard(cb.chatId, cb.messageId);
  await env.pendingRepository.delete(p.id);
  await env.bot.answerCallback(cb.id);
  return;
}
```

`decide` never returns `error` here (that is `end`-only; this branch is always a
start) — handle defensively if convenient, but it is unreachable.

The `confirm` pending stores the resolved start intent (`eat` with no side, or
`sleep`). Tapping **Conferma** enters the existing `conf` branch:
- eat-no-side → `needsSide` true → `promptSide` → side tap → `applyIntent` closes+inserts → `startedText ✅`.
- sleep → `needsSide` false → `applyIntent` → `feedbackFor` → `startedText ✅` (see change 3).

### 2. `handleMessage` — augment the low-confidence confirm with the close notice

`open` is already fetched at `bot.ts:471-477`, before the low-confidence branch.

```ts
if (confidence < CONFIDENCE_MIN) {
  const closeNote =
    intent.action === "start" && open
      ? ` C'è già una ${LABEL[open.type]} aperta dalle ${hhmm(open.startedAt)}, la chiudo alle ${hhmm(intent.at)}.`
      : "";
  await createPending(
    env,
    ctx,
    intent,
    `Ho capito: ${describeIntent(intent)}.${closeNote} Confermi?`,
  );
  return;
}
```

`LABEL` and `hhmm` are already imported. `conf` commits exactly as today; the close
was surfaced in the message.

### 3. `feedbackFor` — text line for a confirmed start

```ts
const feedbackFor = async (env, p, closed) => {
  if (p.intent.action === "end" && closed?.endedAt) {
    await sendDurationReply(env, p.chatId, { ...closed, endedAt: closed.endedAt });
    return;
  }
  if (p.intent.action === "start") {
    await env.bot.sendMessage(p.chatId, `${startedText(p.intent)} ✅`);
    return;
  }
  await env.bot.react(p.chatId, p.messageId, "👍"); // instant
};
```

Starts reaching `feedbackFor` never `needSide` (eat-no-side is diverted to
`promptSide` first), so `startedText` renders the side when present. Instants
(confirmed low-confidence `pipì`/`cacca`) keep the 👍 reaction.

## Guarantee: no double-confirm, no remaining silent close

Every path that reaches a session-closing `applyIntent` has surfaced the close:

| Path to a start-commit | Close surfaced by |
| --- | --- |
| text `poppata dx 9.15` (open) | `decide` confirm (existing) |
| text `poppata` no side (open) → side tap | `decide` confirm before side (existing) |
| `inizio` → sleep tap (open) | new type-tap gate → confirm |
| `inizio` → eat tap (open) → side tap | new type-tap gate → confirm (before side) |
| low-confidence start (open) → [side tap] | augmented "Ho capito … la chiudo" message |
| any start, nothing open | nothing to close |

The freshly-read `findOpenSession` at the type-tap means a session opened *after* the
type prompt is now caught (stricter than before), and one closed in that window
correctly skips the confirm.

## Tests — `test/unit/domain/bot.test.ts`

- `inizio` with an open session → `sleep:pX` tap → `sendConfirmation` called with a
  close warning, **no insert**; the type pending is deleted, keyboard cleared.
  - follow-up `conf` on that pending → old session closed, `sleep` start inserted,
    reply `startedText ✅`.
- `inizio` with an open session → `eat:pX` tap → `sendConfirmation` (close warning),
  **no side prompt, no insert** yet.
  - `conf` → `sendSidePrompt`; then `dx:` → old session closed, `eat` start inserted
    with `side: "dx"`, reply `… ✅`.
- Regression guards (nothing open): `inizio` → `sleep:` saves directly; `inizio` →
  `eat:` → `sendSidePrompt` (both unchanged).
- Low-confidence start over an open session → confirm text contains `la chiudo`;
  `conf` closes the old session and commits.
- **Update** existing confirm-flow tests that assert the 👍 reaction after a
  confirmed *start* → now expect the `startedText` line (locate during
  implementation; `end`/`instant` confirm tests are unchanged).

## Docs

- `README.md` dev section: one line noting the button flow now asks before closing an
  open session.
- `commands.ts` `/help`: unchanged.

## Flows

```
inizio (nanna open) → [Poppata][Nanna] → Nanna
  → "C'è già una nanna aperta dalle 10:00. Chiuderla alle 10:30 e iniziare nanna? [Conferma][Annulla]"
  → Conferma → "Nanna iniziata alle 10:30 ✅"

inizio (nanna open) → [Poppata][Nanna] → Poppata
  → "C'è già una nanna aperta dalle 10:00. Chiuderla alle 10:30 e iniziare poppata? [Conferma][Annulla]"
  → Conferma → [Sinistro][Destro] → Destro → "Poppata iniziata alle 10:30 — seno destro ✅"

inizio (nothing open) → [type] → Nanna  → "Nanna iniziata … ✅"     (unchanged, no confirm)
inizio (nothing open) → [type] → Poppata → [side] → tap → "… ✅"    (unchanged)
low-confidence start (X open) → "Ho capito: … . C'è già una nanna aperta dalle 10:00, la chiudo alle 10:30. Confermi?"
poppata dx 9.15 (X open)      → "…chiuderla…?" → Conferma → "Poppata iniziata … ✅"  (reply now a text line, was 👍)
```
