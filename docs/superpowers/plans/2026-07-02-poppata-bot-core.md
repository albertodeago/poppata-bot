# poppata-bot Core (Plan 1: local-runnable domain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure domain core of poppata-bot (parser, time resolver, session rules, reports, bot use-cases) plus in-memory adapters and a `dev:local` stdin harness — a fully testable bot you can drive from the terminal with zero cloud setup.

**Architecture:** Hexagonal / ports-and-adapters, mirroring the `wehimanbot` reference. Domain use-cases are curried pure functions `(command) => (env) => Promise<Result<...>>`. Errors flow through `Result<T,E>` — never thrown. This plan implements only the domain + in-memory/console adapters + stdin harness. Production wiring (pg/Supabase, telegraf, Gemini REST, Vercel webhook + cron) is Plan 2.

**Tech Stack:** TypeScript (strict), Node ≥ 24, luxon (Europe/Rome time), Vitest (tests), Biome (lint/format). No network/DB in this plan.

## Global Constraints

- **Node** ≥ 24.0.0 (`engines.node`).
- **TypeScript** `strict: true` **and** `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals/Parameters: true`. Never assign `undefined` to an optional prop — conditionally spread it: `...(side ? { side } : {})`.
- **Module system:** `"module": "nodenext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`. Relative imports are extensionless in source (Biome/tsc `nodenext` resolves `.ts`); match the reference which imports `./result` without extension.
- **Biome:** tab indentation, double quotes. Run `npm run lint:apply` before every commit.
- **Errors:** return `Result<T,E>` (`success(data)` / `error(e)`); do not throw across domain boundaries. Adapters wrap I/O in `tryCatch`.
- **Timezone:** `Europe/Rome` is a code constant (`ZONE` in `src/domain/time.ts`), never an env var.
- **Env var names (spec):** `BOT_TOKEN`, `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ALLOWED_CHAT_ID`, `CRON_SECRET`, `WEBHOOK_URL`, `BABY_NAME`, `DEV_BOT_TOKEN`. (None are required by this plan; they land in Plan 2.)
- **Entity naming:** the activity entity is `BabyEvent` (not `Event`, to avoid clashing with the DOM global).
- **Tests:** domain exercised against in-memory adapters / direct pure-function calls. No DB, no network.
- **Italian copy:** user-facing strings are Italian, verbatim as written in each task.

---

## File Structure (this plan)

```
package.json, tsconfig.json, tsconfig.build.json, biome.json, vitest.config.mts, .gitignore, .env.sample
src/
  domain/
    result.ts      # Result<T,E> (verbatim from reference)
    logger.ts      # LoggerEnv port
    time.ts        # ZONE, resolveClock (am/pm-nearest), day/week windows, hhmm, formatDuration
    event.ts       # BabyEvent entity, EventType/Side/EventSource, EventRepository port, isOpenSession
    parse.ts       # Intent/Action, ParsedTokens, ParserEnv port, normalize, parseRules
    pending.ts     # PendingConfirmation entity, PendingRepository port
    session.ts     # decide(): pure save/confirm/error decision from intent + open session
    report.ts      # aggregate/aggregateWeekly + formatDaily/formatWeekly (pure)
    bot.ts         # BotEnv port, Incoming types, applyIntent, handleMessage, handleCallback, commands, reports
  adapters/
    memory/event.ts    # in-memory EventRepository
    memory/pending.ts  # in-memory PendingRepository
    console/logger.ts  # console logger
    console/bot.ts     # BotEnv impl printing to terminal (+ mutable state for the harness)
    noop/parser.ts     # ParserEnv stub (no Gemini): always returns success(null)
  dev.ts           # stdin harness wiring console bot + memory repos + noop parser
test/unit/
  testEnv.ts
  domain/{time,parse,session,report,bot}.test.ts
  adapters/memory/{event,pending}.test.ts
```

---

### Task 1: Scaffold + Result/Logger foundation

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `biome.json`, `vitest.config.mts`, `.gitignore`, `.env.sample`
- Create: `src/domain/result.ts`, `src/domain/logger.ts`
- Test: `test/unit/domain/result.test.ts`

**Interfaces:**
- Produces: `Result<T,E>`, `success`, `error`, `tryCatch` (from `result.ts`); `LoggerEnv` (from `logger.ts`). Every later task consumes these.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "poppata-bot",
  "version": "0.1.0",
  "description": "Telegram bot to track an infant's activities from natural-language messages",
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "dev:local": "tsx src/dev.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "biome check",
    "lint:apply": "biome check --write",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint:apply && npm run typecheck && npm run test"
  },
  "license": "ISC",
  "dependencies": {
    "luxon": "^3.5.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.2.5",
    "@types/luxon": "^3.4.2",
    "@types/node": "^24.1.0",
    "@vitest/coverage-v8": "3.2.4",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3",
    "vitest": "3.2.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "NodeNext",
    "baseUrl": "./",
    "outDir": "./dist",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "allowUnreachableCode": false,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "vitest.config.mts"]
}
```

- [ ] **Step 3: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["test"]
}
```

- [ ] **Step 4: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.2.5/schema.json",
  "vcs": { "enabled": false, "clientKind": "git", "useIgnoreFile": false },
  "files": { "ignoreUnknown": false, "includes": ["src/**/*.ts", "test/**/*.ts"] },
  "formatter": { "enabled": true, "indentStyle": "tab" },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double" } },
  "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 5: Create `vitest.config.mts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
		},
	},
});
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
```

- [ ] **Step 7: Create `.env.sample`** (documents Plan-2 vars; unused here)

```
# Telegram
BOT_TOKEN=
ALLOWED_CHAT_ID=
# Supabase (pooled/pgbouncer, port 6543)
DATABASE_URL=
# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
# Vercel cron
CRON_SECRET=
WEBHOOK_URL=
# Optional
BABY_NAME=
DEV_BOT_TOKEN=
```

- [ ] **Step 8: Create `src/domain/result.ts`** (verbatim from the reference)

```ts
export type Result<T, E = Error> =
	| { success: true; data: T }
	| { success: false; error: E };

export const error = <T = unknown, E = Error>(error: E): Result<T, E> => ({
	success: false,
	error,
});

export const success = <T, E = Error>(data: T): Result<T, E> => ({
	success: true,
	data,
});

export const tryCatch = async <T, E = Error>(
	fn: () => T | Promise<T>,
	onError: (e: Error) => E,
): Promise<Result<T, E>> => {
	try {
		const result = await fn();
		return success(result);
	} catch (e) {
		return error(onError(toError(e)));
	}
};

function isErrorWithMessage(error: unknown): error is Error {
	return (
		typeof error === "object" &&
		error instanceof Error &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	);
}

function toError(maybeError: unknown): Error {
	if (isErrorWithMessage(maybeError)) return maybeError;
	if (typeof maybeError === "string") return new Error(maybeError);
	return new Error(JSON.stringify(maybeError));
}
```

- [ ] **Step 9: Create `src/domain/logger.ts`**

```ts
export interface LoggerEnv {
	readonly logger: Pick<
		typeof console,
		"info" | "warn" | "error" | "debug" | "log"
	>;
}
```

- [ ] **Step 10: Create `test/unit/domain/result.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { error, success, tryCatch } from "../../../src/domain/result";

describe("[RESULT]", () => {
	it("success wraps data", () => {
		const r = success(42);
		expect(r).toEqual({ success: true, data: 42 });
	});

	it("error wraps an error", () => {
		const e = new Error("boom");
		const r = error(e);
		expect(r).toEqual({ success: false, error: e });
	});

	it("tryCatch returns success for a resolving fn", async () => {
		const r = await tryCatch(async () => "ok", (e) => e);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe("ok");
	});

	it("tryCatch maps a thrown error", async () => {
		const r = await tryCatch(
			() => {
				throw new Error("nope");
			},
			(e) => e,
		);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("nope");
	});
});
```

- [ ] **Step 11: Install deps + init git**

Run:
```bash
cd /Users/albertodeagostini/sources/personal/poppata-bot
npm install
git init
```
Expected: install completes; `Initialized empty Git repository`.

- [ ] **Step 12: Verify typecheck + tests pass**

Run: `npm run lint:apply && npm run typecheck && npx vitest run test/unit/domain/result.test.ts`
Expected: Biome writes/format OK, `tsc --noEmit` exits 0, 4 tests PASS.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold poppata-bot core + Result/Logger foundation"
```

---

### Task 2: Time helpers (`src/domain/time.ts`)

**Files:**
- Create: `src/domain/time.ts`
- Test: `test/unit/domain/time.test.ts`

**Interfaces:**
- Consumes: nothing (luxon only).
- Produces:
  - `ZONE = "Europe/Rome"`
  - `interface TimeWindow { start: Date; end: Date }`
  - `romeNow(at: Date): DateTime`
  - `resolveClock(arrival: DateTime, hour: number, minute: number): DateTime` — am/pm-nearest resolver
  - `hhmm(at: Date): string` — `"H:mm"` in Rome
  - `formatDuration(ms: number): string` — `"1h 20m"` / `"45m"` / `"2h"` / `"0m"`
  - `currentDayWindow(now: DateTime): TimeWindow` — `[todayStart, now]`
  - `previousDayWindow(now: DateTime): TimeWindow` — yesterday `[00:00, 24:00)`
  - `currentWeekWindow(now: DateTime): TimeWindow` — `[weekStart(Mon), now]`
  - `previousWeekWindow(now: DateTime): TimeWindow` — previous ISO week `[Mon, next Mon)`

- [ ] **Step 1: Write the failing test** — `test/unit/domain/time.test.ts`

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	currentDayWindow,
	formatDuration,
	hhmm,
	previousDayWindow,
	previousWeekWindow,
	resolveClock,
	romeNow,
	ZONE,
} from "../../../src/domain/time";

const rome = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

describe("[TIME] resolveClock", () => {
	it("morning arrival, bare hour 9 -> 09:00 same day", () => {
		const arrival = rome("2026-07-02T09:30");
		const r = resolveClock(arrival, 9, 15);
		expect(r.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-07-02 09:15");
	});

	it("evening arrival, bare hour 9 -> 21:00 (pm nearest)", () => {
		const arrival = rome("2026-07-02T20:50");
		const r = resolveClock(arrival, 9, 0);
		expect(r.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-07-02 21:00");
	});

	it("hour >= 13 taken as 24h", () => {
		const arrival = rome("2026-07-02T09:00");
		const r = resolveClock(arrival, 22, 0);
		expect(r.toFormat("HH:mm")).toBe("22:00");
	});

	it("just-after-midnight arrival, '23:50' resolves to previous day", () => {
		const arrival = rome("2026-07-03T00:20");
		const r = resolveClock(arrival, 23, 50);
		expect(r.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-07-02 23:50");
	});
});

describe("[TIME] formatDuration", () => {
	it("minutes only", () => expect(formatDuration(45 * 60_000)).toBe("45m"));
	it("hours and minutes", () =>
		expect(formatDuration(80 * 60_000)).toBe("1h 20m"));
	it("whole hours", () => expect(formatDuration(120 * 60_000)).toBe("2h"));
	it("zero", () => expect(formatDuration(0)).toBe("0m"));
});

describe("[TIME] hhmm", () => {
	it("formats a Date in Rome as H:mm", () => {
		const d = rome("2026-07-02T09:05").toJSDate();
		expect(hhmm(d)).toBe("9:05");
	});
});

describe("[TIME] windows", () => {
	it("previousDayWindow is yesterday 00:00..today 00:00", () => {
		const now = romeNow(rome("2026-07-02T09:00").toJSDate());
		const w = previousDayWindow(now);
		expect(DateTime.fromJSDate(w.start).setZone(ZONE).toISO()).toContain(
			"2026-07-01T00:00",
		);
		expect(DateTime.fromJSDate(w.end).setZone(ZONE).toISO()).toContain(
			"2026-07-02T00:00",
		);
	});

	it("currentDayWindow ends at now", () => {
		const nowJs = rome("2026-07-02T09:30").toJSDate();
		const w = currentDayWindow(romeNow(nowJs));
		expect(w.end.getTime()).toBe(nowJs.getTime());
		expect(DateTime.fromJSDate(w.start).setZone(ZONE).toFormat("HH:mm")).toBe(
			"00:00",
		);
	});

	it("previousWeekWindow spans the prior Monday..Monday (ISO)", () => {
		// 2026-07-02 is a Thursday; previous ISO week = Mon 2026-06-22 .. Mon 2026-06-29
		const now = romeNow(rome("2026-07-02T09:00").toJSDate());
		const w = previousWeekWindow(now);
		expect(DateTime.fromJSDate(w.start).setZone(ZONE).toFormat("yyyy-MM-dd")).toBe(
			"2026-06-22",
		);
		expect(DateTime.fromJSDate(w.end).setZone(ZONE).toFormat("yyyy-MM-dd")).toBe(
			"2026-06-29",
		);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/time.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/time`.

- [ ] **Step 3: Implement `src/domain/time.ts`**

```ts
import { DateTime } from "luxon";

export const ZONE = "Europe/Rome";

export interface TimeWindow {
	start: Date;
	end: Date;
}

export const romeNow = (at: Date): DateTime =>
	DateTime.fromJSDate(at).setZone(ZONE);

/**
 * Resolve a bare clock time to the absolute instant nearest to `arrival`
 * (am/pm disambiguation). hour >= 13 is taken as 24h; hour 0..12 also
 * considers the +12 candidate. Candidates are generated on the arrival day
 * and its neighbours; the nearest to arrival wins.
 */
export const resolveClock = (
	arrival: DateTime,
	hour: number,
	minute: number,
): DateTime => {
	const hours = hour >= 13 ? [hour] : [hour, hour + 12];
	const base = arrival.setZone(ZONE).startOf("day");

	let best = base;
	let bestDiff = Number.POSITIVE_INFINITY;
	for (const off of [-1, 0, 1]) {
		for (const h of hours) {
			const cand = base.plus({ days: off, hours: h, minutes: minute });
			const diff = Math.abs(cand.toMillis() - arrival.toMillis());
			if (diff < bestDiff) {
				bestDiff = diff;
				best = cand;
			}
		}
	}
	return best;
};

export const hhmm = (at: Date): string =>
	DateTime.fromJSDate(at).setZone(ZONE).toFormat("H:mm");

export const formatDuration = (ms: number): string => {
	const totalMin = Math.round(ms / 60_000);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	return `${m}m`;
};

export const currentDayWindow = (now: DateTime): TimeWindow => ({
	start: now.setZone(ZONE).startOf("day").toJSDate(),
	end: now.toJSDate(),
});

export const previousDayWindow = (now: DateTime): TimeWindow => {
	const start = now.setZone(ZONE).startOf("day").minus({ days: 1 });
	return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
};

export const currentWeekWindow = (now: DateTime): TimeWindow => ({
	start: now.setZone(ZONE).startOf("week").toJSDate(),
	end: now.toJSDate(),
});

export const previousWeekWindow = (now: DateTime): TimeWindow => {
	const start = now.setZone(ZONE).startOf("week").minus({ weeks: 1 });
	return { start: start.toJSDate(), end: start.plus({ weeks: 1 }).toJSDate() };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/time.test.ts`
Expected: PASS (all cases). Note: Luxon `startOf("week")` is Monday (ISO).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: time helpers (Rome zone, am/pm resolver, windows, duration)"
```

---

### Task 3: Event entity + repository port (`src/domain/event.ts`)

**Files:**
- Create: `src/domain/event.ts`
- Test: `test/unit/domain/event.test.ts`

**Interfaces:**
- Consumes: `Result` from `./result`.
- Produces:
  - `type EventType = "eat" | "sleep" | "pee" | "poop"`
  - `type Side = "dx" | "sx"`
  - `type EventSource = "rules" | "gemini"`
  - `interface BabyEvent { id; chatId; userId; userName; type; side?; startedAt; endedAt?; source; rawText; messageId; createdAt }`
  - `type NewBabyEvent = Omit<BabyEvent, "id" | "createdAt">`
  - `interface EventRepository { insert; findOpenSession; closeSession; deleteLast; listSince }`
  - `interface EventEnv { eventRepository: EventRepository }`
  - `isOpenSession(e: BabyEvent): boolean`

- [ ] **Step 1: Write the failing test** — `test/unit/domain/event.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { type BabyEvent, isOpenSession } from "../../../src/domain/event";

const base: BabyEvent = {
	id: "1",
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: new Date(),
	source: "rules",
	rawText: "poppata",
	messageId: 1,
	createdAt: new Date(),
};

describe("[EVENT] isOpenSession", () => {
	it("open eat/sleep with no endedAt is an open session", () => {
		expect(isOpenSession({ ...base, type: "eat" })).toBe(true);
		expect(isOpenSession({ ...base, type: "sleep" })).toBe(true);
	});

	it("closed session is not open", () => {
		expect(isOpenSession({ ...base, endedAt: new Date() })).toBe(false);
	});

	it("instant events are never open sessions", () => {
		expect(isOpenSession({ ...base, type: "pee" })).toBe(false);
		expect(isOpenSession({ ...base, type: "poop" })).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/event.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/event`.

- [ ] **Step 3: Implement `src/domain/event.ts`**

```ts
import type { Result } from "./result";

export type EventType = "eat" | "sleep" | "pee" | "poop";
export type Side = "dx" | "sx";
export type EventSource = "rules" | "gemini";

export interface BabyEvent {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	type: EventType;
	side?: Side;
	/** For eat/sleep: session start. For pee/poop: the instant. */
	startedAt: Date;
	/** eat/sleep when closed; absent while open or for instant events. */
	endedAt?: Date;
	source: EventSource;
	rawText: string;
	messageId: number;
	createdAt: Date;
}

/** Fields needed to persist a new event; id/createdAt are assigned by the repo. */
export type NewBabyEvent = Omit<BabyEvent, "id" | "createdAt">;

export interface EventRepository {
	insert(event: NewBabyEvent): Promise<Result<BabyEvent>>;
	/** The open eat/sleep session for a chat (endedAt absent), or null. */
	findOpenSession(chatId: number): Promise<Result<BabyEvent | null>>;
	closeSession(id: string, endedAt: Date): Promise<Result<BabyEvent>>;
	/** Delete + return the most recently created event in a chat (for /annulla). */
	deleteLast(chatId: number): Promise<Result<BabyEvent | null>>;
	/**
	 * Events relevant to a report window [start, end):
	 * - pee/poop whose startedAt is in the window;
	 * - eat/sleep sessions overlapping the window (including still-open ones,
	 *   which the report layer flags and excludes from totals).
	 */
	listSince(
		chatId: number,
		start: Date,
		end: Date,
	): Promise<Result<BabyEvent[]>>;
}

export interface EventEnv {
	eventRepository: EventRepository;
}

export const isOpenSession = (e: BabyEvent): boolean =>
	(e.type === "eat" || e.type === "sleep") && e.endedAt === undefined;

/** Italian labels for each event type — shared by session/bot copy. */
export const LABEL: Record<EventType, string> = {
	eat: "poppata",
	sleep: "nanna",
	pee: "pipì",
	poop: "cacca",
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/event.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: BabyEvent entity + EventRepository port"
```

---

### Task 4: Rules parser + Intent model (`src/domain/parse.ts`)

**Files:**
- Create: `src/domain/parse.ts`
- Test: `test/unit/domain/parse.test.ts`

**Interfaces:**
- Consumes: `EventType`, `Side`, `EventSource` from `./event`; `Result` from `./result`.
- Produces:
  - `type Action = "start" | "end" | "instant"`
  - `interface Intent { type: EventType; action: Action; side?: Side; at: Date; source: EventSource; confidence: number }`
  - `interface ParsedTokens { type?: EventType; action?: Action; side?: Side; hour?: number; minute: number; hasTime: boolean; confidence: number }`
  - `interface GeminiParse { type: EventType; action: Action; side?: Side; hour?: number; minute?: number; confidence: number }`
  - `interface ParserEnv { parser: { parse(text: string): Promise<Result<GeminiParse | null>> } }`
  - `normalize(text: string): string`
  - `parseRules(text: string): ParsedTokens` — expects already-normalized text
- Notes for consumers: `parseRules` returns `confidence: 1` when it identifies a type **or** an `end` action (a bare "fine" has no type — the caller resolves it from the open session); otherwise `confidence: 0` (caller should try the Gemini fallback). `minute` defaults to `0`.

- [ ] **Step 1: Write the failing test** — `test/unit/domain/parse.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { normalize, parseRules } from "../../../src/domain/parse";

describe("[PARSE] normalize", () => {
	it("lowercases, trims, strips accents", () => {
		expect(normalize("  Pipì  ")).toBe("pipi");
		expect(normalize("Pupù")).toBe("pupu");
	});
});

describe("[PARSE] parseRules", () => {
	const cases: Array<{
		input: string;
		expect: Partial<ReturnType<typeof parseRules>>;
	}> = [
		{
			input: "inizio poppata dx 9.15",
			expect: {
				type: "eat",
				action: "start",
				side: "dx",
				hour: 9,
				minute: 15,
				hasTime: true,
				confidence: 1,
			},
		},
		{
			input: "fine 9.40",
			expect: {
				action: "end",
				hour: 9,
				minute: 40,
				hasTime: true,
				confidence: 1,
			},
		},
		{
			input: "fine poppata",
			expect: { type: "eat", action: "end", hasTime: false, confidence: 1 },
		},
		{
			input: "pipi",
			expect: { type: "pee", action: "instant", hasTime: false, confidence: 1 },
		},
		{
			input: "cacca",
			expect: {
				type: "poop",
				action: "instant",
				hasTime: false,
				confidence: 1,
			},
		},
		{
			input: "nanna 10",
			expect: {
				type: "sleep",
				action: "start",
				hour: 10,
				minute: 0,
				hasTime: true,
				confidence: 1,
			},
		},
		{
			input: "poppata sinistra",
			expect: { type: "eat", action: "start", side: "sx", confidence: 1 },
		},
		{
			input: "allattamento 21:30",
			expect: {
				type: "eat",
				action: "start",
				hour: 21,
				minute: 30,
				hasTime: true,
			},
		},
		{ input: "ciao come stai", expect: { confidence: 0 } },
	];

	for (const c of cases) {
		it(`parses: "${c.input}"`, () => {
			const got = parseRules(normalize(c.input));
			expect(got).toMatchObject(c.expect);
		});
	}
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/parse.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/parse`.

- [ ] **Step 3: Implement `src/domain/parse.ts`**

```ts
import type { EventSource, EventType, Side } from "./event";
import type { Result } from "./result";

export type Action = "start" | "end" | "instant";

export interface Intent {
	type: EventType;
	action: Action;
	side?: Side;
	/** Resolved absolute instant. */
	at: Date;
	source: EventSource;
	confidence: number;
}

/** Rules-parser output, before time resolution. */
export interface ParsedTokens {
	type?: EventType;
	action?: Action;
	side?: Side;
	hour?: number;
	minute: number;
	hasTime: boolean;
	confidence: number;
}

/** Shape the LLM fallback must return (Plan 2 supplies the Gemini adapter). */
export interface GeminiParse {
	type: EventType;
	action: Action;
	side?: Side;
	hour?: number;
	minute?: number;
	confidence: number;
}

export interface ParserEnv {
	parser: {
		/** Returns null when the model can't parse the message. */
		parse(text: string): Promise<Result<GeminiParse | null>>;
	};
}

export const normalize = (text: string): string =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();

const EAT = /\b(poppata|allatta(?:mento)?|tetta|latte|poppa)\b/;
const SLEEP = /\b(nanna|dorme|dormit\w*|sonnellino|sleep)\b/;
const PEE = /\b(pipi|plin)\b/;
const POOP = /\b(cacca|pupu|feci|poop)\b/;
const START = /\b(inizio|inizia|start|comincia)\b/;
const END = /\b(fine|finit[ao]|stop|end|basta)\b/;
const SIDE_DX = /\b(dx|destra|right)\b/;
const SIDE_SX = /\b(sx|sinistra|left)\b/;

const detectType = (t: string): EventType | undefined => {
	if (EAT.test(t)) return "eat";
	if (SLEEP.test(t)) return "sleep";
	if (PEE.test(t)) return "pee";
	if (POOP.test(t)) return "poop";
	return undefined;
};

const detectTime = (t: string): { hour: number; minute: number } | undefined => {
	const withMin = t.match(/(\d{1,2})[.:h](\d{1,2})/);
	if (withMin?.[1] && withMin[2]) {
		return { hour: Number(withMin[1]), minute: Number(withMin[2]) };
	}
	const bare = t.match(/\b(\d{1,2})\b/);
	if (bare?.[1]) return { hour: Number(bare[1]), minute: 0 };
	return undefined;
};

/**
 * Rules parser over already-normalized text. `confidence` is 1 when a type is
 * found or an explicit `end` is present; otherwise 0 (caller falls back to Gemini).
 */
export const parseRules = (text: string): ParsedTokens => {
	const type = detectType(text);
	const time = detectTime(text);
	const hasEnd = END.test(text);
	const hasStart = START.test(text);

	let action: Action | undefined;
	if (type === "pee" || type === "poop") action = "instant";
	else if (hasEnd) action = "end";
	else if (hasStart) action = "start";
	else if (type === "eat" || type === "sleep") action = "start";

	const side: Side | undefined = SIDE_DX.test(text)
		? "dx"
		: SIDE_SX.test(text)
			? "sx"
			: undefined;

	const confident = type !== undefined || action === "end";

	const tokens: ParsedTokens = {
		minute: time?.minute ?? 0,
		hasTime: time !== undefined,
		confidence: confident ? 1 : 0,
	};
	if (type) tokens.type = type;
	if (action) tokens.action = action;
	if (side) tokens.side = side;
	if (time) {
		tokens.hour = time.hour;
		tokens.minute = time.minute;
	}
	return tokens;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/parse.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: rules parser + Intent model + ParserEnv port"
```

---

### Task 5: Session validation rules (`src/domain/session.ts`)

**Files:**
- Create: `src/domain/session.ts`
- Test: `test/unit/domain/session.test.ts`

**Interfaces:**
- Consumes: `BabyEvent` from `./event`; `Intent` from `./parse`; `formatDuration`, `hhmm` from `./time`.
- Produces:
  - `type Decision = { kind: "save"; intent: Intent } | { kind: "confirm"; intent: Intent; warning: string } | { kind: "error"; message: string }`
  - `decide(intent: Intent, open: BabyEvent | null): Decision`
- Rules encoded (pure; low-confidence handling is the caller's job, not `decide`'s):
  - `instant` → always `save`.
  - `start` with an open session → `confirm` (message names the open session and the proposed switch).
  - `start` with no open session → `save`.
  - `end` with no open session → `error` (`"Nessuna sessione aperta da chiudere."`).
  - `end` with `at < open.startedAt` → roll `at` +1 day (midnight crossing). Returned intent carries `type = open.type` and the rolled `at`.
  - `end` whose resulting duration exceeds the type max (eat > 90m, sleep > 12h) → `confirm`; else `save`.

- [ ] **Step 1: Write the failing test** — `test/unit/domain/session.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event";
import type { Intent } from "../../../src/domain/parse";
import { decide } from "../../../src/domain/session";

const at = (iso: string) => new Date(iso);

const openEat: BabyEvent = {
	id: "s1",
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: at("2026-07-02T09:00:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9",
	messageId: 1,
	createdAt: at("2026-07-02T09:00:00+02:00"),
};

const intent = (over: Partial<Intent>): Intent => ({
	type: "eat",
	action: "start",
	at: at("2026-07-02T10:00:00+02:00"),
	source: "rules",
	confidence: 1,
	...over,
});

describe("[SESSION] decide", () => {
	it("instant always saves", () => {
		const d = decide(intent({ type: "pee", action: "instant" }), null);
		expect(d.kind).toBe("save");
	});

	it("start with no open session saves", () => {
		const d = decide(intent({ action: "start" }), null);
		expect(d.kind).toBe("save");
	});

	it("start while a session is open asks to confirm", () => {
		const d = decide(intent({ action: "start", type: "sleep" }), openEat);
		expect(d.kind).toBe("confirm");
		if (d.kind === "confirm") expect(d.warning).toContain("aperta");
	});

	it("end with no open session errors", () => {
		const d = decide(intent({ action: "end" }), null);
		expect(d.kind).toBe("error");
		if (d.kind === "error")
			expect(d.message).toBe("Nessuna sessione aperta da chiudere.");
	});

	it("normal end saves and adopts the open session type", () => {
		const d = decide(
			intent({ action: "end", type: "eat", at: at("2026-07-02T09:40:00+02:00") }),
			openEat,
		);
		expect(d.kind).toBe("save");
		if (d.kind === "save") {
			expect(d.intent.type).toBe("eat");
			expect(d.intent.at.toISOString()).toBe(
				at("2026-07-02T09:40:00+02:00").toISOString(),
			);
		}
	});

	it("end before start rolls +1 day (midnight crossing)", () => {
		const openSleep: BabyEvent = {
			...openEat,
			type: "sleep",
			startedAt: at("2026-07-02T23:30:00+02:00"),
		};
		// "fine 6.30" resolved same-day 06:30 < 23:30 -> roll to next day
		const d = decide(
			intent({
				action: "end",
				type: "sleep",
				at: at("2026-07-02T06:30:00+02:00"),
			}),
			openSleep,
		);
		expect(d.kind).toBe("save");
		if (d.kind === "save")
			expect(d.intent.at.toISOString()).toBe(
				at("2026-07-03T06:30:00+02:00").toISOString(),
			);
	});

	it("implausibly long feed asks to confirm", () => {
		// open 09:00, end 11:00 -> 120m > 90m
		const d = decide(
			intent({ action: "end", type: "eat", at: at("2026-07-02T11:00:00+02:00") }),
			openEat,
		);
		expect(d.kind).toBe("confirm");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/session.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/session`.

- [ ] **Step 3: Implement `src/domain/session.ts`**

```ts
import { type BabyEvent, LABEL } from "./event";
import type { Intent } from "./parse";
import { formatDuration, hhmm } from "./time";

export type Decision =
	| { kind: "save"; intent: Intent }
	| { kind: "confirm"; intent: Intent; warning: string }
	| { kind: "error"; message: string };

const FEED_MAX_MS = 90 * 60_000;
const SLEEP_MAX_MS = 12 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export const decide = (intent: Intent, open: BabyEvent | null): Decision => {
	if (intent.action === "instant") return { kind: "save", intent };

	if (intent.action === "start") {
		if (open) {
			return {
				kind: "confirm",
				intent,
				warning: `C'è già una ${LABEL[open.type]} aperta dalle ${hhmm(
					open.startedAt,
				)}. Chiuderla alle ${hhmm(intent.at)} e iniziare ${LABEL[intent.type]}?`,
			};
		}
		return { kind: "save", intent };
	}

	// action === "end"
	if (!open) return { kind: "error", message: "Nessuna sessione aperta da chiudere." };

	let endedAt = intent.at;
	if (endedAt.getTime() < open.startedAt.getTime()) {
		endedAt = new Date(endedAt.getTime() + DAY_MS);
	}
	const durationMs = endedAt.getTime() - open.startedAt.getTime();
	const adjusted: Intent = { ...intent, type: open.type, at: endedAt };
	const max = open.type === "sleep" ? SLEEP_MAX_MS : FEED_MAX_MS;
	if (durationMs > max) {
		return {
			kind: "confirm",
			intent: adjusted,
			warning: `Durata ${LABEL[open.type]} sospetta: ${formatDuration(
				durationMs,
			)}. Salvare comunque?`,
		};
	}
	return { kind: "save", intent: adjusted };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/session.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: session validation rules (decide)"
```

---

### Task 6: Report aggregation + formatting (`src/domain/report.ts`)

**Files:**
- Create: `src/domain/report.ts`
- Test: `test/unit/domain/report.test.ts`

**Interfaces:**
- Consumes: `BabyEvent` from `./event`; `TimeWindow`, `formatDuration` from `./time`.
- Produces:
  - `interface DailyStats { sleepMs; eatMs; feedCount; feedDx; feedSx; peeCount; poopCount; openExcluded }`
  - `interface WeeklyStats extends DailyStats { avgFeedMs; longestSleepMs; avgFeedGapMs }`
  - `aggregate(events: BabyEvent[], window: TimeWindow): DailyStats`
  - `aggregateWeekly(events: BabyEvent[], window: TimeWindow): WeeklyStats`
  - `formatDaily(s: DailyStats, title: string): string`
  - `formatWeekly(s: WeeklyStats, title: string): string`
- Clipping rule: each eat/sleep session contributes only its overlap with the window `[start, end)`. Sessions with no `endedAt` are excluded from totals and set `openExcluded = true`. Feeds are counted (and split dx/sx) when they overlap. pee/poop counted when `startedAt` is in the window.

- [ ] **Step 1: Write the failing test** — `test/unit/domain/report.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event";
import { aggregate, aggregateWeekly, formatDaily } from "../../../src/domain/report";
import type { TimeWindow } from "../../../src/domain/time";

const d = (iso: string) => new Date(iso);
const window: TimeWindow = {
	start: d("2026-07-01T00:00:00+02:00"),
	end: d("2026-07-02T00:00:00+02:00"),
};

const ev = (over: Partial<BabyEvent>): BabyEvent => ({
	id: Math.random().toString(),
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: d("2026-07-01T09:00:00+02:00"),
	source: "rules",
	rawText: "",
	messageId: 1,
	createdAt: d("2026-07-01T09:00:00+02:00"),
	...over,
});

describe("[REPORT] aggregate", () => {
	it("sums feeds/sleep/pee/poop within the window", () => {
		const events: BabyEvent[] = [
			ev({
				type: "eat",
				side: "dx",
				startedAt: d("2026-07-01T09:00:00+02:00"),
				endedAt: d("2026-07-01T09:30:00+02:00"),
			}),
			ev({
				type: "eat",
				side: "sx",
				startedAt: d("2026-07-01T12:00:00+02:00"),
				endedAt: d("2026-07-01T12:20:00+02:00"),
			}),
			ev({
				type: "sleep",
				startedAt: d("2026-07-01T14:00:00+02:00"),
				endedAt: d("2026-07-01T15:30:00+02:00"),
			}),
			ev({ type: "pee", startedAt: d("2026-07-01T10:00:00+02:00") }),
			ev({ type: "poop", startedAt: d("2026-07-01T11:00:00+02:00") }),
		];
		const s = aggregate(events, window);
		expect(s.eatMs).toBe(50 * 60_000);
		expect(s.feedCount).toBe(2);
		expect(s.feedDx).toBe(1);
		expect(s.feedSx).toBe(1);
		expect(s.sleepMs).toBe(90 * 60_000);
		expect(s.peeCount).toBe(1);
		expect(s.poopCount).toBe(1);
		expect(s.openExcluded).toBe(false);
	});

	it("clips a session that crosses the window end", () => {
		const events = [
			ev({
				type: "sleep",
				startedAt: d("2026-07-01T23:00:00+02:00"),
				endedAt: d("2026-07-02T01:00:00+02:00"),
			}),
		];
		const s = aggregate(events, window);
		expect(s.sleepMs).toBe(60 * 60_000); // only the hour before midnight
	});

	it("flags and excludes an open session", () => {
		const events = [ev({ type: "sleep", startedAt: d("2026-07-01T23:00:00+02:00") })];
		const s = aggregate(events, window);
		expect(s.sleepMs).toBe(0);
		expect(s.openExcluded).toBe(true);
	});
});

describe("[REPORT] aggregateWeekly", () => {
	it("computes avg feed duration, longest sleep and avg feed gap", () => {
		const weekWindow: TimeWindow = {
			start: d("2026-06-22T00:00:00+02:00"),
			end: d("2026-06-29T00:00:00+02:00"),
		};
		const events: BabyEvent[] = [
			ev({
				type: "eat",
				startedAt: d("2026-06-22T08:00:00+02:00"),
				endedAt: d("2026-06-22T08:20:00+02:00"),
			}),
			ev({
				type: "eat",
				startedAt: d("2026-06-22T11:00:00+02:00"),
				endedAt: d("2026-06-22T11:40:00+02:00"),
			}),
			ev({
				type: "sleep",
				startedAt: d("2026-06-22T14:00:00+02:00"),
				endedAt: d("2026-06-22T16:00:00+02:00"),
			}),
		];
		const s = aggregateWeekly(events, weekWindow);
		expect(s.avgFeedMs).toBe(30 * 60_000); // (20 + 40) / 2
		expect(s.longestSleepMs).toBe(120 * 60_000);
		expect(s.avgFeedGapMs).toBe(180 * 60_000); // 08:00 -> 11:00
	});
});

describe("[REPORT] formatDaily", () => {
	it("renders a title and footer flag when a session was open", () => {
		const s = aggregate(
			[ev({ type: "sleep", startedAt: d("2026-07-01T23:00:00+02:00") })],
			window,
		);
		const text = formatDaily(s, "📊 Ieri");
		expect(text).toContain("📊 Ieri");
		expect(text.toLowerCase()).toContain("aperta");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/report.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/report`.

- [ ] **Step 3: Implement `src/domain/report.ts`**

```ts
import type { BabyEvent } from "./event";
import { formatDuration, type TimeWindow } from "./time";

export interface DailyStats {
	sleepMs: number;
	eatMs: number;
	feedCount: number;
	feedDx: number;
	feedSx: number;
	peeCount: number;
	poopCount: number;
	openExcluded: boolean;
}

export interface WeeklyStats extends DailyStats {
	avgFeedMs: number;
	longestSleepMs: number;
	avgFeedGapMs: number;
}

const overlapMs = (
	startedAt: Date,
	endedAt: Date,
	w: TimeWindow,
): number => {
	const start = Math.max(startedAt.getTime(), w.start.getTime());
	const end = Math.min(endedAt.getTime(), w.end.getTime());
	return Math.max(0, end - start);
};

const inWindow = (at: Date, w: TimeWindow): boolean =>
	at.getTime() >= w.start.getTime() && at.getTime() < w.end.getTime();

export const aggregate = (events: BabyEvent[], w: TimeWindow): DailyStats => {
	const s: DailyStats = {
		sleepMs: 0,
		eatMs: 0,
		feedCount: 0,
		feedDx: 0,
		feedSx: 0,
		peeCount: 0,
		poopCount: 0,
		openExcluded: false,
	};

	for (const e of events) {
		if (e.type === "pee") {
			if (inWindow(e.startedAt, w)) s.peeCount++;
			continue;
		}
		if (e.type === "poop") {
			if (inWindow(e.startedAt, w)) s.poopCount++;
			continue;
		}
		// eat / sleep
		if (e.endedAt === undefined) {
			s.openExcluded = true;
			continue;
		}
		const ms = overlapMs(e.startedAt, e.endedAt, w);
		if (ms <= 0) continue;
		if (e.type === "sleep") {
			s.sleepMs += ms;
		} else {
			s.eatMs += ms;
			s.feedCount++;
			if (e.side === "dx") s.feedDx++;
			else if (e.side === "sx") s.feedSx++;
		}
	}
	return s;
};

export const aggregateWeekly = (
	events: BabyEvent[],
	w: TimeWindow,
): WeeklyStats => {
	const base = aggregate(events, w);

	const feeds = events
		.filter(
			(e) => e.type === "eat" && e.endedAt !== undefined && overlapMs(e.startedAt, e.endedAt, w) > 0,
		)
		.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

	const avgFeedMs =
		base.feedCount > 0 ? Math.round(base.eatMs / base.feedCount) : 0;

	let longestSleepMs = 0;
	for (const e of events) {
		if (e.type === "sleep" && e.endedAt !== undefined) {
			const ms = overlapMs(e.startedAt, e.endedAt, w);
			if (ms > longestSleepMs) longestSleepMs = ms;
		}
	}

	let avgFeedGapMs = 0;
	if (feeds.length >= 2) {
		let total = 0;
		for (let i = 1; i < feeds.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: bounded by length
			total += feeds[i]!.startedAt.getTime() - feeds[i - 1]!.startedAt.getTime();
		}
		avgFeedGapMs = Math.round(total / (feeds.length - 1));
	}

	return { ...base, avgFeedMs, longestSleepMs, avgFeedGapMs };
};

const footer = (s: DailyStats): string =>
	s.openExcluded
		? "\n\n⚠️ Una sessione era ancora aperta e non è stata conteggiata."
		: "";

export const formatDaily = (s: DailyStats, title: string): string => {
	const lines = [
		title,
		"",
		`😴 Sonno: ${formatDuration(s.sleepMs)}`,
		`🍼 Poppate: ${formatDuration(s.eatMs)} (${s.feedCount} — dx ${s.feedDx}, sx ${s.feedSx})`,
		`💧 Pipì: ${s.peeCount}`,
		`💩 Cacca: ${s.poopCount}`,
	];
	return lines.join("\n") + footer(s);
};

export const formatWeekly = (s: WeeklyStats, title: string): string => {
	const lines = [
		title,
		"",
		`😴 Sonno: ${formatDuration(s.sleepMs)} (più lungo: ${formatDuration(s.longestSleepMs)})`,
		`🍼 Poppate: ${formatDuration(s.eatMs)} (${s.feedCount} — dx ${s.feedDx}, sx ${s.feedSx})`,
		`   media poppata: ${formatDuration(s.avgFeedMs)}, intervallo medio: ${formatDuration(s.avgFeedGapMs)}`,
		`💧 Pipì: ${s.peeCount}`,
		`💩 Cacca: ${s.poopCount}`,
	];
	return lines.join("\n") + footer(s);
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/report.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: report aggregation + formatting"
```

---

### Task 7: Pending port + in-memory adapters (`src/domain/pending.ts`, `src/adapters/memory/*`)

**Files:**
- Create: `src/domain/pending.ts`, `src/adapters/memory/event.ts`, `src/adapters/memory/pending.ts`
- Test: `test/unit/adapters/memory/event.test.ts`, `test/unit/adapters/memory/pending.test.ts`

**Interfaces:**
- Consumes: `Intent` from `../parse`; `Result`, `success`, `error` from `../result`; `BabyEvent`, `NewBabyEvent`, `EventRepository`, `isOpenSession` from `../event`; `LoggerEnv` from `../logger`.
- Produces:
  - `interface PendingConfirmation { id; chatId; userId; userName; intent: Intent; warning; messageId; createdAt }`
  - `type NewPendingConfirmation = Omit<PendingConfirmation, "id" | "createdAt">`
  - `interface PendingRepository { create; get; delete; deleteStale }`
  - `interface PendingEnv { pendingRepository: PendingRepository }`
  - `makeMemoryEventRepository({ logger }): EventRepository`
  - `makeMemoryPendingRepository({ logger }): PendingRepository`

> **Deviation note:** the spec's file list did not include a `domain/pending.ts`; this plan adds it so the pending entity + port sit together (mirroring the `pg/pending.ts` adapter split), keeping `event.ts` focused on the `BabyEvent` aggregate.

- [ ] **Step 1: Create `src/domain/pending.ts`**

```ts
import type { Intent } from "./parse";
import type { Result } from "./result";

export interface PendingConfirmation {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	intent: Intent;
	warning: string;
	/** The original user message this confirmation is about. */
	messageId: number;
	createdAt: Date;
}

export type NewPendingConfirmation = Omit<PendingConfirmation, "id" | "createdAt">;

export interface PendingRepository {
	create(p: NewPendingConfirmation): Promise<Result<PendingConfirmation>>;
	get(id: string): Promise<Result<PendingConfirmation | null>>;
	delete(id: string): Promise<Result<void>>;
	/** Delete rows created before `olderThan`; returns how many were removed. */
	deleteStale(olderThan: Date): Promise<Result<number>>;
}

export interface PendingEnv {
	pendingRepository: PendingRepository;
}
```

- [ ] **Step 2: Write the failing test** — `test/unit/adapters/memory/event.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { makeMemoryEventRepository } from "../../../../src/adapters/memory/event";
import type { NewBabyEvent } from "../../../../src/domain/event";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const newEvent = (over: Partial<NewBabyEvent>): NewBabyEvent => ({
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: new Date("2026-07-02T09:00:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9",
	messageId: 1,
	...over,
});

describe("[MEMORY event repo]", () => {
	it("insert assigns id + createdAt and returns the event", async () => {
		const repo = makeMemoryEventRepository({ logger });
		const r = await repo.insert(newEvent({}));
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.id).toBeTruthy();
			expect(r.data.createdAt).toBeInstanceOf(Date);
			expect(r.data.type).toBe("eat");
		}
	});

	it("findOpenSession returns the open eat/sleep, ignoring instant + closed", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(newEvent({ type: "pee", startedAt: new Date() }));
		const open = await repo.insert(newEvent({ type: "sleep" }));
		const r = await repo.findOpenSession(1);
		expect(r.success).toBe(true);
		if (r.success && open.success) expect(r.data?.id).toBe(open.data.id);
	});

	it("closeSession sets endedAt so it is no longer open", async () => {
		const repo = makeMemoryEventRepository({ logger });
		const open = await repo.insert(newEvent({ type: "sleep" }));
		if (!open.success) throw new Error("setup");
		const end = new Date("2026-07-02T10:00:00+02:00");
		const closed = await repo.closeSession(open.data.id, end);
		expect(closed.success).toBe(true);
		if (closed.success) expect(closed.data.endedAt).toEqual(end);
		const r = await repo.findOpenSession(1);
		if (r.success) expect(r.data).toBeNull();
	});

	it("deleteLast removes and returns the most recent event", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(newEvent({ rawText: "first" }));
		await repo.insert(newEvent({ type: "pee", rawText: "second" }));
		const r = await repo.deleteLast(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data?.rawText).toBe("second");
	});

	it("listSince returns instants in-window and overlapping sessions", async () => {
		const repo = makeMemoryEventRepository({ logger });
		await repo.insert(
			newEvent({
				type: "eat",
				startedAt: new Date("2026-07-01T09:00:00+02:00"),
				endedAt: new Date("2026-07-01T09:20:00+02:00"),
			}),
		);
		await repo.insert(
			newEvent({ type: "pee", startedAt: new Date("2026-07-01T10:00:00+02:00") }),
		);
		await repo.insert(
			newEvent({ type: "pee", startedAt: new Date("2026-06-30T10:00:00+02:00") }),
		);
		const r = await repo.listSince(
			1,
			new Date("2026-07-01T00:00:00+02:00"),
			new Date("2026-07-02T00:00:00+02:00"),
		);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toHaveLength(2);
	});
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/unit/adapters/memory/event.test.ts`
Expected: FAIL — cannot resolve the adapter.

- [ ] **Step 4: Implement `src/adapters/memory/event.ts`**

```ts
import type {
	BabyEvent,
	EventRepository,
	NewBabyEvent,
} from "../../domain/event";
import { isOpenSession } from "../../domain/event";
import type { LoggerEnv } from "../../domain/logger";
import * as R from "../../domain/result";

export const makeMemoryEventRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): EventRepository => {
	logger.info("initMemoryEventRepository");
	const events: BabyEvent[] = [];

	return {
		insert: async (event: NewBabyEvent) => {
			const created: BabyEvent = {
				...event,
				id: crypto.randomUUID(),
				createdAt: new Date(),
			};
			events.push(created);
			return R.success(created);
		},

		findOpenSession: async (chatId: number) => {
			const open = events.find((e) => e.chatId === chatId && isOpenSession(e));
			return R.success(open ?? null);
		},

		closeSession: async (id: string, endedAt: Date) => {
			const e = events.find((ev) => ev.id === id);
			if (!e) return R.error(new Error("Session not found"));
			e.endedAt = endedAt;
			return R.success(e);
		},

		deleteLast: async (chatId: number) => {
			let idx = -1;
			for (let i = 0; i < events.length; i++) {
				const e = events[i];
				if (
					e &&
					e.chatId === chatId &&
					(idx === -1 ||
						// biome-ignore lint/style/noNonNullAssertion: idx points at an existing element
						e.createdAt.getTime() > events[idx]!.createdAt.getTime())
				) {
					idx = i;
				}
			}
			if (idx === -1) return R.success(null);
			const [deleted] = events.splice(idx, 1);
			return R.success(deleted ?? null);
		},

		listSince: async (chatId: number, start: Date, end: Date) => {
			const s = start.getTime();
			const e = end.getTime();
			const rows = events.filter((ev) => {
				if (ev.chatId !== chatId) return false;
				if (ev.type === "pee" || ev.type === "poop") {
					const t = ev.startedAt.getTime();
					return t >= s && t < e;
				}
				// eat/sleep: overlap the window (open sessions included, flagged later)
				if (ev.startedAt.getTime() >= e) return false;
				return ev.endedAt === undefined || ev.endedAt.getTime() > s;
			});
			return R.success(rows);
		},
	};
};
```

- [ ] **Step 5: Write the failing test** — `test/unit/adapters/memory/pending.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { makeMemoryPendingRepository } from "../../../../src/adapters/memory/pending";
import type { NewPendingConfirmation } from "../../../../src/domain/pending";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const newPending = (): NewPendingConfirmation => ({
	chatId: 1,
	userId: 1,
	userName: "a",
	intent: {
		type: "eat",
		action: "start",
		at: new Date("2026-07-02T09:00:00+02:00"),
		source: "rules",
		confidence: 1,
	},
	warning: "sospetto",
	messageId: 1,
});

describe("[MEMORY pending repo]", () => {
	it("create then get returns the row", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		const created = await repo.create(newPending());
		expect(created.success).toBe(true);
		if (!created.success) return;
		const got = await repo.get(created.data.id);
		expect(got.success).toBe(true);
		if (got.success) expect(got.data?.id).toBe(created.data.id);
	});

	it("delete removes the row", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		const created = await repo.create(newPending());
		if (!created.success) return;
		await repo.delete(created.data.id);
		const got = await repo.get(created.data.id);
		if (got.success) expect(got.data).toBeNull();
	});

	it("deleteStale removes rows older than the cutoff", async () => {
		const repo = makeMemoryPendingRepository({ logger });
		await repo.create(newPending());
		const future = new Date(Date.now() + 60_000);
		const r = await repo.deleteStale(future);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe(1);
	});
});
```

- [ ] **Step 6: Implement `src/adapters/memory/pending.ts`**

```ts
import type { LoggerEnv } from "../../domain/logger";
import type {
	NewPendingConfirmation,
	PendingConfirmation,
	PendingRepository,
} from "../../domain/pending";
import * as R from "../../domain/result";

export const makeMemoryPendingRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): PendingRepository => {
	logger.info("initMemoryPendingRepository");
	let rows: PendingConfirmation[] = [];

	return {
		create: async (p: NewPendingConfirmation) => {
			const created: PendingConfirmation = {
				...p,
				id: crypto.randomUUID(),
				createdAt: new Date(),
			};
			rows.push(created);
			return R.success(created);
		},
		get: async (id: string) => {
			return R.success(rows.find((r) => r.id === id) ?? null);
		},
		delete: async (id: string) => {
			rows = rows.filter((r) => r.id !== id);
			return R.success(undefined);
		},
		deleteStale: async (olderThan: Date) => {
			const before = rows.length;
			rows = rows.filter((r) => r.createdAt.getTime() >= olderThan.getTime());
			return R.success(before - rows.length);
		},
	};
};
```

- [ ] **Step 7: Run both adapter tests**

Run: `npx vitest run test/unit/adapters/memory`
Expected: PASS (all cases in both files).

- [ ] **Step 8: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: pending port + in-memory event/pending repositories"
```

---

### Task 8: Bot port + message pipeline (`src/domain/bot.ts`) + test env

**Files:**
- Create: `src/domain/bot.ts`, `test/unit/testEnv.ts`
- Test: `test/unit/domain/bot.test.ts`

**Interfaces:**
- Consumes: `BabyEvent`, `EventEnv`, `EventSource`, `LABEL`, `NewBabyEvent` from `./event`; `Intent`, `ParserEnv`, `normalize`, `parseRules` from `./parse`; `PendingEnv` from `./pending`; `decide` from `./session`; `formatDuration`, `hhmm`, `resolveClock`, `romeNow` from `./time`; `Result`, `error`, `success` from `./result`; `LoggerEnv` from `./logger`.
- Produces:
  - `interface BotEnv { bot: { sendMessage; react; sendConfirmation; answerCallback; clearKeyboard } }`
  - `interface IncomingMessage { chatId; userId; userName; text; messageId; at: Date }`
  - `interface IncomingCallback { id; chatId; userId; userName; data; messageId }`
  - `interface EventContext { chatId; userId; userName; messageId; rawText }`
  - `applyIntent(intent: Intent, ctx: EventContext): (env: EventEnv & LoggerEnv) => Promise<Result<{ closed?: BabyEvent; inserted?: BabyEvent }>>` — the single writer (end→close; start→optionally close open, then insert; instant→insert).
  - `handleMessage(msg: IncomingMessage): (env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv) => Promise<void>`
- `CONFIDENCE_MIN = 0.7`. Low confidence is only reachable via the Gemini fallback (rules yield 0 or 1).

- [ ] **Step 1: Create `test/unit/testEnv.ts`**

```ts
import { vi } from "vitest";
import type { BotEnv } from "../../src/domain/bot";
import type { EventEnv } from "../../src/domain/event";
import type { LoggerEnv } from "../../src/domain/logger";
import type { ParserEnv } from "../../src/domain/parse";
import type { PendingEnv } from "../../src/domain/pending";

export const makeTestEnv = () => {
	const mocks = {
		eventRepository: {
			insert: vi.fn<EventEnv["eventRepository"]["insert"]>(),
			findOpenSession: vi.fn<EventEnv["eventRepository"]["findOpenSession"]>(),
			closeSession: vi.fn<EventEnv["eventRepository"]["closeSession"]>(),
			deleteLast: vi.fn<EventEnv["eventRepository"]["deleteLast"]>(),
			listSince: vi.fn<EventEnv["eventRepository"]["listSince"]>(),
		},
		pendingRepository: {
			create: vi.fn<PendingEnv["pendingRepository"]["create"]>(),
			get: vi.fn<PendingEnv["pendingRepository"]["get"]>(),
			delete: vi.fn<PendingEnv["pendingRepository"]["delete"]>(),
			deleteStale: vi.fn<PendingEnv["pendingRepository"]["deleteStale"]>(),
		},
		parser: { parse: vi.fn<ParserEnv["parser"]["parse"]>() },
		bot: {
			sendMessage: vi.fn<BotEnv["bot"]["sendMessage"]>(),
			react: vi.fn<BotEnv["bot"]["react"]>(),
			sendConfirmation: vi.fn<BotEnv["bot"]["sendConfirmation"]>(),
			answerCallback: vi.fn<BotEnv["bot"]["answerCallback"]>(),
			clearKeyboard: vi.fn<BotEnv["bot"]["clearKeyboard"]>(),
		},
		logger: {
			info: vi.fn<LoggerEnv["logger"]["info"]>(),
			warn: vi.fn<LoggerEnv["logger"]["warn"]>(),
			error: vi.fn<LoggerEnv["logger"]["error"]>(),
			debug: vi.fn<LoggerEnv["logger"]["debug"]>(),
			log: vi.fn<LoggerEnv["logger"]["log"]>(),
		},
	};

	const env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv = {
		eventRepository: mocks.eventRepository,
		pendingRepository: mocks.pendingRepository,
		parser: mocks.parser,
		bot: mocks.bot,
		logger: mocks.logger,
	};

	return { mocks, env };
};
```

- [ ] **Step 2: Write the failing test** — `test/unit/domain/bot.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event";
import { handleMessage } from "../../../src/domain/bot";
import { success } from "../../../src/domain/result";
import { makeTestEnv } from "../testEnv";

const msg = (text: string, at = new Date("2026-07-02T09:30:00+02:00")) => ({
	chatId: 1,
	userId: 1,
	userName: "papà",
	text,
	messageId: 100,
	at,
});

const openEat: BabyEvent = {
	id: "s1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	startedAt: new Date("2026-07-02T09:00:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9",
	messageId: 1,
	createdAt: new Date("2026-07-02T09:00:00+02:00"),
};

describe("[BOT] handleMessage", () => {
	it("saves a new feed and reacts 👍", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio poppata dx 9.15"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		const inserted = mocks.eventRepository.insert.mock.calls[0]?.[0];
		expect(inserted?.type).toBe("eat");
		expect(inserted?.side).toBe("dx");
		expect(mocks.bot.react).toHaveBeenCalledWith(1, 100, "👍");
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});

	it("closes the open feed on 'fine' and replies with the duration", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.eventRepository.closeSession.mockImplementation(async (_id, endedAt) =>
			success({ ...openEat, endedAt }),
		);

		await handleMessage(msg("fine 9.40"))(env);

		expect(mocks.eventRepository.closeSession).toHaveBeenCalledWith(
			"s1",
			new Date("2026-07-02T09:40:00+02:00"),
		);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("durata poppata");
		expect(text).toContain("40m");
		expect(mocks.bot.react).not.toHaveBeenCalled();
	});

	it("asks to confirm when starting while a session is open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p1", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio nanna 10"))(env);

		expect(mocks.pendingRepository.create).toHaveBeenCalledTimes(1);
		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("aperta"),
			"p1",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("reports 'no open session' on a bare 'fine' with nothing open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));

		await handleMessage(msg("fine"))(env);

		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nessuna sessione aperta da chiudere.",
		);
	});

	it("sends the help hint when nothing parses (rules + gemini both empty)", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.parser.parse.mockResolvedValue(success(null));

		await handleMessage(msg("ciao come stai"))(env);

		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("/help");
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("confirms-to-save a low-confidence Gemini parse", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.parser.parse.mockResolvedValue(
			success({ type: "poop", action: "instant", confidence: 0.4 }),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p2", createdAt: new Date() }),
		);

		await handleMessage(msg("credo abbia fatto la popo"))(env);

		expect(mocks.pendingRepository.create).toHaveBeenCalledTimes(1);
		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"p2",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/unit/domain/bot.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/bot`.

- [ ] **Step 4: Implement `src/domain/bot.ts`**

```ts
import {
	type BabyEvent,
	type EventEnv,
	type EventSource,
	LABEL,
	type NewBabyEvent,
} from "./event";
import type { LoggerEnv } from "./logger";
import {
	type Intent,
	normalize,
	type ParserEnv,
	parseRules,
} from "./parse";
import type { PendingEnv } from "./pending";
import * as R from "./result";
import type { Result } from "./result";
import { decide } from "./session";
import { formatDuration, hhmm, resolveClock, romeNow } from "./time";

export interface BotEnv {
	bot: {
		sendMessage(chatId: number, text: string): Promise<void>;
		react(chatId: number, messageId: number, emoji: string): Promise<void>;
		sendConfirmation(
			chatId: number,
			text: string,
			pendingId: string,
		): Promise<void>;
		answerCallback(callbackId: string, text?: string): Promise<void>;
		clearKeyboard(chatId: number, messageId: number): Promise<void>;
	};
}

export interface IncomingMessage {
	chatId: number;
	userId: number;
	userName: string;
	text: string;
	messageId: number;
	at: Date;
}

export interface IncomingCallback {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	data: string;
	messageId: number;
}

export interface EventContext {
	chatId: number;
	userId: number;
	userName: string;
	messageId: number;
	rawText: string;
}

const CONFIDENCE_MIN = 0.7;
const HELP_HINT =
	'Non ho capito 🤔 Prova ad esempio: "inizio poppata dx 9.15", "fine 9.40", "pipì", "cacca", "nanna 10". Usa /help per la lista completa.';
const INTERNAL_ERROR = "Errore interno, riprova.";

const newEventFrom = (intent: Intent, ctx: EventContext): NewBabyEvent => ({
	chatId: ctx.chatId,
	userId: ctx.userId,
	userName: ctx.userName,
	type: intent.type,
	startedAt: intent.at,
	source: intent.source,
	rawText: ctx.rawText,
	messageId: ctx.messageId,
	...(intent.side ? { side: intent.side } : {}),
});

const describeIntent = (intent: Intent): string => {
	const parts = [LABEL[intent.type]];
	if (intent.side) parts.push(intent.side);
	if (intent.action === "instant") parts.push(`alle ${hhmm(intent.at)}`);
	else parts.push(`${intent.action === "end" ? "fine" : "inizio"} ${hhmm(intent.at)}`);
	return parts.join(" ");
};

/** Single writer: applies a confirmed/valid intent to the event store. */
export const applyIntent =
	(intent: Intent, ctx: EventContext) =>
	async (
		env: EventEnv & LoggerEnv,
	): Promise<Result<{ closed?: BabyEvent; inserted?: BabyEvent }>> => {
		const openRes = await env.eventRepository.findOpenSession(ctx.chatId);
		if (!openRes.success) return openRes;
		const open = openRes.data;

		if (intent.action === "end") {
			if (!open) return R.error(new Error("Nessuna sessione aperta da chiudere."));
			const closed = await env.eventRepository.closeSession(open.id, intent.at);
			if (!closed.success) return closed;
			return R.success({ closed: closed.data });
		}

		if (intent.action === "start") {
			let closed: BabyEvent | undefined;
			if (open) {
				const c = await env.eventRepository.closeSession(open.id, intent.at);
				if (!c.success) return c;
				closed = c.data;
			}
			const inserted = await env.eventRepository.insert(newEventFrom(intent, ctx));
			if (!inserted.success) return inserted;
			return R.success(
				closed
					? { closed, inserted: inserted.data }
					: { inserted: inserted.data },
			);
		}

		// instant
		const inserted = await env.eventRepository.insert(newEventFrom(intent, ctx));
		if (!inserted.success) return inserted;
		return R.success({ inserted: inserted.data });
	};

const createPending = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
	warning: string,
): Promise<void> => {
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		intent,
		warning,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendConfirmation(ctx.chatId, warning, created.data.id);
};

const save = async (
	env: BotEnv & EventEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
): Promise<void> => {
	const applied = await applyIntent(intent, ctx)(env);
	if (!applied.success) {
		env.logger.error("applyIntent failed", applied.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	const closed = applied.data.closed;
	if (intent.action === "end" && closed?.endedAt) {
		const dur = formatDuration(closed.endedAt.getTime() - closed.startedAt.getTime());
		await env.bot.sendMessage(
			ctx.chatId,
			`Ok, aggiunta ✅ — durata ${LABEL[closed.type]}: ${dur}`,
		);
		return;
	}
	await env.bot.react(ctx.chatId, ctx.messageId, "👍");
};

export const handleMessage =
	(msg: IncomingMessage) =>
	async (
		env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv,
	): Promise<void> => {
		const arrival = romeNow(msg.at);
		const tokens = parseRules(normalize(msg.text));

		let { type, action, side, hour, minute, hasTime, confidence } = tokens;
		let source: EventSource = "rules";

		if (confidence === 0) {
			const g = await env.parser.parse(msg.text);
			if (g.success && g.data) {
				const d = g.data;
				source = "gemini";
				type = d.type;
				action = d.action;
				side = d.side;
				hasTime = d.hour !== undefined;
				hour = d.hour;
				minute = d.minute ?? 0;
				confidence = d.confidence;
			}
		}

		if (!action) {
			await env.bot.sendMessage(msg.chatId, HELP_HINT);
			return;
		}

		const openRes = await env.eventRepository.findOpenSession(msg.chatId);
		if (!openRes.success) {
			env.logger.error("findOpenSession failed", openRes.error);
			await env.bot.sendMessage(msg.chatId, INTERNAL_ERROR);
			return;
		}
		const open = openRes.data;

		if (action === "end" && !type) {
			if (!open) {
				await env.bot.sendMessage(
					msg.chatId,
					"Nessuna sessione aperta da chiudere.",
				);
				return;
			}
			type = open.type;
		}

		if (!type) {
			await env.bot.sendMessage(msg.chatId, HELP_HINT);
			return;
		}

		const at =
			hasTime && hour !== undefined
				? resolveClock(arrival, hour, minute).toJSDate()
				: arrival.toJSDate();

		const intent: Intent = {
			type,
			action,
			at,
			source,
			confidence,
			...(side ? { side } : {}),
		};

		const ctx: EventContext = {
			chatId: msg.chatId,
			userId: msg.userId,
			userName: msg.userName,
			messageId: msg.messageId,
			rawText: msg.text,
		};

		if (confidence < CONFIDENCE_MIN) {
			await createPending(
				env,
				ctx,
				intent,
				`Ho capito: ${describeIntent(intent)}. Confermi?`,
			);
			return;
		}

		const decision = decide(intent, open);
		switch (decision.kind) {
			case "error":
				await env.bot.sendMessage(msg.chatId, decision.message);
				return;
			case "confirm":
				await createPending(env, ctx, decision.intent, decision.warning);
				return;
			case "save":
				await save(env, ctx, decision.intent);
				return;
		}
	};
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/unit/domain/bot.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 6: Typecheck (exactOptionalPropertyTypes is strict here)**

Run: `npm run typecheck`
Expected: exits 0. (If the destructured `let { type, ... }` trips `noUnusedLocals` for a branch, it will surface here — all are used.)

- [ ] **Step 7: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: bot port + message pipeline (applyIntent, handleMessage)"
```

---

### Task 9: Callback handling — Conferma / Annulla (`src/domain/bot.ts`)

**Files:**
- Modify: `src/domain/bot.ts` (append `handleCallback`)
- Test: `test/unit/domain/bot.test.ts` (append a `handleCallback` describe block)

**Interfaces:**
- Consumes: everything already in `bot.ts`, plus `PendingConfirmation` from `./pending`.
- Produces: `handleCallback(cb: IncomingCallback): (env: BotEnv & EventEnv & PendingEnv & LoggerEnv) => Promise<void>`
- Callback data format: `conf:<pendingId>` / `ann:<pendingId>`. On confirm: load pending → `applyIntent` → feedback (duration reply for `end`, 👍 on the original message otherwise) → clear the confirmation keyboard → delete pending → answer callback. On annulla: delete pending → clear keyboard → answer `"Annullato"`.

- [ ] **Step 1: Append the failing tests to `test/unit/domain/bot.test.ts`**

```ts
import { handleCallback } from "../../../src/domain/bot";
import type { PendingConfirmation } from "../../../src/domain/pending";

const pending = (over: Partial<PendingConfirmation>): PendingConfirmation => ({
	id: "p1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	intent: {
		type: "poop",
		action: "instant",
		at: new Date("2026-07-02T09:15:00+02:00"),
		source: "gemini",
		confidence: 0.4,
	},
	warning: "Ho capito: cacca alle 9:15. Confermi?",
	messageId: 100,
	createdAt: new Date(),
	...over,
});

describe("[BOT] handleCallback", () => {
	const cb = (data: string) => ({
		id: "cbq",
		chatId: 1,
		userId: 1,
		userName: "papà",
		data,
		messageId: 200, // the confirmation message
	});

	it("confirm applies the intent, reacts, clears keyboard, deletes pending", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(success(pending({})));
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.bot.react).toHaveBeenCalledWith(1, 100, "👍"); // original message
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.answerCallback).toHaveBeenCalled();
	});

	it("confirm of an 'end' intent replies with the duration", async () => {
		const { env, mocks } = makeTestEnv();
		const openEatLocal = { ...openEat };
		mocks.pendingRepository.get.mockResolvedValue(
			success(
				pending({
					intent: {
						type: "eat",
						action: "end",
						at: new Date("2026-07-02T11:00:00+02:00"),
						source: "rules",
						confidence: 1,
					},
					warning: "Durata poppata sospetta: 2h. Salvare comunque?",
				}),
			),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEatLocal));
		mocks.eventRepository.closeSession.mockImplementation(async (_id, endedAt) =>
			success({ ...openEatLocal, endedAt }),
		);

		await handleCallback(cb("conf:p1"))(env);

		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("durata poppata");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});

	it("annulla deletes the pending and clears the keyboard without saving", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(success(pending({})));
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));

		await handleCallback(cb("ann:p1"))(env);

		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.bot.answerCallback).toHaveBeenCalledWith("cbq", "Annullato");
	});

	it("handles a stale/unknown pending id gracefully", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(success(null));

		await handleCallback(cb("conf:gone"))(env);

		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.bot.answerCallback).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run test/unit/domain/bot.test.ts`
Expected: FAIL — `handleCallback` is not exported.

- [ ] **Step 3: Append `handleCallback` to `src/domain/bot.ts`**

Add `PendingConfirmation` to the pending import:
```ts
import type { PendingConfirmation, PendingEnv } from "./pending";
```

Then append:
```ts
const feedbackFor = async (
	env: BotEnv,
	p: PendingConfirmation,
	closed: BabyEvent | undefined,
): Promise<void> => {
	if (p.intent.action === "end" && closed?.endedAt) {
		const dur = formatDuration(
			closed.endedAt.getTime() - closed.startedAt.getTime(),
		);
		await env.bot.sendMessage(
			p.chatId,
			`Ok, aggiunta ✅ — durata ${LABEL[closed.type]}: ${dur}`,
		);
		return;
	}
	// react on the ORIGINAL user message
	await env.bot.react(p.chatId, p.messageId, "👍");
};

export const handleCallback =
	(cb: IncomingCallback) =>
	async (
		env: BotEnv & EventEnv & PendingEnv & LoggerEnv,
	): Promise<void> => {
		const [verb, pendingId] = cb.data.split(":");
		if (!pendingId) {
			await env.bot.answerCallback(cb.id);
			return;
		}

		const found = await env.pendingRepository.get(pendingId);
		if (!found.success) {
			env.logger.error("get pending failed", found.error);
			await env.bot.answerCallback(cb.id);
			return;
		}
		const p = found.data;
		if (!p) {
			// stale / already handled
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, "Scaduto");
			return;
		}

		if (verb === "ann") {
			await env.pendingRepository.delete(p.id);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, "Annullato");
			return;
		}

		// verb === "conf"
		const ctx: EventContext = {
			chatId: p.chatId,
			userId: p.userId,
			userName: p.userName,
			messageId: p.messageId,
			rawText: p.warning,
		};
		const applied = await applyIntent(p.intent, ctx)(env);
		if (!applied.success) {
			env.logger.error("applyIntent (confirm) failed", applied.error);
			await env.bot.answerCallback(cb.id, "Errore");
			return;
		}
		await feedbackFor(env, p, applied.data.closed);
		await env.bot.clearKeyboard(cb.chatId, cb.messageId);
		await env.pendingRepository.delete(p.id);
		await env.bot.answerCallback(cb.id);
	};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/bot.test.ts`
Expected: PASS (all handleMessage + handleCallback cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: handleCallback (Conferma/Annulla)"
```

---

### Task 10: State/undo/help commands (`src/domain/commands.ts`)

**Files:**
- Create: `src/domain/commands.ts`
- Test: `test/unit/domain/commands.test.ts`

**Interfaces:**
- Consumes: `BotEnv` from `./bot`; `EventEnv`, `LABEL` from `./event`; `LoggerEnv` from `./logger`; `formatDuration`, `hhmm`, `romeNow` from `./time`.
- Produces:
  - `statoCommand(chatId: number, now: Date): (env: EventEnv & BotEnv & LoggerEnv) => Promise<void>`
  - `annullaCommand(chatId: number): (env: EventEnv & BotEnv & LoggerEnv) => Promise<void>`
  - `helpCommand(chatId: number): (env: BotEnv) => Promise<void>`
  - `startCommand(chatId: number): (env: BotEnv) => Promise<void>`
  - `HELP_TEXT: string` (exported so `/start` and `/help` share it)

- [ ] **Step 1: Write the failing test** — `test/unit/domain/commands.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
	annullaCommand,
	helpCommand,
	statoCommand,
} from "../../../src/domain/commands";
import type { BabyEvent } from "../../../src/domain/event";
import { success } from "../../../src/domain/result";
import { makeTestEnv } from "../testEnv";

const openEat: BabyEvent = {
	id: "s1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	startedAt: new Date("2026-07-02T09:15:00+02:00"),
	source: "rules",
	rawText: "inizio poppata 9.15",
	messageId: 1,
	createdAt: new Date("2026-07-02T09:15:00+02:00"),
};

describe("[COMMANDS] /stato", () => {
	it("describes the open session with its start time", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		await statoCommand(1, new Date("2026-07-02T09:37:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("in corso da 9:15");
	});

	it("says nothing is open when there is no session", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		await statoCommand(1, new Date())(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(1, "Nessuna sessione aperta.");
	});
});

describe("[COMMANDS] /annulla", () => {
	it("reports what was removed", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.deleteLast.mockResolvedValue(success(openEat));
		await annullaCommand(1)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("rimosso");
		expect(text.toLowerCase()).toContain("poppata");
	});

	it("says there is nothing to undo", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.deleteLast.mockResolvedValue(success(null));
		await annullaCommand(1)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(1, "Niente da annullare.");
	});
});

describe("[COMMANDS] /help", () => {
	it("lists commands", async () => {
		const { env, mocks } = makeTestEnv();
		await helpCommand(1)(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("/oggi");
		expect(text).toContain("/annulla");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: FAIL — cannot resolve `../../../src/domain/commands`.

- [ ] **Step 3: Implement `src/domain/commands.ts`**

```ts
import type { BotEnv } from "./bot";
import { type EventEnv, LABEL } from "./event";
import type { LoggerEnv } from "./logger";
import { formatDuration, hhmm } from "./time";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const INTERNAL_ERROR = "Errore interno, riprova.";

export const HELP_TEXT = [
	"👶 poppata-bot — cosa capisco:",
	'• "inizio poppata dx 9.15" — inizio poppata (dx/sx) alle 9:15',
	'• "fine 9.40" — chiude la sessione aperta alle 9:40',
	'• "nanna 10" / "fine 10.15" — inizio/fine nanna',
	'• "pipì" / "cacca" — eventi istantanei',
	"",
	"Comandi:",
	"/stato — sessione in corso",
	"/oggi — statistiche di oggi",
	"/ieri — statistiche di ieri",
	"/settimana — statistiche della settimana",
	"/annulla — rimuove l'ultimo evento",
	"/help — questo messaggio",
].join("\n");

export const statoCommand =
	(chatId: number, now: Date) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const openRes = await env.eventRepository.findOpenSession(chatId);
		if (!openRes.success) {
			env.logger.error("stato: findOpenSession failed", openRes.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const open = openRes.data;
		if (!open) {
			await env.bot.sendMessage(chatId, "Nessuna sessione aperta.");
			return;
		}
		const elapsed = formatDuration(now.getTime() - open.startedAt.getTime());
		await env.bot.sendMessage(
			chatId,
			`${cap(LABEL[open.type])} in corso da ${hhmm(open.startedAt)} (${elapsed})`,
		);
	};

export const annullaCommand =
	(chatId: number) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const r = await env.eventRepository.deleteLast(chatId);
		if (!r.success) {
			env.logger.error("annulla: deleteLast failed", r.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		if (!r.data) {
			await env.bot.sendMessage(chatId, "Niente da annullare.");
			return;
		}
		await env.bot.sendMessage(
			chatId,
			`Rimosso: ${LABEL[r.data.type]} delle ${hhmm(r.data.startedAt)}`,
		);
	};

export const helpCommand =
	(chatId: number) =>
	async (env: BotEnv): Promise<void> => {
		await env.bot.sendMessage(chatId, HELP_TEXT);
	};

export const startCommand =
	(chatId: number) =>
	async (env: BotEnv): Promise<void> => {
		await env.bot.sendMessage(chatId, `Ciao! 👋\n\n${HELP_TEXT}`);
	};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: /stato /annulla /help /start commands"
```

---

### Task 11: Report/query commands + report senders (`src/domain/commands.ts`)

**Files:**
- Modify: `src/domain/commands.ts` (append)
- Test: `test/unit/domain/commands.test.ts` (append)

**Interfaces:**
- Consumes (add to imports): `aggregate`, `aggregateWeekly`, `formatDaily`, `formatWeekly` from `./report`; `currentDayWindow`, `currentWeekWindow`, `previousDayWindow`, `previousWeekWindow`, `romeNow`, `type TimeWindow` from `./time`.
- Produces:
  - `oggiCommand(chatId, now): (env: EventEnv & BotEnv & LoggerEnv) => Promise<void>`
  - `ieriCommand(chatId, now): (env) => Promise<void>`
  - `settimanaCommand(chatId, now): (env) => Promise<void>`
  - `sendDailyReport(chatId, now, babyName?): (env: EventEnv & BotEnv & LoggerEnv) => Promise<void>` — yesterday; used by the Plan-2 cron.
  - `sendWeeklyReport(chatId, now, babyName?): (env) => Promise<void>` — previous ISO week; used by the Plan-2 cron.

- [ ] **Step 1: Append failing tests to `test/unit/domain/commands.test.ts`**

```ts
import {
	ieriCommand,
	oggiCommand,
	sendDailyReport,
	sendWeeklyReport,
	settimanaCommand,
} from "../../../src/domain/commands";

const feed = (startIso: string, endIso: string, side?: "dx" | "sx"): BabyEvent => ({
	id: Math.random().toString(),
	chatId: 1,
	userId: 1,
	userName: "papà",
	type: "eat",
	startedAt: new Date(startIso),
	endedAt: new Date(endIso),
	source: "rules",
	rawText: "",
	messageId: 1,
	createdAt: new Date(startIso),
	...(side ? { side } : {}),
});

describe("[COMMANDS] /oggi + /ieri + /settimana", () => {
	it("/oggi aggregates today's events and sends a daily report", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(
			success([feed("2026-07-02T08:00:00+02:00", "2026-07-02T08:30:00+02:00", "dx")]),
		);
		await oggiCommand(1, new Date("2026-07-02T12:00:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Oggi");
		expect(text).toContain("Poppate");
		// window ends at "now"
		const call = mocks.eventRepository.listSince.mock.calls[0];
		expect(call?.[2]?.toISOString()).toBe(
			new Date("2026-07-02T12:00:00+02:00").toISOString(),
		);
	});

	it("/ieri uses yesterday's window", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await ieriCommand(1, new Date("2026-07-02T09:00:00+02:00"))(env);
		const call = mocks.eventRepository.listSince.mock.calls[0];
		expect(call?.[1]?.toISOString()).toBe(
			new Date("2026-07-01T00:00:00+02:00").toISOString(),
		);
		expect(call?.[2]?.toISOString()).toBe(
			new Date("2026-07-02T00:00:00+02:00").toISOString(),
		);
	});

	it("/settimana sends a weekly report", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await settimanaCommand(1, new Date("2026-07-02T09:00:00+02:00"))(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text.toLowerCase()).toContain("settimana");
	});
});

describe("[COMMANDS] report senders", () => {
	it("sendDailyReport includes the baby name when provided", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await sendDailyReport(1, new Date("2026-07-02T09:00:00+02:00"), "Leo")(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Leo");
	});

	it("sendWeeklyReport targets the previous ISO week", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.listSince.mockResolvedValue(success([]));
		await sendWeeklyReport(1, new Date("2026-07-02T09:00:00+02:00"))(env);
		const call = mocks.eventRepository.listSince.mock.calls[0];
		expect(call?.[1]?.toISOString()).toBe(
			new Date("2026-06-22T00:00:00+02:00").toISOString(),
		);
	});
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Extend imports + append implementations in `src/domain/commands.ts`**

Extend the import block at the top:
```ts
import {
	aggregate,
	aggregateWeekly,
	formatDaily,
	formatWeekly,
} from "./report";
import {
	currentDayWindow,
	currentWeekWindow,
	formatDuration,
	hhmm,
	previousDayWindow,
	previousWeekWindow,
	romeNow,
	type TimeWindow,
} from "./time";
```
(Replace the existing `./time` import line — `formatDuration` and `hhmm` are already used by Task 10; keep them.)

Append the use-cases:
```ts
const dailyReport =
	(chatId: number, window: TimeWindow, title: string) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("report: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(chatId, formatDaily(aggregate(evs.data, window), title));
	};

const weeklyReport =
	(chatId: number, window: TimeWindow, title: string) =>
	async (env: EventEnv & BotEnv & LoggerEnv): Promise<void> => {
		const evs = await env.eventRepository.listSince(
			chatId,
			window.start,
			window.end,
		);
		if (!evs.success) {
			env.logger.error("report: listSince failed", evs.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			formatWeekly(aggregateWeekly(evs.data, window), title),
		);
	};

export const oggiCommand = (chatId: number, now: Date) =>
	dailyReport(chatId, currentDayWindow(romeNow(now)), "📊 Oggi");

export const ieriCommand = (chatId: number, now: Date) =>
	dailyReport(chatId, previousDayWindow(romeNow(now)), "📊 Ieri");

export const settimanaCommand = (chatId: number, now: Date) =>
	weeklyReport(chatId, currentWeekWindow(romeNow(now)), "📅 Questa settimana");

export const sendDailyReport = (chatId: number, now: Date, babyName?: string) =>
	dailyReport(
		chatId,
		previousDayWindow(romeNow(now)),
		babyName ? `📊 Ieri — ${babyName}` : "📊 Ieri",
	);

export const sendWeeklyReport = (chatId: number, now: Date, babyName?: string) =>
	weeklyReport(
		chatId,
		previousWeekWindow(romeNow(now)),
		babyName ? `📅 Settimana scorsa — ${babyName}` : "📅 Settimana scorsa",
	);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full check + commit**

Run: `npm run check`
Expected: lint clean, typecheck 0, all tests PASS.
```bash
git add -A
git commit -m "feat: /oggi /ieri /settimana + daily/weekly report senders"
```

---

### Task 12: Console + no-op adapters (`src/adapters/{console,noop}/*`)

**Files:**
- Create: `src/adapters/console/logger.ts`, `src/adapters/console/bot.ts`, `src/adapters/noop/parser.ts`
- Test: `test/unit/adapters/noop/parser.test.ts`

**Interfaces:**
- Produces:
  - `makeLogger(): LoggerEnv["logger"]`
  - `interface ConsoleBotState { lastPendingId?: string | undefined; lastConfirmationMessageId?: number | undefined }`
  - `makeConsoleBot(env: LoggerEnv): { botEnv: BotEnv; state: ConsoleBotState }` — prints replies/reactions/buttons; records the last pending id + confirmation message id so the harness can simulate a button press.
  - `makeNoopParser(): ParserEnv["parser"]` — always `success(null)` (no Gemini locally; only the rules parser is exercised, which the spec explicitly allows).

- [ ] **Step 1: Create `src/adapters/console/logger.ts`**

```ts
import type { LoggerEnv } from "../../domain/logger";

export const makeLogger = (): LoggerEnv["logger"] => console;
```

- [ ] **Step 2: Create `src/adapters/console/bot.ts`**

```ts
import type { BotEnv } from "../../domain/bot";
import type { LoggerEnv } from "../../domain/logger";

export interface ConsoleBotState {
	lastPendingId?: string | undefined;
	lastConfirmationMessageId?: number | undefined;
}

export const makeConsoleBot = (
	_env: LoggerEnv,
): { botEnv: BotEnv; state: ConsoleBotState } => {
	const state: ConsoleBotState = {};
	let msgSeq = 1000;

	const botEnv: BotEnv = {
		bot: {
			sendMessage: async (chatId, text) => {
				console.log(`\n💬 [${chatId}] ${text}`);
			},
			react: async (_chatId, messageId, emoji) => {
				console.log(`\n${emoji}  (reaction su msg ${messageId})`);
			},
			sendConfirmation: async (chatId, text, pendingId) => {
				const mid = ++msgSeq;
				state.lastPendingId = pendingId;
				state.lastConfirmationMessageId = mid;
				console.log(
					`\n⚠️  [${chatId}] ${text}\n   [Conferma] [Annulla]   (pending ${pendingId}, msg ${mid})\n   → scrivi "conf" o "ann"`,
				);
			},
			answerCallback: async (_id, text) => {
				if (text) console.log(`   (callback: ${text})`);
			},
			clearKeyboard: async (_chatId, messageId) => {
				console.log(`   (tastiera rimossa da msg ${messageId})`);
			},
		},
	};

	return { botEnv, state };
};
```

- [ ] **Step 3: Create `src/adapters/noop/parser.ts`**

```ts
import type { ParserEnv } from "../../domain/parse";
import * as R from "../../domain/result";

/** Local fallback with no LLM: never contributes a parse. */
export const makeNoopParser = (): ParserEnv["parser"] => ({
	parse: async () => R.success(null),
});
```

- [ ] **Step 4: Write + run the noop parser test** — `test/unit/adapters/noop/parser.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { makeNoopParser } from "../../../../src/adapters/noop/parser";

describe("[NOOP parser]", () => {
	it("always returns success(null)", async () => {
		const r = await makeNoopParser().parse("qualcosa");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});
});
```

Run: `npx vitest run test/unit/adapters/noop/parser.test.ts && npm run typecheck`
Expected: PASS + typecheck 0.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: console + no-op adapters for local harness"
```

---

### Task 13: `dev:local` stdin harness (`src/dev.ts`)

**Files:**
- Create: `src/dev.ts`
- (Script `dev:local` already added in Task 1.)

**Interfaces:**
- Consumes: all in-memory/console/noop adapters + `handleMessage`, `handleCallback`, `IncomingMessage` from `./domain/bot`, and every command from `./domain/commands`.
- Behavior: reads stdin line-by-line (serialized), routes each line:
  - `conf` / `ann` → simulate pressing the last-shown button (uses `ConsoleBotState`).
  - `/command` → run the matching command (`/stato /oggi /ieri /settimana /annulla /help /start`, plus `/report` and `/report-week` to fire the cron reports locally).
  - otherwise → a message through `handleMessage`. Optional leading `@name` overrides the sender; optional leading `!HH:MM` overrides arrival time (local clock; the Rome resolver still applies).

- [ ] **Step 1: Create `src/dev.ts`**

```ts
import { createInterface } from "node:readline";
import { makeConsoleBot } from "./adapters/console/bot";
import { makeLogger } from "./adapters/console/logger";
import { makeMemoryEventRepository } from "./adapters/memory/event";
import { makeMemoryPendingRepository } from "./adapters/memory/pending";
import { makeNoopParser } from "./adapters/noop/parser";
import {
	type BotEnv,
	handleCallback,
	handleMessage,
	type IncomingMessage,
} from "./domain/bot";
import {
	annullaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	sendDailyReport,
	sendWeeklyReport,
	settimanaCommand,
	startCommand,
	statoCommand,
} from "./domain/commands";
import type { EventEnv } from "./domain/event";
import type { LoggerEnv } from "./domain/logger";
import type { ParserEnv } from "./domain/parse";
import type { PendingEnv } from "./domain/pending";

const DEV_CHAT_ID = 1;
const DEV_USER_ID = 1;

const logger = makeLogger();
const { botEnv, state } = makeConsoleBot({ logger });
const env: BotEnv & EventEnv & PendingEnv & ParserEnv & LoggerEnv = {
	logger,
	eventRepository: makeMemoryEventRepository({ logger }),
	pendingRepository: makeMemoryPendingRepository({ logger }),
	parser: makeNoopParser(),
	...botEnv,
};

let msgSeq = 0;

const parsePrefixes = (
	line: string,
): { at: Date; text: string; user: string } => {
	let text = line;
	let at = new Date();
	let user = "papà";

	const nameMatch = text.match(/^@(\S+)\s+(.*)$/);
	if (nameMatch?.[1]) {
		user = nameMatch[1];
		text = nameMatch[2] ?? "";
	}

	const timeMatch = text.match(/^!(\d{1,2}):(\d{2})\s+(.*)$/);
	if (timeMatch?.[1] && timeMatch[2]) {
		const d = new Date();
		d.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
		at = d;
		text = timeMatch[3] ?? "";
	}

	return { at, text, user };
};

const runCommand = async (cmd: string): Promise<boolean> => {
	const now = new Date();
	switch (cmd) {
		case "/stato":
			await statoCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/oggi":
			await oggiCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/ieri":
			await ieriCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/settimana":
			await settimanaCommand(DEV_CHAT_ID, now)(env);
			return true;
		case "/annulla":
			await annullaCommand(DEV_CHAT_ID)(env);
			return true;
		case "/help":
			await helpCommand(DEV_CHAT_ID)(env);
			return true;
		case "/start":
			await startCommand(DEV_CHAT_ID)(env);
			return true;
		case "/report":
			await sendDailyReport(DEV_CHAT_ID, now)(env);
			return true;
		case "/report-week":
			await sendWeeklyReport(DEV_CHAT_ID, now)(env);
			return true;
		default:
			return false;
	}
};

const handleLine = async (line: string): Promise<void> => {
	const trimmed = line.trim();
	if (!trimmed) return;

	if (trimmed === "conf" || trimmed === "ann") {
		if (!state.lastPendingId) {
			console.log("   (nessuna conferma in sospeso)");
			return;
		}
		await handleCallback({
			id: "cb",
			chatId: DEV_CHAT_ID,
			userId: DEV_USER_ID,
			userName: "papà",
			data: `${trimmed}:${state.lastPendingId}`,
			messageId: state.lastConfirmationMessageId ?? 0,
		})(env);
		state.lastPendingId = undefined;
		return;
	}

	if (trimmed.startsWith("/")) {
		const handled = await runCommand(trimmed);
		if (!handled) console.log(`   (comando sconosciuto: ${trimmed})`);
		return;
	}

	const { at, text, user } = parsePrefixes(trimmed);
	const msg: IncomingMessage = {
		chatId: DEV_CHAT_ID,
		userId: DEV_USER_ID,
		userName: user,
		text,
		messageId: ++msgSeq,
		at,
	};
	await handleMessage(msg)(env);
};

console.log(
	'poppata-bot dev:local — scrivi messaggi (es. "inizio poppata dx 9.15"), /comandi, o conf/ann. Ctrl+D per uscire.',
);

const rl = createInterface({ input: process.stdin });
let chain: Promise<void> = Promise.resolve();
rl.on("line", (line) => {
	chain = chain.then(() => handleLine(line));
});
rl.on("close", () => {
	void chain.then(() => process.exit(0));
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. Note the `ann`/`conf` callback data uses the literal (`ann:` / `conf:`), matching `handleCallback`'s `verb` split.

- [ ] **Step 3: Manual smoke test — happy path**

Run:
```bash
printf '%s\n' \
  "inizio poppata dx 9.15" \
  "fine 9.40" \
  "/stato" \
  "/oggi" \
  "pipì" \
  "/annulla" \
  | npm run dev:local
```
Expected (order): 👍 reaction on the feed start; a "durata poppata: 25m" reply on `fine`; `/stato` → "Nessuna sessione aperta."; `/oggi` → a daily report with 1 feed; 👍 on `pipì`; `/annulla` → "Rimosso: pipì delle …".

- [ ] **Step 4: Manual smoke test — confirmation flow**

Run:
```bash
printf '%s\n' \
  "nanna 22" \
  "inizio poppata 9" \
  "conf" \
  "/stato" \
  | npm run dev:local
```
Expected: `nanna 22` reacts 👍 (sleep open); `inizio poppata 9` → ⚠️ confirmation ("C'è già una nanna aperta…"); `conf` closes the nanna and opens the feed; `/stato` → "Poppata in corso da 9:00 …".

- [ ] **Step 5: Commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: dev:local stdin harness (console bot + memory repos)"
```

---

## Definition of done (Plan 1)

- [ ] `npm run check` is green (Biome + `tsc --noEmit` + all Vitest suites).
- [ ] Both `dev:local` smoke tests (Task 13, Steps 3–4) behave as described.
- [ ] The bot's full behaviour — parse → validate → save/confirm → feedback, all commands, and daily/weekly report rendering — is exercised end-to-end in the terminal with **no** Telegram token, Supabase URL, or Gemini key.

## Deferred to Plan 2 (production wiring)

Explicitly **out of scope here**, to be planned next:

- `src/config.ts` — parse/validate the spec env vars (`BOT_TOKEN`, `ALLOWED_CHAT_ID`, `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `CRON_SECRET`, `WEBHOOK_URL`, `BABY_NAME`).
- `src/adapters/db/pool.ts` (`DBEnv` over a Supabase pooled `pg.Pool`) + `src/adapters/pg/{event,pending}.ts` implementing the ports via `env.db.query`. **Note:** the pg pending adapter must (de)serialize `Intent.at` (a `Date`) to/from the `intent jsonb` column.
- `migrations/<ts>_create-events-and-pending.js` — `events` + `pending_confirmations` tables, indexes, and the partial unique index enforcing one open session per chat.
- `src/adapters/gemini/parse.ts` — `ParserEnv` via Gemini REST (`responseMimeType: application/json` + `responseSchema`), replacing the no-op parser.
- `src/adapters/telegraf/bot.ts` — `BotEnv` via telegraf (`sendMessage`, `setMessageReaction`, inline `[Conferma]/[Annulla]`, `answerCbQuery`, `editMessageReplyMarkup`) + the `ALLOWED_CHAT_ID` allow-list middleware.
- `src/env.ts` (`makeEnv` prod wiring) and `api/webhook.ts`, `api/setup.ts` (webhook + `setMyCommands`), `api/cron/report.ts` (`CRON_SECRET`-guarded; calls `sendDailyReport` daily and `sendWeeklyReport` on Mondays).
- `vercel.json` crons (`0 7 * * *`, accepted winter drift) + function `maxDuration`.
- Optional: `dev:bot` polling harness behind `DEV_BOT_TOKEN`.

## Self-Review notes

- **Spec coverage:** every MVP behaviour that does not require cloud infra is covered (parsing pipeline incl. am/pm-nearest resolver, validation/warning table, 👍-vs-duration feedback, Conferma/Annulla, all six commands, daily+weekly aggregation with midnight-clipping and open-session flagging). Persistence/transport/LLM/cron are intentionally deferred to Plan 2.
- **Deviation from spec file list:** added `src/domain/pending.ts` (entity + port) for a clean boundary mirroring the `pg/pending.ts` adapter split; lifted the Italian `LABEL` map into `event.ts` so `session`/`bot`/`commands` share one source.
- **Env-cleanliness:** the domain never reads env vars; the harness uses fixed `DEV_CHAT_ID`/user. `Europe/Rome` is a code constant.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-02-poppata-bot-core.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batched with checkpoints.

Which approach?
