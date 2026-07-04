# /scaletta Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/scaletta` command that shows today's events as a chronological timeline (one line per event) with a totals footer.

**Architecture:** A pure formatter `formatSchedule(events, window)` in `report.ts` renders a `<pre>`-wrapped timeline, reusing the existing `aggregate()` for the footer. A thin `scalettaCommand` in `commands.ts` fetches today's events via the existing `listSince` + `currentDayWindow` and sends the formatted text as HTML. Command handlers are registered in `api/webhook.ts` (Telegram) and `src/dev.ts` (console harness). No DB / schema / new-repository changes.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Luxon (`Europe/Rome`), Vitest, Telegraf.

## Global Constraints

- Node `>=24.0.0`; ESM — all local imports use the `.js` extension.
- Timezone is `Europe/Rome`; times formatted with `hhmm` → `H:mm` (e.g. `9:15`), durations with `formatDuration` → `25m` / `1h 50m`.
- Italian copy. Event labels come from `LABEL` (`eat→poppata`, `sleep→nanna`, `pee→pipì`, `poop→cacca`); breast side stored as `dx`/`sx`.
- Internal-error copy is exactly `Errore interno, riprova.` (const `INTERNAL_ERROR` in `commands.ts`).
- Telegram HTML supports no `<table>`; the timeline is monospace text inside `<pre>…</pre>`. Content uses only times, `→`, `·`, `⏳`, emoji and `dx`/`sx` — no `<`, `>`, `&` — so no HTML escaping is required.
- Run a single test file with `npx vitest run <path>` (optionally `-t "<name>"`). Full check: `npm run check`.

---

## File Structure

- `src/domain/report.ts` — **modify**: add `formatSchedule` + private `scheduleBody` helper. New imports: `hhmm`, `romeNow` (from `./time.js`); `LABEL`, `isOpenSession` (from `./event.js`).
- `src/domain/commands.ts` — **modify**: add `scalettaCommand`; add `formatSchedule` to the `./report.js` import; add one line to `HELP_TEXT`.
- `api/webhook.ts` — **modify**: import + register `bot.command("scaletta", …)`.
- `src/dev.ts` — **modify**: import + add `case "/scaletta":` to `runCommand`.
- `README.md` — **modify**: list `/scaletta` in the commands section.
- `test/unit/domain/report.test.ts` — **modify**: add `formatSchedule` tests.
- `test/unit/domain/commands.test.ts` — **modify**: add `scalettaCommand` tests.

---

## Task 1: `formatSchedule` timeline formatter

**Files:**
- Modify: `src/domain/report.ts`
- Test: `test/unit/domain/report.test.ts`

**Interfaces:**
- Consumes: `BabyEvent` (`src/domain/event.ts`), `TimeWindow` (`src/domain/time.ts`), existing `aggregate(events, window)` in this file.
- Produces: `formatSchedule(events: BabyEvent[], window: TimeWindow): string` — a `<pre>`-wrapped, newline-joined timeline; or a plain (unwrapped) `📋 …\n\nNessun evento ancora oggi.` when `events` is empty.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `test/unit/domain/report.test.ts` (the file already defines `d`, `window`, and `ev`; `formatSchedule` must be added to the existing import from `../../../src/domain/report.js`):

```ts
describe("[REPORT] formatSchedule", () => {
	it("says the day is empty when there are no events", () => {
		const text = formatSchedule([], window);
		expect(text).toContain("Scaletta di oggi");
		expect(text).toContain("Nessun evento ancora oggi.");
	});

	it("lists events chronologically with feed side, sleep range and totals", () => {
		const events: BabyEvent[] = [
			ev({ type: "poop", startedAt: d("2026-07-01T09:40:00+02:00") }),
			ev({
				type: "eat",
				side: "dx",
				startedAt: d("2026-07-01T09:10:00+02:00"),
				endedAt: d("2026-07-01T09:35:00+02:00"),
			}),
			ev({
				type: "sleep",
				startedAt: d("2026-07-01T07:10:00+02:00"),
				endedAt: d("2026-07-01T09:00:00+02:00"),
			}),
		];
		const text = formatSchedule(events, window);
		// sorted: 7:10 sleep, 9:10 eat, 9:40 poop
		const iSleep = text.indexOf("7:10→9:00");
		const iEat = text.indexOf("9:10→9:35");
		const iPoop = text.indexOf("cacca");
		expect(iSleep).toBeGreaterThan(-1);
		expect(iSleep).toBeLessThan(iEat);
		expect(iEat).toBeLessThan(iPoop);
		expect(text).toContain("🍼");
		expect(text).toContain("dx");
		expect(text).toContain("(25m)");
		expect(text).toContain("<pre>");
		expect(text).toContain("Totali:");
		expect(text).toContain("🍼 1");
		expect(text).toContain("💩 1");
	});

	it("shows an open session as in-progress and excludes it from totals", () => {
		const events: BabyEvent[] = [
			ev({ type: "sleep", startedAt: d("2026-07-01T10:05:00+02:00") }),
		];
		const text = formatSchedule(events, window);
		expect(text).toContain("da 10:05 ⏳");
		expect(text).toContain("😴 0m"); // open session not counted in the total
	});
});
```

Update the import at the top of the test file from:
```ts
import { aggregate, aggregateWeekly, formatDaily } from "../../../src/domain/report.js";
```
to add `formatSchedule`:
```ts
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
	formatSchedule,
} from "../../../src/domain/report.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/domain/report.test.ts -t "formatSchedule"`
Expected: FAIL — `formatSchedule is not a function` / not exported.

- [ ] **Step 3: Implement `formatSchedule`**

In `src/domain/report.ts`, update the imports at the top:
```ts
import { type BabyEvent, isOpenSession, LABEL } from "./event.js";
import { formatDuration, hhmm, romeNow, type TimeWindow } from "./time.js";
```
(Replaces the current `import type { BabyEvent } from "./event.js";` and the `formatDuration` / `TimeWindow` import from `./time.js`.)

Append at the end of the file:
```ts
/** Fixed-width label so the range column of eat/sleep rows lines up.
 *  Emoji cell width varies by client, so alignment is best-effort. */
const scheduleBody = (e: BabyEvent): string => {
	if (e.type === "pee") return `💧 ${LABEL.pee}`;
	if (e.type === "poop") return `💩 ${LABEL.poop}`;
	const icon = e.type === "eat" ? "🍼" : "😴";
	const side = e.type === "eat" && e.side ? ` ${e.side}` : "";
	const label = `${icon}${side}`.padEnd(6);
	if (isOpenSession(e)) return `${label} da ${hhmm(e.startedAt)} ⏳`;
	const end = e.endedAt as Date; // closed eat/sleep always has endedAt
	const dur = formatDuration(end.getTime() - e.startedAt.getTime());
	return `${label} ${hhmm(e.startedAt)}→${hhmm(end)} (${dur})`;
};

export const formatSchedule = (
	events: BabyEvent[],
	window: TimeWindow,
): string => {
	const header = `📋 Scaletta di oggi — ${romeNow(window.start).toFormat("d/M")}`;
	if (events.length === 0) {
		return `${header}\n\nNessun evento ancora oggi.`;
	}
	const rows = [...events]
		.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
		.map((e) => `${hhmm(e.startedAt).padStart(5)}  ${scheduleBody(e)}`);
	const s = aggregate(events, window);
	const footer = `Totali: 🍼 ${s.feedCount} · 😴 ${formatDuration(s.sleepMs)} · 💧 ${s.peeCount} · 💩 ${s.poopCount}`;
	return `<pre>${[header, "", ...rows, "", footer].join("\n")}</pre>`;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/domain/report.test.ts`
Expected: PASS (all report tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/domain/report.ts test/unit/domain/report.test.ts
git commit -m "feat: formatSchedule — today's events as a timeline"
```

---

## Task 2: `scalettaCommand` + /help entry

**Files:**
- Modify: `src/domain/commands.ts`
- Test: `test/unit/domain/commands.test.ts`

**Interfaces:**
- Consumes: `formatSchedule` (Task 1); existing `currentDayWindow`, `romeNow`, `INTERNAL_ERROR`, and `env.eventRepository.listSince`.
- Produces: `scalettaCommand(chatId: number, now: Date): (env: EventEnv & BotEnv & LoggerEnv) => Promise<void>` — fetches the current-day window and sends `formatSchedule(...)` with `{ parseMode: "HTML" }`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/domain/commands.test.ts`, add `scalettaCommand` to the import from `../../../src/domain/commands.js`, and add `error` to the import from `../../../src/domain/result.js` (currently only `success`):
```ts
import { error, success } from "../../../src/domain/result.js";
```

Append these tests (the file already defines the `feed(...)` helper and `makeTestEnv`):

```ts
describe("[COMMANDS] /scaletta", () => {
	it("HELP_TEXT lists the /scaletta command", () => {
		expect(HELP_TEXT).toContain("/scaletta");
	});

	it("sends today's events as an HTML timeline", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(
			success([
				feed("2026-07-02T08:00:00+02:00", "2026-07-02T08:30:00+02:00", "dx"),
			]),
		);
		await scalettaCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		const call = mocks.bot.sendMessage.mock.calls[0];
		const text = call?.[1] ?? "";
		expect(text).toContain("Scaletta di oggi");
		expect(text).toContain("8:00→8:30");
		expect(call?.[2]).toEqual({ parseMode: "HTML" });
		// today's window: [start of day, now)
		const listCall = mocks.eventRepository.listSince.mock.calls[0];
		expect(listCall?.[1]?.toISOString()).toBe(
			new Date("2026-07-02T00:00:00+02:00").toISOString(),
		);
		expect(listCall?.[2]?.toISOString()).toBe(
			new Date("2026-07-02T12:00:00+02:00").toISOString(),
		);
	});

	it("reports an internal error when the query fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(error(new Error("boom")));
		await scalettaCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Errore interno, riprova.",
		);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/domain/commands.test.ts -t "/scaletta"`
Expected: FAIL — `scalettaCommand is not a function` and HELP_TEXT missing `/scaletta`.

- [ ] **Step 3: Implement the command and help entry**

In `src/domain/commands.ts`, add `formatSchedule` to the existing `./report.js` import:
```ts
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
	formatSchedule,
	formatWeekly,
} from "./report.js";
```

Add one line to `HELP_TEXT`, right after the `/oggi · /ieri · /settimana` line:
```ts
	"/oggi · /ieri · /settimana — statistiche",
	"/scaletta — la giornata evento per evento",
```

Add the command (e.g. just after `statoCommand`, using the already-imported `currentDayWindow` and `romeNow`):
```ts
export const scalettaCommand =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const window = currentDayWindow(romeNow(now));
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: PASS (all command tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/domain/commands.ts test/unit/domain/commands.test.ts
git commit -m "feat: /scaletta command + help entry"
```

---

## Task 3: Wire `/scaletta` into the Telegram and console harnesses

**Files:**
- Modify: `api/webhook.ts`
- Modify: `src/dev.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `scalettaCommand` (Task 2).
- Produces: no new exports — registers the `/scaletta` handler in both entry points.

*(No unit test: these are harness registrations, verified by typecheck + full suite. Registration mirrors the existing `/oggi` wiring exactly.)*

- [ ] **Step 1: Register the Telegram command**

In `api/webhook.ts`, add `scalettaCommand` to the import from `../src/domain/commands.js` (keep alphabetical: after `pesoCommand`, before `senoCommand`), then register it next to the other stats commands (e.g. right after the `settimana` handler):
```ts
	bot.command("scaletta", async (ctx) => {
		await scalettaCommand(ctx.chat.id, new Date())(env);
	});
```

- [ ] **Step 2: Register the console command**

In `src/dev.ts`, add `scalettaCommand` to the import from `./domain/commands.js`, then add a case to the `runCommand` switch, mirroring `/oggi`:
```ts
		case "/scaletta":
			await scalettaCommand(DEV_CHAT_ID, now)(env);
			return true;
```

- [ ] **Step 3: Document the command in the README**

In `README.md`, find the commands list and add a `/scaletta` entry next to `/oggi` (match the surrounding format), e.g.:
```
- `/scaletta` — la giornata di oggi, evento per evento
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 5: Manual smoke test in the console harness (optional but recommended)**

Run: `npm run dev:local`, then type:
```
nanna 7.10
fine 9
poppata dx 9.10
fine 9.35
pipì
/scaletta
```
Expected: a `📋 Scaletta di oggi — …` block listing the nap, the feed (with `dx` and duration), the pipì, and a `Totali:` footer. Then Ctrl-C to exit.

- [ ] **Step 6: Commit**

```bash
git add api/webhook.ts src/dev.ts README.md
git commit -m "feat: wire /scaletta into webhook and dev harnesses; document it"
```

---

## Self-Review

- **Spec coverage:**
  - Timeline layout, `<pre>` wrapping, per-event rows sorted by start → Task 1.
  - Feed side, closed `start→end (dur)`, open `da HH:MM ⏳` → Task 1 (`scheduleBody`).
  - Footer totals via reused `aggregate` → Task 1.
  - Empty-day message + `d/M` header → Task 1.
  - `scalettaCommand` with `parseMode: "HTML"` reusing `listSince` + `currentDayWindow` → Task 2.
  - `/help` entry → Task 2. README → Task 3.
  - Webhook + dev wiring → Task 3.
  - Non-goals honored: no migration, no new bot interface method (uses `sendMessage`), so no `testEnv`/console-adapter change.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `formatSchedule(events, window)` signature identical across Task 1 (definition), Task 1 tests, and Task 2 (call site). `scalettaCommand(chatId, now)` identical across Task 2 and Task 3. `scheduleBody` is file-private (not exported), referenced only within Task 1.
