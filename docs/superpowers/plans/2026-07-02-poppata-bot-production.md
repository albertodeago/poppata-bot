# poppata-bot Production Wiring (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Plan-1 domain core to production infrastructure — Supabase Postgres (via `pg`), Telegram (telegraf webhook), Google Gemini (REST fallback parser), config/env, Vercel serverless handlers (webhook, setup, daily/weekly cron) — so the bot runs live.

**Architecture:** Plan 1's ports (`EventRepository`, `PendingRepository`, `BotEnv`, `ParserEnv`, `DBEnv`, `ConfigEnv`, `LoggerEnv`) get real adapters. `src/env.ts#makeEnv()` composes them; `api/*` Vercel functions register telegraf handlers that call the existing domain use-cases. No domain logic changes except one carried fix (add `rawText` to `PendingConfirmation`). Errors still flow through `Result`; the domain still never imports adapters.

**Tech Stack:** TypeScript (strict, `moduleResolution: bundler`), Node ≥ 24, `pg` + `node-pg-migrate` (Supabase), `telegraf` 4, Gemini REST (`fetch`), `luxon`, `@vercel/node`, Vitest, Biome.

## Global Constraints

- **Node** ≥ 24. **Module system:** `"module": "esnext"`, `"moduleResolution": "bundler"`, target ES2022. Relative imports MUST carry an explicit `.js` extension (`./config.js`) — the deployed Vercel functions run under Node's native ESM loader. `tsc` (bundler), tsx, and Vitest map the `.js` back to the `.ts` source.
- **TypeScript** `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `noUnusedLocals/Parameters`. Never assign `undefined` to an optional prop — conditionally spread (`...(babyName ? { babyName } : {})`).
- **Biome:** tab indentation, double quotes. Run `npm run lint:apply` before every commit. `// biome-ignore lint/suspicious/noExplicitAny: <reason>` is allowed for the dynamically-shaped DB row type only.
- **Errors:** return `Result<T,E>` (`success`/`error`/`tryCatch`); adapters wrap I/O in `tryCatch`; the domain never throws.
- **Env var names (spec, verbatim):** `BOT_TOKEN`, `ALLOWED_CHAT_ID` (number), `DATABASE_URL` (Supabase **pooled** connection, port 6543), `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.0-flash`), `CRON_SECRET`, `WEBHOOK_URL` (base URL), `BABY_NAME` (optional). Timezone `Europe/Rome` stays a code constant.
- **Ports & idioms** (from Plan 1, do not redefine): `Result<T,E>`/`success`/`error`/`tryCatch` in `src/domain/result.ts`; `LoggerEnv` in `src/domain/logger.ts`; `BabyEvent`/`EventType`/`Side`/`EventSource`/`NewBabyEvent`/`EventRepository`/`EventEnv`/`isOpenSession`/`LABEL` in `src/domain/event.ts`; `Intent`/`Action`/`GeminiParse`/`ParserEnv`/`parseRules`/`normalize` in `src/domain/parse.ts`; `PendingConfirmation`/`NewPendingConfirmation`/`PendingRepository`/`PendingEnv` in `src/domain/pending.ts`; `BotEnv`/`IncomingMessage`/`IncomingCallback`/`handleMessage`/`handleCallback` in `src/domain/bot.ts`; command use-cases + `sendDailyReport`/`sendWeeklyReport` in `src/domain/commands.ts`.
- **DB row ergonomics:** `pg` returns `bigint`/`int8` columns as **strings** and `timestamptz` as JS **Date**. Row mappers must `Number(...)` the id/chat/message columns.
- **pgbouncer (Supabase pooled, 6543):** transaction-pooling mode — do not rely on session state or named prepared statements. `pg` parameterized queries (unnamed) are fine.
- **Callback data format** (already produced by `handleCallback`'s split on `:`): `conf:<pendingId>` / `ann:<pendingId>`.
- **Commit style:** one commit per task, `feat:`/`chore:`/`refactor:` prefix, imperative subject.

## Reference project

`/Users/albertodeagostini/sources/personal/wehimanbot` is the sibling project these patterns mirror (telegraf adapter, `pg` `DBEnv`, `api/webhook.ts`, `api/setup.ts`, `api/cron/*`, `node-pg-migrate` migrations, `vercel.json`). Consult it for idioms, but this plan's code is authoritative where they differ (e.g. env var names).

---

## File Structure (this plan)

```
package.json          # + deps (pg, telegraf, @vercel/node), devDeps (@types/pg, node-pg-migrate, dotenv), scripts (build, migrate:*)
tsconfig.json         # include "api/**/*"
biome.json            # includes "api/**/*.ts"
migrate-config.js     # node-pg-migrate runner config (ESM, dotenv)
vercel.json           # crons (0 7 * * * UTC) + function maxDuration
migrations/<ts>_create-events-and-pending.js
src/
  config.ts           # Config, ConfigEnv, getConfig() — env parsing/validation
  domain/
    db.ts             # DBEnv port (low-level query)
    pending.ts        # + rawText field (carried fix)
    bot.ts            # createPending stores rawText; confirm ctx uses p.rawText (carried fix)
  adapters/
    db/pool.ts        # pg Pool -> DBEnv
    pg/event.ts       # EventRepository over env.db.query
    pg/pending.ts     # PendingRepository over env.db.query (+ intent jsonb (de)serialize)
    gemini/parse.ts   # ParserEnv via Gemini REST
    telegraf/bot.ts   # BotEnv via telegraf + ALLOWED_CHAT_ID allow-list middleware
  env.ts              # makeEnv() prod wiring
api/
  webhook.ts          # POST Telegram updates -> handlers -> domain use-cases
  setup.ts            # POST: setWebhook + setMyCommands
  cron/report.ts      # CRON_SECRET-guarded daily (+ Monday weekly) report + stale-pending sweep
test/unit/
  config.test.ts
  adapters/pg/{event,pending}.test.ts
  adapters/gemini/parse.test.ts
  adapters/telegraf/bot.test.ts
  api/cron/report.test.ts
```

---

### Task 1: Carry-over fix — `rawText` on `PendingConfirmation`

**Why:** At confirm time, `handleCallback` currently sets the event context `rawText` to `p.warning` (the bot's own prompt) because the pending row didn't carry the user's original text. Harmless with in-memory storage, but wrong for the `raw_text` DB column in Plan 2. Add `rawText` to the pending entity and thread it through.

**Files:**
- Modify: `src/domain/pending.ts`, `src/domain/bot.ts`
- Modify (tests): `test/unit/adapters/memory/pending.test.ts`, `test/unit/domain/bot.test.ts`

**Interfaces:**
- Produces: `PendingConfirmation` (and `NewPendingConfirmation`) now include `rawText: string`.

- [ ] **Step 1: Add `rawText` to the entity** — `src/domain/pending.ts`

Change the interface (add `rawText` after `userName`):
```ts
export interface PendingConfirmation {
	id: string;
	chatId: number;
	userId: number;
	userName: string;
	rawText: string;
	intent: Intent;
	warning: string;
	/** The original user message this confirmation is about. */
	messageId: number;
	createdAt: Date;
}
```
(`NewPendingConfirmation = Omit<PendingConfirmation, "id" | "createdAt">` automatically gains `rawText` — no change needed there.)

- [ ] **Step 2: Store `rawText` when creating a pending** — `src/domain/bot.ts`, in `createPending`

Change the `create({...})` call to include `rawText`:
```ts
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning,
		messageId: ctx.messageId,
	});
```

- [ ] **Step 3: Use the stored `rawText` on confirm** — `src/domain/bot.ts`, in `handleCallback`

Change the confirm-branch context from `rawText: p.warning` to `rawText: p.rawText`:
```ts
		const ctx: EventContext = {
			chatId: p.chatId,
			userId: p.userId,
			userName: p.userName,
			messageId: p.messageId,
			rawText: p.rawText,
		};
```

- [ ] **Step 4: Update the memory-pending test fixture** — `test/unit/adapters/memory/pending.test.ts`

In the `newPending()` helper, add `rawText` to the returned object:
```ts
const newPending = (): NewPendingConfirmation => ({
	chatId: 1,
	userId: 1,
	userName: "a",
	rawText: "inizio poppata 9",
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
```

- [ ] **Step 5: Update the bot-test `pending()` fixture + lock the fix with an assertion** — `test/unit/domain/bot.test.ts`

In the `pending()` helper add `rawText`:
```ts
const pending = (over: Partial<PendingConfirmation>): PendingConfirmation => ({
	id: "p1",
	chatId: 1,
	userId: 1,
	userName: "papà",
	rawText: "credo abbia fatto la popo",
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
```
Then, in the existing `"confirm applies the intent, reacts, clears keyboard, deletes pending"` test, after the existing `insert` assertion, add:
```ts
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.rawText).toBe(
			"credo abbia fatto la popo",
		);
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck exit 0; all tests PASS (70 + the new assertion still counts within its existing test). If any handleMessage test constructed a pending expectation by object equality, it would surface here — none do (they use `stringContaining`/`any`).

- [ ] **Step 7: Commit**

```bash
npm run lint:apply
git add -A
git commit -m "refactor: carry user rawText into PendingConfirmation for confirmed events"
```

---

### Task 2: Production tooling (deps, scripts, config, api includes)

**Files:**
- Modify: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `biome.json`
- Create: `migrate-config.js`

**Interfaces:**
- Produces: `pg`, `telegraf`, `@vercel/node` available at runtime; `node-pg-migrate` + `dotenv` + `@types/pg` for dev; `migrate:*` + `build` npm scripts; `api/**` type-checked and linted.

- [ ] **Step 1: Add dependencies + scripts to `package.json`**

Merge these into the existing `package.json` (keep existing fields/scripts):
- `dependencies`: add `"pg": "^8.16.3"`, `"telegraf": "^4.16.3"`, `"@vercel/node": "^5.3.24"` (keep existing `"luxon"`).
- `devDependencies`: add `"@types/pg": "^8.15.5"`, `"node-pg-migrate": "^8.0.3"`, `"dotenv": "^17.2.3"` (keep existing).
- `scripts`: add
```json
    "build": "rm -rf dist && tsc --project tsconfig.build.json",
    "migrate:create": "node-pg-migrate -m migrations create --",
    "migrate:up": "node-pg-migrate -m migrations up",
    "migrate:down": "node-pg-migrate -m migrations down",
    "migrate:retry": "node-pg-migrate -m migrations retry"
```

- [ ] **Step 2: Include `api/**` in `tsconfig.json`**

Change the `include` array to:
```json
  "include": ["src/**/*", "test/**/*", "api/**/*"],
```

- [ ] **Step 3: Exclude non-source from the build config** — `tsconfig.build.json`

Replace its contents (so `tsc -p tsconfig.build.json` doesn't try to compile the vitest config, and skips tests):
```json
{
	"extends": "./tsconfig.json",
	"exclude": ["test", "vitest.config.mts"]
}
```

- [ ] **Step 4: Lint `api/**` too** — `biome.json`

Change the `files.includes` array to:
```json
	"files": { "ignoreUnknown": false, "includes": ["src/**/*.ts", "test/**/*.ts", "api/**/*.ts"] },
```

- [ ] **Step 5: Create `migrate-config.js`** (ESM; `type: module` is set)

```js
// @ts-check
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });

/** @type {import('node-pg-migrate').RunnerOption} */
const config = {
	databaseUrl: process.env.DATABASE_URL,
	migrationsTable: "pgmigrations",
	dir: "migrations",
	direction: "up",
};

export default config;
```

- [ ] **Step 6: Install + verify nothing broke**

Run: `npm install && npm run typecheck && npx vitest run`
Expected: install succeeds; typecheck exit 0; all existing tests still PASS (no new source yet).

- [ ] **Step 7: Commit**

```bash
npm run lint:apply
git add -A
git commit -m "chore: add pg/telegraf/vercel deps, migrate + build scripts, api build includes"
```

---

### Task 3: Config (`src/config.ts`)

**Files:**
- Create: `src/config.ts`
- Test: `test/unit/config.test.ts`

**Interfaces:**
- Produces:
  - `type Config = { botToken; allowedChatId: number; databaseUrl; geminiApiKey; geminiModel; cronSecret; webhookUrl; babyName? }`
  - `type ConfigEnv = { config: Config }`
  - `getConfig(): Config` — reads/validates env; throws on missing required or non-numeric `ALLOWED_CHAT_ID`; defaults `geminiModel` to `"gemini-2.0-flash"`; `babyName` present only when the env var is set.

- [ ] **Step 1: Write the failing test** — `test/unit/config.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";

const FULL_ENV = {
	BOT_TOKEN: "tok",
	ALLOWED_CHAT_ID: "12345",
	DATABASE_URL: "postgres://x",
	GEMINI_API_KEY: "gk",
	CRON_SECRET: "cs",
	WEBHOOK_URL: "https://ex.com",
};

describe("[CONFIG] getConfig", () => {
	let saved: NodeJS.ProcessEnv;
	beforeEach(() => {
		saved = { ...process.env };
		for (const k of [
			"BOT_TOKEN",
			"ALLOWED_CHAT_ID",
			"DATABASE_URL",
			"GEMINI_API_KEY",
			"GEMINI_MODEL",
			"CRON_SECRET",
			"WEBHOOK_URL",
			"BABY_NAME",
		]) {
			delete process.env[k];
		}
	});
	afterEach(() => {
		process.env = saved;
	});

	it("parses a full environment", () => {
		Object.assign(process.env, FULL_ENV, { BABY_NAME: "Leo" });
		const c = getConfig();
		expect(c.botToken).toBe("tok");
		expect(c.allowedChatId).toBe(12345);
		expect(c.geminiModel).toBe("gemini-2.0-flash"); // default
		expect(c.babyName).toBe("Leo");
	});

	it("omits babyName when unset", () => {
		Object.assign(process.env, FULL_ENV);
		const c = getConfig();
		expect(c.babyName).toBeUndefined();
	});

	it("uses GEMINI_MODEL override when set", () => {
		Object.assign(process.env, FULL_ENV, { GEMINI_MODEL: "gemini-x" });
		expect(getConfig().geminiModel).toBe("gemini-x");
	});

	it("throws when a required var is missing", () => {
		Object.assign(process.env, FULL_ENV);
		delete process.env.BOT_TOKEN;
		expect(() => getConfig()).toThrow(/BOT_TOKEN/);
	});

	it("throws when ALLOWED_CHAT_ID is not numeric", () => {
		Object.assign(process.env, FULL_ENV, { ALLOWED_CHAT_ID: "nope" });
		expect(() => getConfig()).toThrow(/ALLOWED_CHAT_ID/);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/config.test.ts`
Expected: FAIL — cannot resolve `../../src/config`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
export type Config = {
	botToken: string;
	allowedChatId: number;
	databaseUrl: string;
	geminiApiKey: string;
	geminiModel: string;
	cronSecret: string;
	webhookUrl: string;
	babyName?: string;
};

export type ConfigEnv = {
	config: Config;
};

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set in the environment`);
	return value;
};

export const getConfig = (): Config => {
	const allowedChatId = Number.parseInt(required("ALLOWED_CHAT_ID"), 10);
	if (Number.isNaN(allowedChatId)) {
		throw new Error("ALLOWED_CHAT_ID must be a number");
	}

	const config: Config = {
		botToken: required("BOT_TOKEN"),
		allowedChatId,
		databaseUrl: required("DATABASE_URL"),
		geminiApiKey: required("GEMINI_API_KEY"),
		geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
		cronSecret: required("CRON_SECRET"),
		webhookUrl: required("WEBHOOK_URL"),
		...(process.env.BABY_NAME ? { babyName: process.env.BABY_NAME } : {}),
	};
	return config;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/config.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: config env parsing/validation"
```

---

### Task 4: DB port + pg pool (`src/domain/db.ts`, `src/adapters/db/pool.ts`)

**Files:**
- Create: `src/domain/db.ts`, `src/adapters/db/pool.ts`

**Interfaces:**
- Consumes: `ConfigEnv` from `../../config`; `LoggerEnv` from `../../domain/logger`.
- Produces:
  - `type DBEnv = { db: { query(sql: string, params?: unknown[]): Promise<any[]> } }` (rows are dynamically shaped — the single sanctioned `any`).
  - `makePgPool(env: ConfigEnv & LoggerEnv): DBEnv["db"]` — a `pg.Pool` (max 1, serverless-friendly), acquiring/releasing a client per query.
- Note: no unit test — this is thin I/O over a live DB (the reference has none either). Verified by typecheck; exercised for real by the pg adapter tasks against a mocked `db.query`, and end-to-end at deploy.

- [ ] **Step 1: Create `src/domain/db.ts`**

```ts
export type DBEnv = {
	db: {
		// biome-ignore lint/suspicious/noExplicitAny: DB rows are dynamically shaped
		query(sql: string, params?: unknown[]): Promise<any[]>;
	};
};
```

- [ ] **Step 2: Create `src/adapters/db/pool.ts`**

```ts
import { Pool } from "pg";
import type { ConfigEnv } from "../../config";
import type { DBEnv } from "../../domain/db";
import type { LoggerEnv } from "../../domain/logger";

/** pg Pool over the Supabase pooled connection (port 6543). max 1 for serverless. */
export const makePgPool = (env: ConfigEnv & LoggerEnv): DBEnv["db"] => {
	const pool = new Pool({ connectionString: env.config.databaseUrl, max: 1 });

	pool.on("error", (err) => {
		env.logger.error("Unexpected error on idle pg client", err);
	});

	env.logger.info("pg pool initialized");

	return {
		query: async (sql, params) => {
			const client = await pool.connect();
			try {
				const result = await client.query(sql, params);
				return result.rows;
			} finally {
				client.release();
			}
		},
	};
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: DBEnv port + pg pool adapter"
```

---

### Task 5: Migration — `events` + `pending_confirmations`

**Files:**
- Create: `migrations/<timestamp>_create-events-and-pending.js` (node-pg-migrate; ESM)

**Interfaces:**
- Produces the schema the pg adapters (Tasks 6–7) read/write: `events` (matches `BabyEvent`) and `pending_confirmations` (matches `PendingConfirmation`, incl. `raw_text` and `intent jsonb`), with a **partial unique index** enforcing at most one open eat/sleep session per chat.

- [ ] **Step 1: Create the migration file with a millisecond-timestamp prefix**

node-pg-migrate orders migrations by a numeric prefix. Generate one and create the file:
```bash
cd /Users/albertodeagostini/sources/personal/poppata-bot
TS=$(node -e "console.log(Date.now())")
echo "migrations/${TS}_create-events-and-pending.js"
```
Create `migrations/${TS}_create-events-and-pending.js` with EXACTLY this content (ESM — the project is `type: module`; do NOT use `exports.up`):

```js
import { PgLiteral } from "node-pg-migrate";

/** @type {import('node-pg-migrate').ColumnDefinitions} */
export const shorthands = {
	id: {
		type: "uuid",
		primaryKey: true,
		default: new PgLiteral("gen_random_uuid()"),
	},
	created_at: {
		type: "timestamptz",
		notNull: true,
		default: new PgLiteral("NOW()"),
	},
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	pgm.createTable("events", {
		id: "id",
		chat_id: { type: "bigint", notNull: true },
		user_id: { type: "bigint", notNull: true },
		user_name: { type: "text", notNull: true },
		type: { type: "text", notNull: true },
		side: { type: "text", notNull: false },
		started_at: { type: "timestamptz", notNull: true },
		ended_at: { type: "timestamptz", notNull: false },
		source: { type: "text", notNull: true },
		raw_text: { type: "text", notNull: true },
		message_id: { type: "bigint", notNull: true },
		created_at: "created_at",
	});
	pgm.createIndex("events", ["chat_id", "started_at"]);
	// Invariant: at most one open eat/sleep session per chat.
	pgm.createIndex("events", "chat_id", {
		name: "one_open_session_per_chat",
		unique: true,
		where: "ended_at IS NULL AND type IN ('eat','sleep')",
	});

	pgm.createTable("pending_confirmations", {
		id: "id",
		chat_id: { type: "bigint", notNull: true },
		user_id: { type: "bigint", notNull: true },
		user_name: { type: "text", notNull: true },
		raw_text: { type: "text", notNull: true },
		intent: { type: "jsonb", notNull: true },
		warning: { type: "text", notNull: true },
		message_id: { type: "bigint", notNull: true },
		created_at: "created_at",
	});
	pgm.createIndex("pending_confirmations", "chat_id");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropTable("pending_confirmations");
	pgm.dropTable("events");
};
```

- [ ] **Step 2: Syntax-check the migration**

Run: `node --check migrations/${TS}_create-events-and-pending.js`
Expected: no output, exit 0.

- [ ] **Step 3: Apply it if you have a database (otherwise it runs at deploy)**

If a Supabase (or local) Postgres is reachable via `DATABASE_URL` in `.env`:
Run: `npm run migrate:up`
Expected: migration applies; verify in psql/Supabase that `events` and `pending_confirmations` exist and that `\d events` shows the partial unique index `one_open_session_per_chat`.
If no DB is available in this environment, note that in the report — the migration is syntax-checked and will run in CI/deploy.

- [ ] **Step 4: Commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: migration for events + pending_confirmations (partial open-session unique index)"
```

---

### Task 6: pg event repository (`src/adapters/pg/event.ts`)

**Files:**
- Create: `src/adapters/pg/event.ts`
- Test: `test/unit/adapters/pg/event.test.ts`

**Interfaces:**
- Consumes: `DBEnv` from `../../domain/db`; `LoggerEnv`; `BabyEvent`/`EventType`/`Side`/`EventRepository`/`NewBabyEvent` from `../../domain/event`; `tryCatch` from `../../domain/result`.
- Produces: `makePgEventRepository(env: DBEnv & LoggerEnv): EventRepository`.
- Behaviour: same contract as the in-memory repo. `bigint` columns come back as strings → `Number(...)`; `timestamptz` as Date. Optional `side`/`ended_at` mapped conditionally.

- [ ] **Step 1: Write the failing test** — `test/unit/adapters/pg/event.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { makePgEventRepository } from "../../../../src/adapters/pg/event";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const row = (over: Record<string, unknown> = {}) => ({
	id: "e1",
	chat_id: "1",
	user_id: "2",
	user_name: "papà",
	type: "eat",
	side: "dx",
	started_at: new Date("2026-07-02T09:00:00Z"),
	ended_at: null,
	source: "rules",
	raw_text: "inizio poppata dx 9",
	message_id: "100",
	created_at: new Date("2026-07-02T09:00:00Z"),
	...over,
});

describe("[PG event repo]", () => {
	it("insert maps the returned row and passes params in column order", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.insert({
			chatId: 1,
			userId: 2,
			userName: "papà",
			type: "eat",
			side: "dx",
			startedAt: new Date("2026-07-02T09:00:00Z"),
			source: "rules",
			rawText: "inizio poppata dx 9",
			messageId: 100,
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.chatId).toBe(1);
			expect(r.data.messageId).toBe(100);
			expect(r.data.side).toBe("dx");
			expect(r.data.endedAt).toBeUndefined();
		}
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO events");
		// side present, ended_at null (position 7)
		expect(params?.[4]).toBe("dx");
		expect(params?.[6]).toBeNull();
	});

	it("insert passes null for an absent side", async () => {
		const db = { query: vi.fn().mockResolvedValue([row({ side: null })]) };
		const repo = makePgEventRepository({ db, logger });
		await repo.insert({
			chatId: 1,
			userId: 2,
			userName: "papà",
			type: "sleep",
			startedAt: new Date(),
			source: "rules",
			rawText: "nanna",
			messageId: 1,
		});
		const params = db.query.mock.calls[0]?.[1];
		expect(params?.[4]).toBeNull();
	});

	it("findOpenSession returns null when no rows", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findOpenSession(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});

	it("closeSession maps ended_at", async () => {
		const ended = new Date("2026-07-02T09:40:00Z");
		const db = { query: vi.fn().mockResolvedValue([row({ ended_at: ended })]) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.closeSession("e1", ended);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.endedAt).toEqual(ended);
	});

	it("listSince maps all rows and passes the window params", async () => {
		const db = { query: vi.fn().mockResolvedValue([row(), row({ id: "e2" })]) };
		const repo = makePgEventRepository({ db, logger });
		const start = new Date("2026-07-01T00:00:00Z");
		const end = new Date("2026-07-02T00:00:00Z");
		const r = await repo.listSince(1, start, end);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toHaveLength(2);
		expect(db.query.mock.calls[0]?.[1]).toEqual([1, start, end]);
	});

	it("returns an error Result when the query throws", async () => {
		const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };
		const repo = makePgEventRepository({ db, logger });
		const r = await repo.findOpenSession(1);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("db down");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/adapters/pg/event.test.ts`
Expected: FAIL — cannot resolve the adapter.

- [ ] **Step 3: Implement `src/adapters/pg/event.ts`**

```ts
import type { DBEnv } from "../../domain/db";
import type {
	BabyEvent,
	EventRepository,
	EventSource,
	EventType,
	NewBabyEvent,
	Side,
} from "../../domain/event";
import type { LoggerEnv } from "../../domain/logger";
import { tryCatch } from "../../domain/result";

interface EventRow {
	id: string;
	chat_id: string;
	user_id: string;
	user_name: string;
	type: string;
	side: string | null;
	started_at: Date;
	ended_at: Date | null;
	source: string;
	raw_text: string;
	message_id: string;
	created_at: Date;
}

const mapRow = (row: EventRow): BabyEvent => {
	const event: BabyEvent = {
		id: row.id,
		chatId: Number(row.chat_id),
		userId: Number(row.user_id),
		userName: row.user_name,
		type: row.type as EventType,
		startedAt: new Date(row.started_at),
		source: row.source as EventSource,
		rawText: row.raw_text,
		messageId: Number(row.message_id),
		createdAt: new Date(row.created_at),
	};
	if (row.side) event.side = row.side as Side;
	if (row.ended_at) event.endedAt = new Date(row.ended_at);
	return event;
};

export const makePgEventRepository = (
	env: DBEnv & LoggerEnv,
): EventRepository => ({
	insert: (event: NewBabyEvent) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`INSERT INTO events
				 (chat_id, user_id, user_name, type, side, started_at, ended_at, source, raw_text, message_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				 RETURNING *`,
				[
					event.chatId,
					event.userId,
					event.userName,
					event.type,
					event.side ?? null,
					event.startedAt,
					event.endedAt ?? null,
					event.source,
					event.rawText,
					event.messageId,
				],
			);
			if (!rows[0]) throw new Error("insert returned no row");
			return mapRow(rows[0]);
		}, (e) => e),

	findOpenSession: (chatId) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`SELECT * FROM events
				 WHERE chat_id = $1 AND ended_at IS NULL AND type IN ('eat','sleep')
				 ORDER BY started_at DESC LIMIT 1`,
				[chatId],
			);
			return rows[0] ? mapRow(rows[0]) : null;
		}, (e) => e),

	closeSession: (id, endedAt) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`UPDATE events SET ended_at = $2 WHERE id = $1 RETURNING *`,
				[id, endedAt],
			);
			if (!rows[0]) throw new Error("closeSession: session not found");
			return mapRow(rows[0]);
		}, (e) => e),

	deleteLast: (chatId) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`DELETE FROM events
				 WHERE id = (
				   SELECT id FROM events WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1
				 )
				 RETURNING *`,
				[chatId],
			);
			return rows[0] ? mapRow(rows[0]) : null;
		}, (e) => e),

	listSince: (chatId, start, end) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`SELECT * FROM events
				 WHERE chat_id = $1 AND started_at < $3
				   AND ( (type IN ('pee','poop') AND started_at >= $2)
				      OR (type IN ('eat','sleep') AND (ended_at IS NULL OR ended_at > $2)) )
				 ORDER BY started_at`,
				[chatId, start, end],
			);
			return rows.map(mapRow);
		}, (e) => e),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/adapters/pg/event.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: pg event repository"
```

---

### Task 7: pg pending repository (`src/adapters/pg/pending.ts`)

**Files:**
- Create: `src/adapters/pg/pending.ts`
- Test: `test/unit/adapters/pg/pending.test.ts`

**Interfaces:**
- Consumes: `DBEnv`, `LoggerEnv`, `Intent`/`Action` from `../../domain/parse`, `EventType`/`Side`/`EventSource` from `../../domain/event`, `NewPendingConfirmation`/`PendingConfirmation`/`PendingRepository` from `../../domain/pending`, `tryCatch`.
- Produces: `makePgPendingRepository(env: DBEnv & LoggerEnv): PendingRepository`.
- Behaviour: `intent` is stored in the `jsonb` column with `at` serialized to an ISO string and rehydrated to a `Date` on read. `rawText` persisted/loaded. `deleteStale` returns the number of rows removed.

- [ ] **Step 1: Write the failing test** — `test/unit/adapters/pg/pending.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { makePgPendingRepository } from "../../../../src/adapters/pg/pending";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const intentJson = {
	type: "eat",
	action: "start",
	at: "2026-07-02T07:00:00.000Z",
	source: "rules",
	confidence: 1,
	side: "dx",
};

const row = (over: Record<string, unknown> = {}) => ({
	id: "p1",
	chat_id: "1",
	user_id: "2",
	user_name: "papà",
	raw_text: "inizio poppata dx 9",
	intent: intentJson,
	warning: "sospetto",
	message_id: "100",
	created_at: new Date("2026-07-02T07:00:00Z"),
	...over,
});

describe("[PG pending repo]", () => {
	it("create serializes intent.at to ISO and rehydrates on the returned row", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.create({
			chatId: 1,
			userId: 2,
			userName: "papà",
			rawText: "inizio poppata dx 9",
			intent: {
				type: "eat",
				action: "start",
				at: new Date("2026-07-02T07:00:00Z"),
				source: "rules",
				confidence: 1,
				side: "dx",
			},
			warning: "sospetto",
			messageId: 100,
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.rawText).toBe("inizio poppata dx 9");
			expect(r.data.intent.at).toBeInstanceOf(Date);
			expect(r.data.intent.at.toISOString()).toBe("2026-07-02T07:00:00.000Z");
			expect(r.data.intent.side).toBe("dx");
		}
		const params = db.query.mock.calls[0]?.[1];
		expect(params?.[3]).toBe("inizio poppata dx 9"); // raw_text
		const storedIntent = JSON.parse(params?.[4]); // intent jsonb (stringified)
		expect(storedIntent.at).toBe("2026-07-02T07:00:00.000Z");
		expect(storedIntent.side).toBe("dx");
	});

	it("get returns null when missing", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.get("nope");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});

	it("delete resolves to void success", async () => {
		const db = { query: vi.fn().mockResolvedValue([]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.delete("p1");
		expect(r.success).toBe(true);
		expect(db.query.mock.calls[0]?.[0]).toContain("DELETE FROM pending_confirmations");
	});

	it("deleteStale returns the deleted count", async () => {
		const db = { query: vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]) };
		const repo = makePgPendingRepository({ db, logger });
		const r = await repo.deleteStale(new Date());
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe(2);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/adapters/pg/pending.test.ts`
Expected: FAIL — cannot resolve the adapter.

- [ ] **Step 3: Implement `src/adapters/pg/pending.ts`**

```ts
import type { DBEnv } from "../../domain/db";
import type { EventSource, EventType, Side } from "../../domain/event";
import type { LoggerEnv } from "../../domain/logger";
import type { Action, Intent } from "../../domain/parse";
import type {
	NewPendingConfirmation,
	PendingConfirmation,
	PendingRepository,
} from "../../domain/pending";
import { tryCatch } from "../../domain/result";

interface IntentJson {
	type: string;
	action: string;
	at: string;
	source: string;
	confidence: number;
	side?: string;
}

const serializeIntent = (i: Intent): IntentJson => ({
	type: i.type,
	action: i.action,
	at: i.at.toISOString(),
	source: i.source,
	confidence: i.confidence,
	...(i.side ? { side: i.side } : {}),
});

const deserializeIntent = (o: IntentJson): Intent => {
	const intent: Intent = {
		type: o.type as EventType,
		action: o.action as Action,
		at: new Date(o.at),
		source: o.source as EventSource,
		confidence: o.confidence,
	};
	if (o.side) intent.side = o.side as Side;
	return intent;
};

interface PendingRow {
	id: string;
	chat_id: string;
	user_id: string;
	user_name: string;
	raw_text: string;
	intent: IntentJson;
	warning: string;
	message_id: string;
	created_at: Date;
}

const mapRow = (row: PendingRow): PendingConfirmation => ({
	id: row.id,
	chatId: Number(row.chat_id),
	userId: Number(row.user_id),
	userName: row.user_name,
	rawText: row.raw_text,
	intent: deserializeIntent(row.intent),
	warning: row.warning,
	messageId: Number(row.message_id),
	createdAt: new Date(row.created_at),
});

export const makePgPendingRepository = (
	env: DBEnv & LoggerEnv,
): PendingRepository => ({
	create: (p: NewPendingConfirmation) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`INSERT INTO pending_confirmations
				 (chat_id, user_id, user_name, raw_text, intent, warning, message_id)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)
				 RETURNING *`,
				[
					p.chatId,
					p.userId,
					p.userName,
					p.rawText,
					JSON.stringify(serializeIntent(p.intent)),
					p.warning,
					p.messageId,
				],
			);
			if (!rows[0]) throw new Error("create pending returned no row");
			return mapRow(rows[0]);
		}, (e) => e),

	get: (id) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`SELECT * FROM pending_confirmations WHERE id = $1`,
				[id],
			);
			return rows[0] ? mapRow(rows[0]) : null;
		}, (e) => e),

	delete: (id) =>
		tryCatch(async () => {
			await env.db.query(`DELETE FROM pending_confirmations WHERE id = $1`, [id]);
			return undefined;
		}, (e) => e),

	deleteStale: (olderThan) =>
		tryCatch(async () => {
			const rows = await env.db.query(
				`DELETE FROM pending_confirmations WHERE created_at < $1 RETURNING id`,
				[olderThan],
			);
			return rows.length;
		}, (e) => e),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/adapters/pg/pending.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: pg pending repository (intent jsonb round-trip)"
```

---

### Task 8: Gemini REST parser (`src/adapters/gemini/parse.ts`)

**Files:**
- Create: `src/adapters/gemini/parse.ts`
- Test: `test/unit/adapters/gemini/parse.test.ts`

**Interfaces:**
- Consumes: `ConfigEnv`, `LoggerEnv`, `GeminiParse`/`ParserEnv` from `../../domain/parse`, `success` from `../../domain/result`.
- Produces: `makeGeminiParser(env: ConfigEnv & LoggerEnv): ParserEnv["parser"]`.
- Behaviour: POSTs to `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent` with header `x-goog-api-key`, `responseMimeType: "application/json"` + a `responseSchema`. Reads `candidates[0].content.parts[0].text`, `JSON.parse`s it. Maps to `GeminiParse`; a `type: "other"` result or any failure (HTTP error, no text, parse error) → `success(null)` so `handleMessage` degrades to the help hint. `side: "none"` and `hour < 0` are treated as absent.
- **Design note (accepted MVP behaviour):** a low-confidence Gemini intent still routes through `handleMessage`'s confidence check → confirm prompt; it does NOT pass through `decide()`. So a low-confidence `end` with no open session would be confirmed and then produce the generic error on apply. Acceptable for MVP; revisit if it proves annoying.

- [ ] **Step 1: Write the failing test** — `test/unit/adapters/gemini/parse.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGeminiParser } from "../../../../src/adapters/gemini/parse";

const env = {
	config: {
		botToken: "b",
		allowedChatId: 1,
		databaseUrl: "d",
		geminiApiKey: "k",
		geminiModel: "gemini-2.0-flash",
		cronSecret: "c",
		webhookUrl: "w",
	},
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() },
};

const geminiOk = (obj: unknown) => ({
	ok: true,
	json: async () => ({
		candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
	}),
});

afterEach(() => vi.unstubAllGlobals());

describe("[GEMINI parser]", () => {
	it("maps a confident parse and drops side/hour sentinels", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				geminiOk({ type: "poop", action: "instant", side: "none", hour: -1, minute: 0, confidence: 0.9 }),
			),
		);
		const r = await makeGeminiParser(env).parse("credo abbia fatto");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toEqual({ type: "poop", action: "instant", confidence: 0.9 });
	});

	it("keeps side and time when present", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				geminiOk({ type: "eat", action: "start", side: "dx", hour: 9, minute: 15, confidence: 0.8 }),
			),
		);
		const r = await makeGeminiParser(env).parse("poppata");
		if (r.success)
			expect(r.data).toEqual({ type: "eat", action: "start", side: "dx", hour: 9, minute: 15, confidence: 0.8 });
	});

	it("returns null for type 'other'", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiOk({ type: "other", action: "instant", confidence: 0.1 })));
		const r = await makeGeminiParser(env).parse("ciao");
		if (r.success) expect(r.data).toBeNull();
	});

	it("posts the schema + api key and returns null on HTTP error", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
		vi.stubGlobal("fetch", fetchMock);
		const r = await makeGeminiParser(env).parse("x");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toContain("gemini-2.0-flash:generateContent");
		expect(call?.[1]?.headers["x-goog-api-key"]).toBe("k");
		const body = JSON.parse(call?.[1]?.body);
		expect(body.generationConfig.responseMimeType).toBe("application/json");
		expect(body.generationConfig.responseSchema.required).toContain("type");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/adapters/gemini/parse.test.ts`
Expected: FAIL — cannot resolve the adapter.

- [ ] **Step 3: Implement `src/adapters/gemini/parse.ts`**

```ts
import type { ConfigEnv } from "../../config";
import type { LoggerEnv } from "../../domain/logger";
import type { GeminiParse, ParserEnv } from "../../domain/parse";
import { success } from "../../domain/result";

const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		type: { type: "string", enum: ["eat", "sleep", "pee", "poop", "other"] },
		action: { type: "string", enum: ["start", "end", "instant"] },
		side: { type: "string", enum: ["dx", "sx", "none"] },
		hour: { type: "integer" },
		minute: { type: "integer" },
		confidence: { type: "number" },
	},
	required: ["type", "action", "confidence"],
};

const PROMPT = [
	"Sei un parser per un bot che traccia le attività di un neonato.",
	"Classifica il messaggio in un'attività: eat (poppata), sleep (nanna), pee (pipì), poop (cacca).",
	"action: start (inizio), end (fine); pee e poop sono sempre instant.",
	'side: dx o sx solo per eat, altrimenti "none".',
	"Se il messaggio indica un orario, imposta hour (0-23) e minute (0-59); altrimenti hour = -1.",
	"confidence: da 0 a 1.",
	'Se il messaggio NON riguarda nessuna di queste attività, type = "other".',
	"Messaggio:",
].join("\n");

interface RawGemini {
	type: string;
	action: string;
	side?: string;
	hour?: number;
	minute?: number;
	confidence: number;
}

export const makeGeminiParser = (
	env: ConfigEnv & LoggerEnv,
): ParserEnv["parser"] => ({
	parse: async (text) => {
		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.config.geminiModel}:generateContent`;
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-goog-api-key": env.config.geminiApiKey,
				},
				body: JSON.stringify({
					contents: [{ role: "user", parts: [{ text: `${PROMPT}\n${text}` }] }],
					generationConfig: {
						responseMimeType: "application/json",
						responseSchema: RESPONSE_SCHEMA,
					},
				}),
			});
			if (!res.ok) {
				env.logger.error(`Gemini HTTP ${res.status}`);
				return success(null);
			}
			const data = await res.json();
			const raw: string | undefined =
				data?.candidates?.[0]?.content?.parts?.[0]?.text;
			if (!raw) return success(null);

			const parsed = JSON.parse(raw) as RawGemini;
			if (parsed.type === "other") return success(null);

			const result: GeminiParse = {
				type: parsed.type as GeminiParse["type"],
				action: parsed.action as GeminiParse["action"],
				confidence: parsed.confidence,
			};
			if (parsed.side && parsed.side !== "none") {
				result.side = parsed.side as Exclude<GeminiParse["side"], undefined>;
			}
			if (typeof parsed.hour === "number" && parsed.hour >= 0) {
				result.hour = parsed.hour;
				result.minute = typeof parsed.minute === "number" ? parsed.minute : 0;
			}
			return success(result);
		} catch (e) {
			env.logger.error("Gemini parse failed", e);
			return success(null);
		}
	},
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/adapters/gemini/parse.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: Gemini REST fallback parser"
```

---

### Task 9: Telegraf adapter (`src/adapters/telegraf/bot.ts`)

**Files:**
- Create: `src/adapters/telegraf/bot.ts`
- Test: `test/unit/adapters/telegraf/bot.test.ts`

**Interfaces:**
- Consumes: `Telegraf` + `ReactionTypeEmoji` (type) from telegraf; `ConfigEnv`; `BotEnv` from `../../domain/bot`; `LoggerEnv`.
- Produces:
  - `interface TelegrafAdapter { instance: Telegraf; botEnv: BotEnv }`
  - `makeTelegrafAdapter(telegraf?: typeof Telegraf): (env: ConfigEnv & LoggerEnv) => TelegrafAdapter`
- Behaviour: `react` → `setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }])`; `sendConfirmation` → `sendMessage` with an inline keyboard `[[Conferma→conf:<id>, Annulla→ann:<id>]]`; `answerCallback` → `answerCbQuery`; `clearKeyboard` → `editMessageReplyMarkup(chatId, messageId, undefined, undefined)` (swallow the "message is not modified" 400). A `bot.use` middleware drops any update whose `ctx.chat.id !== config.allowedChatId`.
- The `telegraf` param is injectable (default `Telegraf`) so tests pass a fake constructor.

- [ ] **Step 1: Write the failing test** — `test/unit/adapters/telegraf/bot.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import type { Telegraf } from "telegraf";
import { makeTelegrafAdapter } from "../../../../src/adapters/telegraf/bot";

const config = {
	botToken: "b",
	allowedChatId: 1,
	databaseUrl: "d",
	geminiApiKey: "k",
	geminiModel: "m",
	cronSecret: "c",
	webhookUrl: "w",
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() };

const makeFake = () => {
	const telegram = {
		sendMessage: vi.fn().mockResolvedValue({}),
		setMessageReaction: vi.fn().mockResolvedValue(true),
		answerCbQuery: vi.fn().mockResolvedValue(true),
		editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
	};
	const use = vi.fn();
	// biome-ignore lint/suspicious/noExplicitAny: minimal Telegraf test double
	const Ctor = vi.fn(function (this: any) {
		this.telegram = telegram;
		this.use = use;
	});
	return { Ctor: Ctor as unknown as typeof Telegraf, telegram, use };
};

describe("[TELEGRAF adapter]", () => {
	it("react calls setMessageReaction with an emoji reaction", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await botEnv.bot.react(1, 100, "👍");
		expect(telegram.setMessageReaction).toHaveBeenCalledWith(1, 100, [
			{ type: "emoji", emoji: "👍" },
		]);
	});

	it("sendConfirmation builds conf:/ann: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await botEnv.bot.sendConfirmation(1, "Confermi?", "p1");
		expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Confermi?", {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Conferma", callback_data: "conf:p1" },
						{ text: "Annulla", callback_data: "ann:p1" },
					],
				],
			},
		});
	});

	it("clearKeyboard removes the markup and swallows 'not modified'", async () => {
		const { Ctor, telegram } = makeFake();
		telegram.editMessageReplyMarkup.mockRejectedValueOnce(
			new Error("Bad Request: message is not modified"),
		);
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await expect(botEnv.bot.clearKeyboard(1, 100)).resolves.toBeUndefined();
	});

	it("the allow-list middleware skips other chats and passes the allowed chat", async () => {
		const { Ctor, use } = makeFake();
		makeTelegrafAdapter(Ctor)({ config, logger });
		const middleware = use.mock.calls[0]?.[0] as (
			ctx: { chat?: { id: number } },
			next: () => Promise<void>,
		) => Promise<void>;
		const next = vi.fn().mockResolvedValue(undefined);
		await middleware({ chat: { id: 999 } }, next);
		expect(next).not.toHaveBeenCalled();
		await middleware({ chat: { id: 1 } }, next);
		expect(next).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/adapters/telegraf/bot.test.ts`
Expected: FAIL — cannot resolve the adapter.

- [ ] **Step 3: Implement `src/adapters/telegraf/bot.ts`**

```ts
import { Telegraf } from "telegraf";
import type { ReactionTypeEmoji } from "telegraf/types";
import type { ConfigEnv } from "../../config";
import type { BotEnv } from "../../domain/bot";
import type { LoggerEnv } from "../../domain/logger";

export interface TelegrafAdapter {
	instance: Telegraf;
	botEnv: BotEnv;
}

export const makeTelegrafAdapter =
	(telegraf = Telegraf) =>
	(env: ConfigEnv & LoggerEnv): TelegrafAdapter => {
		const bot = new telegraf(env.config.botToken);

		// Serve only the allow-listed chat.
		bot.use(async (ctx, next) => {
			const chatId = ctx.chat?.id;
			if (chatId !== undefined && chatId !== env.config.allowedChatId) {
				env.logger.info(`Ignoring update from chat ${chatId}`);
				return;
			}
			return next();
		});

		const botEnv: BotEnv = {
			bot: {
				sendMessage: async (chatId, text) => {
					await bot.telegram.sendMessage(chatId, text);
				},
				react: async (chatId, messageId, emoji) => {
					const reaction: ReactionTypeEmoji[] = [
						{ type: "emoji", emoji: emoji as ReactionTypeEmoji["emoji"] },
					];
					await bot.telegram.setMessageReaction(chatId, messageId, reaction);
				},
				sendConfirmation: async (chatId, text, pendingId) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: "Conferma", callback_data: `conf:${pendingId}` },
									{ text: "Annulla", callback_data: `ann:${pendingId}` },
								],
							],
						},
					});
				},
				answerCallback: async (callbackId, text) => {
					await bot.telegram.answerCbQuery(callbackId, text);
				},
				clearKeyboard: async (chatId, messageId) => {
					try {
						await bot.telegram.editMessageReplyMarkup(
							chatId,
							messageId,
							undefined,
							undefined,
						);
					} catch (e) {
						if (
							e instanceof Error &&
							e.message.includes("message is not modified")
						) {
							return;
						}
						throw e;
					}
				},
			},
		};

		env.logger.info("Telegraf adapter initialized");
		return { instance: bot, botEnv };
	};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/adapters/telegraf/bot.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck` (confirms the `ReactionTypeEmoji` cast + inline-keyboard types resolve).
```bash
npm run lint:apply
git add -A
git commit -m "feat: telegraf BotEnv adapter + allow-list middleware"
```

---

### Task 10: Production env wiring (`src/env.ts`)

**Files:**
- Create: `src/env.ts`

**Interfaces:**
- Consumes: `getConfig`/`ConfigEnv`, `makePgPool`, `makePgEventRepository`, `makePgPendingRepository`, `makeGeminiParser`, `makeTelegrafAdapter`, `makeLogger`, and the domain env types.
- Produces:
  - `type Env = LoggerEnv & ConfigEnv & DBEnv & EventEnv & PendingEnv & ParserEnv & BotEnv & { telegrafBot: Telegraf; handleWebhook(update: unknown): Promise<void> }`
  - `makeEnv(): Env`
- Note: no unit test (it instantiates a real pool + Telegraf). Verified by typecheck; exercised by `api/*` + deploy.

- [ ] **Step 1: Create `src/env.ts`**

```ts
import type { Telegraf } from "telegraf";
import type { Update } from "telegraf/types";
import { makeGeminiParser } from "./adapters/gemini/parse";
import { makeLogger } from "./adapters/console/logger";
import { makePgPool } from "./adapters/db/pool";
import { makePgEventRepository } from "./adapters/pg/event";
import { makePgPendingRepository } from "./adapters/pg/pending";
import { makeTelegrafAdapter } from "./adapters/telegraf/bot";
import { type ConfigEnv, getConfig } from "./config";
import type { BotEnv } from "./domain/bot";
import type { DBEnv } from "./domain/db";
import type { EventEnv } from "./domain/event";
import type { LoggerEnv } from "./domain/logger";
import type { ParserEnv } from "./domain/parse";
import type { PendingEnv } from "./domain/pending";

type InfraEnv = {
	telegrafBot: Telegraf;
	handleWebhook(update: unknown): Promise<void>;
};

export type Env = LoggerEnv &
	ConfigEnv &
	DBEnv &
	EventEnv &
	PendingEnv &
	ParserEnv &
	BotEnv &
	InfraEnv;

export const makeEnv = (): Env => {
	const logger = makeLogger();
	const config = getConfig();
	const db = makePgPool({ config, logger });
	const eventRepository = makePgEventRepository({ db, logger });
	const pendingRepository = makePgPendingRepository({ db, logger });
	const parser = makeGeminiParser({ config, logger });
	const telegraf = makeTelegrafAdapter()({ config, logger });

	return {
		logger,
		config,
		db,
		eventRepository,
		pendingRepository,
		parser,
		...telegraf.botEnv,
		telegrafBot: telegraf.instance,
		handleWebhook: async (update: unknown) => {
			await telegraf.instance.handleUpdate(update as Update);
		},
	};
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: production env wiring (makeEnv)"
```

---

### Task 11: Webhook handler (`api/webhook.ts`)

**Files:**
- Create: `api/webhook.ts`

**Interfaces:**
- Consumes: `VercelRequest`/`VercelResponse`; `IncomingMessage`/`IncomingCallback`/`handleMessage`/`handleCallback` from `../src/domain/bot`; the command use-cases from `../src/domain/commands`; `Env`/`makeEnv` from `../src/env`.
- Behaviour: lazily builds `env` once, registers telegraf command handlers (`/start /help /stato /oggi /ieri /settimana /annulla`), a `text` handler (→ `handleMessage`, skipping slash-commands), and a `callback_query` handler (→ `handleCallback`); the default export forwards `POST` bodies to `env.handleWebhook`. The allow-list middleware (in the telegraf adapter) already filters chats.
- Note: no unit test (thin telegraf/serverless glue); verified by typecheck + deploy.

- [ ] **Step 1: Create `api/webhook.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
	handleCallback,
	handleMessage,
	type IncomingCallback,
	type IncomingMessage,
} from "../src/domain/bot";
import {
	annullaCommand,
	helpCommand,
	ieriCommand,
	oggiCommand,
	settimanaCommand,
	startCommand,
	statoCommand,
} from "../src/domain/commands";
import { type Env, makeEnv } from "../src/env";

let env: Env;
let initialized = false;

const senderName = (from?: {
	first_name?: string;
	username?: string;
}): string => from?.first_name ?? from?.username ?? "sconosciuto";

const initBot = (): void => {
	if (initialized) return;
	env = makeEnv();
	const bot = env.telegrafBot;

	bot.command("start", async (ctx) => {
		await startCommand(ctx.chat.id)(env);
	});
	bot.command("help", async (ctx) => {
		await helpCommand(ctx.chat.id)(env);
	});
	bot.command("stato", async (ctx) => {
		await statoCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("oggi", async (ctx) => {
		await oggiCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("ieri", async (ctx) => {
		await ieriCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("settimana", async (ctx) => {
		await settimanaCommand(ctx.chat.id, new Date())(env);
	});
	bot.command("annulla", async (ctx) => {
		await annullaCommand(ctx.chat.id)(env);
	});

	bot.on("text", async (ctx) => {
		if (ctx.message.text.startsWith("/")) return; // commands handled above
		const msg: IncomingMessage = {
			chatId: ctx.chat.id,
			userId: ctx.from.id,
			userName: senderName(ctx.from),
			text: ctx.message.text,
			messageId: ctx.message.message_id,
			at: new Date(ctx.message.date * 1000),
		};
		await handleMessage(msg)(env);
	});

	bot.on("callback_query", async (ctx) => {
		if (!("data" in ctx.callbackQuery)) return;
		const cb: IncomingCallback = {
			id: ctx.callbackQuery.id,
			chatId: ctx.chat?.id ?? ctx.from.id,
			userId: ctx.from.id,
			userName: senderName(ctx.from),
			data: ctx.callbackQuery.data,
			messageId: ctx.callbackQuery.message?.message_id ?? 0,
		};
		await handleCallback(cb)(env);
	});

	initialized = true;
};

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}
	try {
		initBot();
		await env.handleWebhook(req.body);
		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Webhook error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (If telegraf's `ctx.message`/`ctx.callbackQuery` narrowing complains, confirm the handlers use `bot.on("text")` / `bot.on("callback_query")` — those narrow `ctx.message`/`ctx.callbackQuery` correctly.)

- [ ] **Step 3: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: Vercel webhook handler wiring telegraf to domain use-cases"
```

---

### Task 12: Setup handler (`api/setup.ts`)

**Files:**
- Create: `api/setup.ts`

**Interfaces:**
- Consumes: `VercelRequest`/`VercelResponse`; `makeEnv`.
- Behaviour: registers the Telegram webhook at `${WEBHOOK_URL}/api/webhook` (allowed updates: message, callback_query) and publishes the bot command list via `setMyCommands`. Manual one-time trigger (`curl` after deploy).
- Note: no unit test; verified by typecheck + manual invocation.

- [ ] **Step 1: Create `api/setup.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { makeEnv } from "../src/env";

const COMMANDS = [
	{ command: "stato", description: "Sessione in corso" },
	{ command: "oggi", description: "Statistiche di oggi" },
	{ command: "ieri", description: "Statistiche di ieri" },
	{ command: "settimana", description: "Statistiche della settimana" },
	{ command: "annulla", description: "Rimuove l'ultimo evento" },
	{ command: "help", description: "Aiuto" },
];

export default async function handler(
	_req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	try {
		const env = makeEnv();
		const url = `${env.config.webhookUrl.replace(/\/$/, "")}/api/webhook`;
		await env.telegrafBot.telegram.setWebhook(url, {
			allowed_updates: ["message", "callback_query"] as const,
		});
		await env.telegrafBot.telegram.setMyCommands(COMMANDS);
		return res.status(200).json({ ok: true, webhook: url });
	} catch (error) {
		console.error("Setup error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Lint + commit**

```bash
npm run lint:apply
git add -A
git commit -m "feat: setup handler (register webhook + bot commands)"
```

---

### Task 13: Cron report handler (`api/cron/report.ts`)

**Files:**
- Create: `api/cron/report.ts`
- Test: `test/unit/api/cron/report.test.ts`

**Interfaces:**
- Consumes: `VercelRequest`/`VercelResponse`; `sendDailyReport`/`sendWeeklyReport` from `../../src/domain/commands`; `romeNow` from `../../src/domain/time`; `makeEnv`.
- Behaviour: rejects with `401` unless `Authorization: Bearer $CRON_SECRET` (checked **before** `makeEnv`, so it's unit-testable without env). Then sends yesterday's daily report; if it's Monday in Rome (`romeNow(now).weekday === 1`), also the previous ISO week; then sweeps `pending_confirmations` older than 24h. Uses `config.allowedChatId` + optional `config.babyName`.

- [ ] **Step 1: Write the failing test** — `test/unit/api/cron/report.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../../../../api/cron/report";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

describe("[CRON report] auth guard", () => {
	let prev: string | undefined;
	beforeEach(() => {
		prev = process.env.CRON_SECRET;
		process.env.CRON_SECRET = "secret";
	});
	afterEach(() => {
		if (prev === undefined) delete process.env.CRON_SECRET;
		else process.env.CRON_SECRET = prev;
	});

	it("401 when the Authorization header is missing", async () => {
		const res = mockRes();
		await handler(
			{ headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it("401 when the bearer token is wrong", async () => {
		const res = mockRes();
		await handler(
			{ headers: { authorization: "Bearer nope" } } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/api/cron/report.test.ts`
Expected: FAIL — cannot resolve `../../../../api/cron/report`.

- [ ] **Step 3: Implement `api/cron/report.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendDailyReport, sendWeeklyReport } from "../../src/domain/commands";
import { romeNow } from "../../src/domain/time";
import { makeEnv } from "../../src/env";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	const cronSecret = process.env.CRON_SECRET;
	if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	try {
		const env = makeEnv();
		const chatId = env.config.allowedChatId;
		const babyName = env.config.babyName;
		const now = new Date();

		await sendDailyReport(chatId, now, babyName)(env);
		if (romeNow(now).weekday === 1) {
			await sendWeeklyReport(chatId, now, babyName)(env);
		}
		await env.pendingRepository.deleteStale(new Date(now.getTime() - DAY_MS));

		return res.status(200).json({ ok: true });
	} catch (error) {
		console.error("Cron report error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/api/cron/report.test.ts`
Expected: PASS (2 cases — the guard returns before `makeEnv`, so no env vars are needed).

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck`
```bash
npm run lint:apply
git add -A
git commit -m "feat: CRON_SECRET-guarded daily/weekly report cron + stale-pending sweep"
```

---

### Task 14: Vercel config + README + final verification

**Files:**
- Create: `vercel.json`, `README.md`

**Interfaces:**
- Produces the deploy config (daily cron `0 7 * * *` UTC ≈ 09:00 Rome summer / 08:00 winter — accepted drift; function `maxDuration`s) and human deploy instructions.

- [ ] **Step 1: Create `vercel.json`**

```json
{
	"version": 2,
	"functions": {
		"api/webhook.ts": { "maxDuration": 10 },
		"api/setup.ts": { "maxDuration": 30 },
		"api/cron/report.ts": { "maxDuration": 30 }
	},
	"crons": [{ "path": "/api/cron/report", "schedule": "0 7 * * *" }]
}
```
(Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron invocations when the `CRON_SECRET` env var is set — matching the handler's guard.)

- [ ] **Step 2: Create `README.md`**

```markdown
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
| `BABY_NAME` | optional, for report headers |

## Deploy

1. Create the Supabase project; put the pooled `DATABASE_URL` in `.env`, then
   `npm run migrate:up` to create the tables.
2. Set the env vars above in Vercel and deploy.
3. Register the webhook + commands once: `curl -X POST "$WEBHOOK_URL/api/setup"`.
4. The daily report runs at `0 7 * * *` UTC (≈09:00 Rome in summer); Mondays also
   send the previous ISO week.
```

- [ ] **Step 3: Final verification — full check + build**

Run: `npm run check && npm run build`
Expected: Biome clean, typecheck exit 0, all tests PASS (Plan-1 70 + Plan-2 additions: config 5, pg event 6, pg pending 4, gemini 4, telegraf 4, cron 2 ≈ 95 total), and `tsc -p tsconfig.build.json` compiles `src/` + `api/` with no errors.

- [ ] **Step 4: Validate the JSON configs parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json ok')"`
Expected: `vercel.json ok`.

- [ ] **Step 5: Commit**

```bash
npm run lint:apply
git add -A
git commit -m "chore: vercel cron/function config + README deploy docs"
```

---

## Definition of done (Plan 2)

- [ ] `npm run check` green (Biome + `tsc --noEmit` + full Vitest suite).
- [ ] `npm run build` compiles `src/` + `api/` cleanly.
- [ ] With a real `.env` (Supabase pooled URL): `npm run migrate:up` creates `events` + `pending_confirmations` including the partial unique index.
- [ ] Deployed to Vercel; `POST /api/setup` registers the webhook + commands; a real message in the allow-listed chat logs an event and reacts/relies as in Plan 1; the cron endpoint returns 401 without the bearer and sends a report with it.

## Self-Review notes

- **Spec coverage:** config, DB pool, pg event + pending repos (with `intent` jsonb round-trip + the `rawText` fix), migration with the one-open-session partial unique index, Gemini REST fallback, telegraf `BotEnv` (incl. reactions + inline confirm buttons + allow-list), env wiring, webhook/setup/cron handlers, and Vercel cron all present. This completes the spec's MVP once deployed.
- **Deliberate decisions:** low-confidence Gemini intents route to a confirm prompt without passing through `decide()` (documented in Task 8 as accepted MVP behaviour); setup endpoint is unauthenticated (idempotent, manual one-time); `raw_text` now carries the user's original message (Task 1 fix).
- **Deferred (still open, not in scope):** parser bare-digit hardening (Plan-1 note); optional `dev:bot` polling harness; Telegram webhook `secret_token` header check (no env var specced for it).
- **Test boundaries:** pure/adapter logic is unit-tested against mocked `db.query`/`fetch`/Telegraf; wiring files (`env.ts`, `api/webhook.ts`, `api/setup.ts`) are typecheck-verified and exercised at deploy, matching the reference project's testing depth.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-02-poppata-bot-production.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
