# Design: `/scaletta` — today's rundown, event by event

Date: 2026-07-04

## Goal

A `/scaletta` command that lists **today's** events in chronological order, one
line per event — a diary of the day, complementing the aggregate `/oggi`.

Chosen layout: **timeline** (one line per event), not an HTML grid. Telegram HTML
has no `<table>` (only `b/i/u/s/code/pre/a/blockquote`); a wide 7-column grid would
force horizontal scroll on a phone. The timeline reads top-to-bottom, fits phone
width, and degrades gracefully as the day fills up.

Example output (rendered inside a `<pre>` block):

```
📋 Scaletta di oggi — 4/7

 6:30  🍼 sx   6:30→6:55   (25m)
 7:10  😴      7:10→9:00   (1h 50m)
 8:15  💧 pipì
 9:10  🍼 dx   9:10→9:35   (25m)
 9:40  💩 cacca
10:05  😴      da 10:05 ⏳

Totali: 🍼 2 · 😴 1h 50m · 💧 1 · 💩 1
```

Empty day:

```
📋 Scaletta di oggi — 4/7

Nessun evento ancora oggi.
```

## Scope decisions (confirmed with user)

- **Timeline, not grid** (layout B). Sketches A (full 7-col grid) and C (narrow
  grid) were rejected as phone-hostile.
- **One row per event, anchored at `startedAt`, sorted ascending.** A closed
  eat/sleep is a single row showing `start→end (dur)` — the start also appears in
  the leading time column (chronological anchor). This duplication was reviewed and
  accepted; it keeps the leading column a clean sortable timeline.
- **Open sessions** render `da HH:MM ⏳` (no end, no duration).
- **Footer** = the same aggregate numbers `/oggi` already computes:
  `🍼 <feedCount> · 😴 <sleepDur> · 💧 <peeCount> · 💩 <poopCount>`.
- **Header** shows the date compactly as `d/M` (e.g. `4/7`) — no locale/ICU
  dependency (avoids Italian month-name formatting). "oggi" already carries the
  meaning; the date is a small confirmation.

## Non-goals

- No DB migration, no schema change, no new repository method — reuses `listSince`.
- No new `bot` interface method — `/scaletta` sends via existing `sendMessage`
  (so no console-adapter or `testEnv` change).
- No `/scaletta-ieri` or date argument — YAGNI. Today only.
- No open-session warning footer (unlike `/oggi`'s `openExcluded` note) — the open
  row is already visible in the list with `⏳`.

## Mechanism

### `src/domain/report.ts` — new `formatSchedule`

```ts
export const formatSchedule = (
  events: BabyEvent[],
  window: TimeWindow,
): string
```

- Header: `📋 Scaletta di oggi — ${romeNow(window.start).toFormat("d/M")}`.
- Sort `events` by `startedAt` ascending (don't trust repo order).
- If empty → header + blank line + `Nessun evento ancora oggi.`
- One line per event. Leading time = `hhmm(e.startedAt)`, right-aligned via
  `padStart(5)` (covers `10:05` and ` 6:30`). Body by type:
  - `eat`: `🍼 <side>` where side is `dx`/`sx`/`` (empty if unset), then
    - closed: `${hhmm(start)}→${hhmm(end)} (${formatDuration(end-start)})`
    - open (`isOpenSession`): `da ${hhmm(start)} ⏳`
  - `sleep`: `😴` (no side), same closed/open session part as eat.
  - `pee`: `💧 pipì`  ·  `poop`: `💩 cacca` (labels from `LABEL`).
- Footer: blank line, then
  `Totali: 🍼 ${s.feedCount} · 😴 ${formatDuration(s.sleepMs)} · 💧 ${s.peeCount} · 💩 ${s.poopCount}`
  where `s = aggregate(events, window)` (reused, not recomputed).
- Wrap the whole body in `<pre>…</pre>`. Content contains only times, `→`, `·`,
  `⏳`, emoji and `dx/sx` — no `<`, `>`, `&` — so **no HTML escaping needed**.

Imports already in `report.ts`: `BabyEvent`, `TimeWindow`, `formatDuration`.
Adds: `hhmm`, `romeNow` (from `time.ts`); `LABEL`, `isOpenSession` (from
`event.ts`); `aggregate` is already defined in this file.

### `src/domain/commands.ts` — new `scalettaCommand`

Mirrors `dailyReport`, but calls `formatSchedule` and sends with `parseMode: "HTML"`
(the `<pre>` wrapper):

```ts
export const scalettaCommand =
  (chatId: number, now: Date) =>
  async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
    const window = currentDayWindow(romeNow(now));
    const evs = await env.eventRepository.listSince(chatId, window.start, window.end);
    if (!evs.success) {
      env.logger.error("scaletta: listSince failed", evs.error);
      await env.bot.sendMessage(chatId, INTERNAL_ERROR);
      return;
    }
    await env.bot.sendMessage(chatId, formatSchedule(evs.data, window), {
      parseMode: "HTML",
    });
  };
```

`currentDayWindow` and `romeNow` are already imported; add `formatSchedule` to the
`./report.js` import.

### `HELP_TEXT` (commands.ts)

Add one line under **Comandi**, right after the stats line:

```
/scaletta — la giornata evento per evento
```

### Harness wiring

- **`api/webhook.ts`**: import `scalettaCommand`; add
  ```ts
  bot.command("scaletta", async (ctx) => {
    await scalettaCommand(ctx.chat.id, new Date())(env);
  });
  ```
- **`src/dev.ts`**: import `scalettaCommand`; add `case "/scaletta":` to
  `runCommand`, mirroring `/oggi`.

## Tests

**`test/unit/domain/report.test.ts`** — new `describe("formatSchedule")`:

- Empty events → contains `Nessun evento ancora oggi.`
- Mixed day (closed eat with side, closed sleep, pee, poop) → lines in `startedAt`
  order; eat line shows `dx`/`sx` and `start→end (dur)`; pee/poop show labels;
  footer counts match.
- Open session → its row shows `da HH:MM ⏳` and no duration; footer sleep total
  excludes it (via `aggregate`'s `openExcluded` path).
- Unsorted input → output is sorted by `startedAt`.

**`test/unit/domain/commands.test.ts`** — `scalettaCommand`:

- Calls `listSince` with the current-day window; sends the `formatSchedule` output
  with `parseMode: "HTML"`.
- `listSince` failure → `INTERNAL_ERROR`, error logged.

## Docs

- **`README.md`** dev/commands section: add `/scaletta` to the command list.

## Flows

```
/scaletta (events today)   → 📋 timeline + Totali footer
/scaletta (no events yet)  → 📋 header + "Nessun evento ancora oggi."
/scaletta (open nap)       → open row "da HH:MM ⏳"; nap excluded from footer total
```
