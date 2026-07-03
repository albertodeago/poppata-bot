# Baby Weight Tracking (/peso) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/peso` command that records the baby's daily weight in grams (one per day, overwrite on re-entry) and shows the history with growth deltas.

**Architecture:** A new `weights` table + `WeightRepository` port, isolated from the session-shaped `events` table. A pure `weight.ts` domain module (types, port, `parseGrams`, `formatHistory`), pg + memory adapters, a `pesoCommand` in `commands.ts`, and wiring into `env.ts`/`webhook.ts`/`setup.ts`/`dev.ts`. Follows the codebase's hexagonal, `Result`-based, curried `(args) => (env) => Promise<…>` style.

**Tech Stack:** TypeScript (ESM, Node ≥24), `pg`, `node-pg-migrate`, `telegraf`, `luxon`, Vitest, Biome.

## Global Constraints

- **Hexagonal, no throws in the domain.** Domain returns `Result<T,E>`; adapters wrap I/O in `tryCatch` from `src/domain/result.js`.
- **ESM imports use `.js` extensions** even for `.ts` files (e.g. `import … from "./weight.js"`).
- **Biome formatting = tabs.** `npm run check` runs `lint:apply` (auto-format) → `typecheck` → `test`; run it before every commit.
- **Copy is Italian.** Storage is canonical: weight is a whole **integer number of grams**.
- **Timezone `Europe/Rome`** is a code constant (`ZONE` in `time.ts`), never an env var.
- **Everything is keyed by `chatId`** (single baby per chat; multi-chat allow-list stays isolated).
- **Conventional commits** (`feat:`, `test:`, `docs:`, `chore:`) as in the existing history.

---

### Task 1: `romeDay` time helper

**Files:**
- Modify: `src/domain/time.ts`
- Test: `test/unit/domain/time.test.ts`

**Interfaces:**
- Consumes: `romeNow(at: Date): DateTime` (existing, in `time.ts`).
- Produces: `romeDay(at: Date): string` — the Rome-local calendar day as `yyyy-MM-dd`. Used by `pesoCommand` (Task 6) as the storage key for a reading.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/domain/time.test.ts` (merge `romeDay` into the existing `../../../src/domain/time.js` import, or add a new import line):

```ts
import { romeDay } from "../../../src/domain/time.js";

describe("[TIME] romeDay", () => {
	it("returns the Rome-local calendar day as yyyy-MM-dd", () => {
		expect(romeDay(new Date("2026-07-03T10:00:00Z"))).toBe("2026-07-03");
	});

	it("rolls to the next day past Rome midnight", () => {
		// 23:30 UTC = 01:30 the next day in Rome (summer, +02:00)
		expect(romeDay(new Date("2026-07-03T23:30:00Z"))).toBe("2026-07-04");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/domain/time.test.ts`
Expected: FAIL — `romeDay is not a function` (or a TS/import error).

- [ ] **Step 3: Write minimal implementation**

Append to `src/domain/time.ts`:

```ts
/** Rome-local calendar day as yyyy-MM-dd (the storage key for a weight). */
export const romeDay = (at: Date): string => romeNow(at).toFormat("yyyy-MM-dd");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/domain/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/domain/time.ts test/unit/domain/time.test.ts
git commit -m "feat: add romeDay helper (Rome-local yyyy-MM-dd)"
```

---

### Task 2: Weight domain module (types, port, parseGrams, formatHistory)

**Files:**
- Create: `src/domain/weight.ts`
- Test: `test/unit/domain/weight.test.ts`

**Interfaces:**
- Produces:
  - `interface WeightReading { id: string; chatId: number; day: string; grams: number; userId: number; userName: string; createdAt: Date }`
  - `type NewWeightReading = Omit<WeightReading, "id" | "createdAt">`
  - `interface WeightRepository { upsert(r: NewWeightReading): Promise<Result<{ reading: WeightReading; overwritten: boolean }>>; list(chatId: number): Promise<Result<WeightReading[]>> }`
  - `interface WeightEnv { weightRepository: WeightRepository }`
  - `const MIN_GRAMS = 500`, `const MAX_GRAMS = 30000`
  - `parseGrams(arg: string): number | null`
  - `formatHistory(readings: WeightReading[]): string`
- Consumes: `Result` from `./result.js`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/domain/weight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	formatHistory,
	parseGrams,
	type WeightReading,
} from "../../../src/domain/weight.js";

const reading = (day: string, grams: number): WeightReading => ({
	id: `w-${day}`,
	chatId: 1,
	day,
	grams,
	userId: 1,
	userName: "papà",
	createdAt: new Date(`${day}T09:00:00Z`),
});

describe("[WEIGHT] parseGrams", () => {
	it("accepts a plain integer and trims whitespace", () => {
		expect(parseGrams("3400")).toBe(3400);
		expect(parseGrams("  3400  ")).toBe(3400);
	});

	it("rejects empty, non-numeric, and decimals", () => {
		expect(parseGrams("")).toBeNull();
		expect(parseGrams("abc")).toBeNull();
		expect(parseGrams("12.5")).toBeNull();
		expect(parseGrams("-500")).toBeNull();
	});

	it("rejects out-of-band values (fat-finger typos)", () => {
		expect(parseGrams("340")).toBeNull(); // below MIN_GRAMS
		expect(parseGrams("340000")).toBeNull(); // above MAX_GRAMS
	});
});

describe("[WEIGHT] formatHistory", () => {
	it("shows the empty-state hint when there are no readings", () => {
		expect(formatHistory([])).toBe(
			"Nessun peso registrato. Scrivi /peso 3400 per registrarne uno.",
		);
	});

	it("shows a single reading with no delta", () => {
		expect(formatHistory([reading("2026-07-01", 3200)])).toBe(
			"⚖️ Peso\n1 lug  3200 g",
		);
	});

	it("appends a signed delta between consecutive readings", () => {
		const text = formatHistory([
			reading("2026-07-01", 3200),
			reading("2026-07-08", 3400),
		]);
		expect(text).toContain("1 lug  3200 g");
		expect(text).toContain("8 lug  3400 g  (+200)");
	});

	it("renders a negative delta on weight loss", () => {
		const text = formatHistory([
			reading("2026-07-01", 3400),
			reading("2026-07-08", 3280),
		]);
		expect(text).toContain("(-120)");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/domain/weight.test.ts`
Expected: FAIL — cannot import `parseGrams`/`formatHistory` (module missing).

- [ ] **Step 3: Write minimal implementation**

Create `src/domain/weight.ts`:

```ts
import type { Result } from "./result.js";

export interface WeightReading {
	id: string;
	chatId: number;
	/** Rome-local calendar day, yyyy-MM-dd. */
	day: string;
	grams: number;
	userId: number;
	userName: string;
	createdAt: Date;
}

/** Fields needed to persist a reading; id/createdAt are assigned by the repo. */
export type NewWeightReading = Omit<WeightReading, "id" | "createdAt">;

export interface WeightRepository {
	/** Insert today's reading, or overwrite it if the day already has one. */
	upsert(
		reading: NewWeightReading,
	): Promise<Result<{ reading: WeightReading; overwritten: boolean }>>;
	/** All readings for a chat, chronological (oldest first). */
	list(chatId: number): Promise<Result<WeightReading[]>>;
}

export interface WeightEnv {
	weightRepository: WeightRepository;
}

export const MIN_GRAMS = 500;
export const MAX_GRAMS = 30000;

/** Parse the command argument to whole grams, or null if not a plausible value. */
export const parseGrams = (arg: string): number | null => {
	const t = arg.trim();
	if (!/^\d+$/.test(t)) return null;
	const g = Number(t);
	if (g < MIN_GRAMS || g > MAX_GRAMS) return null;
	return g;
};

const EMPTY_HISTORY =
	"Nessun peso registrato. Scrivi /peso 3400 per registrarne uno.";

// Italian short month names, indexed by month-1. Explicit (not locale-derived)
// so the copy is deterministic regardless of the runtime ICU build.
const MESI = [
	"gen",
	"feb",
	"mar",
	"apr",
	"mag",
	"giu",
	"lug",
	"ago",
	"set",
	"ott",
	"nov",
	"dic",
];

// "2026-07-01" -> "1 lug"
const dayLabel = (day: string): string => {
	const [, m, d] = day.split("-");
	return `${Number(d)} ${MESI[Number(m) - 1]}`;
};

/** The ⚖️ history block with per-reading deltas, or the empty-state line. */
export const formatHistory = (readings: WeightReading[]): string => {
	if (readings.length === 0) return EMPTY_HISTORY;
	const lines = ["⚖️ Peso"];
	let prev: number | undefined;
	for (const r of readings) {
		let line = `${dayLabel(r.day)}  ${r.grams} g`;
		if (prev !== undefined) {
			const delta = r.grams - prev;
			line += `  (${delta >= 0 ? "+" : "-"}${Math.abs(delta)})`;
		}
		lines.push(line);
		prev = r.grams;
	}
	return lines.join("\n");
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/domain/weight.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/domain/weight.ts test/unit/domain/weight.test.ts
git commit -m "feat: add weight domain module (parseGrams + formatHistory)"
```

---

### Task 3: Migration — `weights` table

**Files:**
- Create: `migrations/1783200000000_create-weights.js`

**Interfaces:**
- Produces the `weights` table consumed by the pg adapter (Task 5): columns `id`, `chat_id`, `day`, `grams`, `user_id`, `user_name`, `created_at`, plus a unique index `one_weight_per_day` on `(chat_id, day)` (the target of `ON CONFLICT (chat_id, day)`).

> No unit test — migrations run against a real Postgres. The gate is Biome + typecheck; the DB apply/rollback is a manual verification step for whoever has a database.

- [ ] **Step 1: Create the migration file**

Create `migrations/1783200000000_create-weights.js` (timestamp is greater than the existing `1782985325404_…` so it runs after it):

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
	pgm.createTable("weights", {
		id: "id",
		chat_id: { type: "bigint", notNull: true },
		day: { type: "date", notNull: true },
		grams: { type: "integer", notNull: true },
		user_id: { type: "bigint", notNull: true },
		user_name: { type: "text", notNull: true },
		created_at: "created_at",
	});
	// Invariant: at most one weight reading per chat per calendar day.
	pgm.createIndex("weights", ["chat_id", "day"], {
		name: "one_weight_per_day",
		unique: true,
	});
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropTable("weights");
};
```

- [ ] **Step 2: Verify formatting/lint**

Run: `npm run lint:apply`
Expected: no errors; the file is left formatted.

- [ ] **Step 3 (manual, needs a DB): apply and roll back**

Only if a `DATABASE_URL` (Session pooler) is set locally:
Run: `npm run migrate:up` → `weights` appears; `npm run migrate:down` → it is dropped; `npm run migrate:up` again to leave it applied.
Expected: up/down succeed with no errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/1783200000000_create-weights.js
git commit -m "feat: add weights table migration (one per chat per day)"
```

---

### Task 4: Memory adapter

**Files:**
- Create: `src/adapters/memory/weight.ts`
- Test: `test/unit/adapters/memory/weight.test.ts`

**Interfaces:**
- Consumes: `WeightRepository`, `NewWeightReading`, `WeightReading` (Task 2); `LoggerEnv` (existing); `R` from `../../domain/result.js`.
- Produces: `makeMemoryWeightRepository({ logger }): WeightRepository`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/adapters/memory/weight.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeMemoryWeightRepository } from "../../../../src/adapters/memory/weight.js";
import type { NewWeightReading } from "../../../../src/domain/weight.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const newReading = (over: Partial<NewWeightReading> = {}): NewWeightReading => ({
	chatId: 1,
	day: "2026-07-01",
	grams: 3200,
	userId: 1,
	userName: "papà",
	...over,
});

describe("[MEMORY weight repo]", () => {
	it("upsert inserts a fresh reading (overwritten false)", async () => {
		const repo = makeMemoryWeightRepository({ logger });
		const r = await repo.upsert(newReading({}));
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.overwritten).toBe(false);
			expect(r.data.reading.id).toBeTruthy();
			expect(r.data.reading.grams).toBe(3200);
		}
	});

	it("upsert overwrites the same day (overwritten true)", async () => {
		const repo = makeMemoryWeightRepository({ logger });
		await repo.upsert(newReading({ grams: 3200 }));
		const second = await repo.upsert(newReading({ grams: 3400 }));
		expect(second.success).toBe(true);
		if (second.success) expect(second.data.overwritten).toBe(true);
		const list = await repo.list(1);
		if (list.success) {
			expect(list.data).toHaveLength(1);
			expect(list.data[0]?.grams).toBe(3400);
		}
	});

	it("list returns a chat's readings sorted by day, isolated per chat", async () => {
		const repo = makeMemoryWeightRepository({ logger });
		await repo.upsert(newReading({ day: "2026-07-08", grams: 3400 }));
		await repo.upsert(newReading({ day: "2026-07-01", grams: 3200 }));
		await repo.upsert(newReading({ chatId: 2, day: "2026-07-01", grams: 9999 }));
		const r = await repo.list(1);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.map((x) => x.day)).toEqual(["2026-07-01", "2026-07-08"]);
			expect(r.data.every((x) => x.chatId === 1)).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adapters/memory/weight.test.ts`
Expected: FAIL — module `weight.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/memory/weight.ts`:

```ts
import type { LoggerEnv } from "../../domain/logger.js";
import * as R from "../../domain/result.js";
import type {
	NewWeightReading,
	WeightReading,
	WeightRepository,
} from "../../domain/weight.js";

export const makeMemoryWeightRepository = ({
	logger,
}: {
	logger: LoggerEnv["logger"];
}): WeightRepository => {
	logger.info("initMemoryWeightRepository");
	const byKey = new Map<string, WeightReading>();
	const key = (chatId: number, day: string): string => `${chatId}:${day}`;

	return {
		upsert: async (reading: NewWeightReading) => {
			const k = key(reading.chatId, reading.day);
			const existing = byKey.get(k);
			const stored: WeightReading = {
				...reading,
				id: existing?.id ?? crypto.randomUUID(),
				createdAt: new Date(),
			};
			byKey.set(k, stored);
			return R.success({ reading: stored, overwritten: existing !== undefined });
		},

		list: async (chatId: number) => {
			const rows = [...byKey.values()]
				.filter((r) => r.chatId === chatId)
				.sort((a, b) => a.day.localeCompare(b.day));
			return R.success(rows);
		},
	};
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/adapters/memory/weight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/adapters/memory/weight.ts test/unit/adapters/memory/weight.test.ts
git commit -m "feat: add in-memory weight repository"
```

---

### Task 5: Postgres adapter

**Files:**
- Create: `src/adapters/pg/weight.ts`
- Test: `test/unit/adapters/pg/weight.test.ts`

**Interfaces:**
- Consumes: `DBEnv` (`src/domain/db.js`), `LoggerEnv`, `tryCatch` (`src/domain/result.js`); `WeightRepository`, `NewWeightReading`, `WeightReading` (Task 2).
- Produces: `makePgWeightRepository(env: DBEnv & LoggerEnv): WeightRepository`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/adapters/pg/weight.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makePgWeightRepository } from "../../../../src/adapters/pg/weight.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
};

const row = (over: Record<string, unknown> = {}) => ({
	id: "w1",
	chat_id: "1",
	day: "2026-07-01",
	grams: 3400,
	user_id: "2",
	user_name: "papà",
	created_at: new Date("2026-07-01T09:00:00Z"),
	overwritten: false,
	...over,
});

const newReading = {
	chatId: 1,
	day: "2026-07-01",
	grams: 3400,
	userId: 2,
	userName: "papà",
};

describe("[PG weight repo]", () => {
	it("upsert issues ON CONFLICT, passes params in column order, maps overwritten", async () => {
		const db = { query: vi.fn().mockResolvedValue([row()]) };
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.upsert(newReading);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.reading.grams).toBe(3400);
			expect(r.data.reading.chatId).toBe(1);
			expect(r.data.overwritten).toBe(false);
		}
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("INSERT INTO weights");
		expect(sql).toContain("ON CONFLICT (chat_id, day)");
		expect(params).toEqual([1, "2026-07-01", 3400, 2, "papà"]);
	});

	it("upsert reports overwritten=true when xmax indicates an update", async () => {
		const db = { query: vi.fn().mockResolvedValue([row({ overwritten: true })]) };
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.upsert(newReading);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.overwritten).toBe(true);
	});

	it("list orders by day and maps rows", async () => {
		const db = {
			query: vi.fn().mockResolvedValue([row(), row({ id: "w2", day: "2026-07-08" })]),
		};
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.list(1);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toHaveLength(2);
		const [sql, params] = db.query.mock.calls[0] ?? [];
		expect(sql).toContain("FROM weights");
		expect(sql).toContain("ORDER BY day");
		expect(params).toEqual([1]);
	});

	it("returns an error Result when the query throws", async () => {
		const db = { query: vi.fn().mockRejectedValue(new Error("db down")) };
		const repo = makePgWeightRepository({ db, logger });
		const r = await repo.list(1);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("db down");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adapters/pg/weight.test.ts`
Expected: FAIL — module `weight.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/pg/weight.ts`:

```ts
import type { DBEnv } from "../../domain/db.js";
import type { LoggerEnv } from "../../domain/logger.js";
import { tryCatch } from "../../domain/result.js";
import type {
	NewWeightReading,
	WeightReading,
	WeightRepository,
} from "../../domain/weight.js";

interface WeightRow {
	id: string;
	chat_id: string;
	day: string;
	grams: number;
	user_id: string;
	user_name: string;
	created_at: Date;
	overwritten?: boolean;
}

const mapRow = (row: WeightRow): WeightReading => ({
	id: row.id,
	chatId: Number(row.chat_id),
	day: row.day,
	grams: Number(row.grams),
	userId: Number(row.user_id),
	userName: row.user_name,
	createdAt: new Date(row.created_at),
});

// `to_char(day, …)` forces a yyyy-MM-dd string (node-postgres otherwise returns
// a `date` column as a local-midnight Date, which would shift the day).
const COLUMNS =
	"id, chat_id, to_char(day, 'YYYY-MM-DD') AS day, grams, user_id, user_name, created_at";

export const makePgWeightRepository = (
	env: DBEnv & LoggerEnv,
): WeightRepository => ({
	upsert: (reading: NewWeightReading) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`INSERT INTO weights (chat_id, day, grams, user_id, user_name)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT (chat_id, day)
				 DO UPDATE SET grams = EXCLUDED.grams,
				               user_id = EXCLUDED.user_id,
				               user_name = EXCLUDED.user_name,
				               created_at = NOW()
				 RETURNING ${COLUMNS}, (xmax <> 0) AS overwritten`,
					[
						reading.chatId,
						reading.day,
						reading.grams,
						reading.userId,
						reading.userName,
					],
				);
				const r = rows[0] as WeightRow | undefined;
				if (!r) throw new Error("upsert returned no row");
				return { reading: mapRow(r), overwritten: r.overwritten === true };
			},
			(e) => e,
		),

	list: (chatId: number) =>
		tryCatch(
			async () => {
				const rows = await env.db.query(
					`SELECT ${COLUMNS} FROM weights WHERE chat_id = $1 ORDER BY day`,
					[chatId],
				);
				return (rows as WeightRow[]).map(mapRow);
			},
			(e) => e,
		),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/adapters/pg/weight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run check
git add src/adapters/pg/weight.ts test/unit/adapters/pg/weight.test.ts
git commit -m "feat: add postgres weight repository (upsert + list)"
```

---

### Task 6: `pesoCommand` + testEnv mock + HELP_TEXT

**Files:**
- Modify: `test/unit/testEnv.ts`
- Modify: `src/domain/commands.ts`
- Test: `test/unit/domain/commands.test.ts`

**Interfaces:**
- Consumes: `WeightEnv`, `formatHistory`, `parseGrams` (Task 2); `romeDay` (Task 1); existing `BotEnv`, `LoggerEnv`, `INTERNAL_ERROR`.
- Produces: `pesoCommand(chatId: number, userId: number, userName: string, arg: string, now: Date) => (env: WeightEnv & BotEnv & LoggerEnv) => Promise<void>`; a new `/peso …` line in `HELP_TEXT`; a `weightRepository` mock (`upsert`, `list`) on `makeTestEnv`.

- [ ] **Step 1: Extend the test env with a weight repository mock**

In `test/unit/testEnv.ts`: add the import and the mock, and widen the env type.

Add to the imports:
```ts
import type { WeightEnv } from "../../src/domain/weight.js";
```

Add to the `mocks` object (after `eventRepository`):
```ts
		weightRepository: {
			upsert: vi.fn<WeightEnv["weightRepository"]["upsert"]>(),
			list: vi.fn<WeightEnv["weightRepository"]["list"]>(),
		},
```

Change the `env` type annotation and add the field:
```ts
	const env: BotEnv &
		EventEnv &
		PendingEnv &
		ParserEnv &
		WeightEnv &
		LoggerEnv = {
		eventRepository: mocks.eventRepository,
		weightRepository: mocks.weightRepository,
		pendingRepository: mocks.pendingRepository,
		parser: mocks.parser,
		bot: mocks.bot,
		logger: mocks.logger,
	};
```

- [ ] **Step 2: Write the failing test**

Add to `test/unit/domain/commands.test.ts` — add `pesoCommand` to the existing `../../../src/domain/commands.js` import, add `romeDay` from `time.js`, then append the describe block:

```ts
import { romeDay } from "../../../src/domain/time.js";

describe("[COMMANDS] /peso", () => {
	it("HELP_TEXT lists the /peso command", () => {
		expect(HELP_TEXT).toContain("/peso");
	});

	it("records today's weight and confirms it", async () => {
		const { env, mocks } = makeTestEnv();
		const now = new Date("2026-07-03T10:00:00Z");
		mocks.weightRepository.upsert.mockResolvedValue(
			success({
				reading: {
					id: "w1",
					chatId: 1,
					day: romeDay(now),
					grams: 3400,
					userId: 1,
					userName: "papà",
					createdAt: now,
				},
				overwritten: false,
			}),
		);
		await pesoCommand(1, 1, "papà", "3400", now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(1, "⚖️ Peso di oggi: 3400 g");
		expect(mocks.weightRepository.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ chatId: 1, grams: 3400, day: romeDay(now) }),
		);
	});

	it("notes when it overwrote an existing reading", async () => {
		const { env, mocks } = makeTestEnv();
		const now = new Date("2026-07-03T10:00:00Z");
		mocks.weightRepository.upsert.mockResolvedValue(
			success({
				reading: {
					id: "w1",
					chatId: 1,
					day: romeDay(now),
					grams: 3400,
					userId: 1,
					userName: "papà",
					createdAt: now,
				},
				overwritten: true,
			}),
		);
		await pesoCommand(1, 1, "papà", "3400", now)(env);
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"⚖️ Peso di oggi: 3400 g (aggiornato)",
		);
	});

	it("rejects an out-of-band value without saving", async () => {
		const { env, mocks } = makeTestEnv();
		await pesoCommand(1, 1, "papà", "340", new Date())(env);
		expect(mocks.weightRepository.upsert).not.toHaveBeenCalled();
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Usa /peso 3400 (peso in grammi).",
		);
	});

	it("shows the history when called with no argument", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.weightRepository.list.mockResolvedValue(
			success([
				{
					id: "w1",
					chatId: 1,
					day: "2026-07-01",
					grams: 3200,
					userId: 1,
					userName: "papà",
					createdAt: new Date("2026-07-01T09:00:00Z"),
				},
			]),
		);
		await pesoCommand(1, 1, "papà", "", new Date())(env);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("⚖️ Peso");
		expect(text).toContain("3200 g");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: FAIL — `pesoCommand` is not exported.

- [ ] **Step 4: Write minimal implementation**

In `src/domain/commands.ts`:

Add `romeDay` to the existing `./time.js` import, and add a new import:
```ts
import { type WeightEnv, formatHistory, parseGrams } from "./weight.js";
```

Add the usage constant near the other module constants (after `INTERNAL_ERROR`):
```ts
const PESO_USAGE = "Usa /peso 3400 (peso in grammi).";
```

Add a `/peso` line to the `HELP_TEXT` array (e.g. right after the `/seno` line):
```ts
	'/peso 3400 — registra il peso di oggi (grammi); "/peso" mostra lo storico',
```

Add the command (place it alongside the other command exports):
```ts
export const pesoCommand =
	(chatId: number, userId: number, userName: string, arg: string, now: Date) =>
	async (env: WeightEnv & BotEnv & LoggerEnv): Promise<void> => {
		const trimmed = arg.trim();
		if (trimmed === "") {
			const res = await env.weightRepository.list(chatId);
			if (!res.success) {
				env.logger.error("peso: list failed", res.error);
				await env.bot.sendMessage(chatId, INTERNAL_ERROR);
				return;
			}
			await env.bot.sendMessage(chatId, formatHistory(res.data));
			return;
		}
		const grams = parseGrams(trimmed);
		if (grams === null) {
			await env.bot.sendMessage(chatId, PESO_USAGE);
			return;
		}
		const res = await env.weightRepository.upsert({
			chatId,
			day: romeDay(now),
			grams,
			userId,
			userName,
		});
		if (!res.success) {
			env.logger.error("peso: upsert failed", res.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		const note = res.data.overwritten ? " (aggiornato)" : "";
		await env.bot.sendMessage(chatId, `⚖️ Peso di oggi: ${grams} g${note}`);
	};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: PASS (existing suites + the 5 new `/peso` cases).

- [ ] **Step 6: Commit**

```bash
npm run check
git add src/domain/commands.ts test/unit/domain/commands.test.ts test/unit/testEnv.ts
git commit -m "feat: add /peso command (record + history)"
```

---

### Task 7: Wiring (env, webhook, setup, dev) + README

**Files:**
- Modify: `src/env.ts`
- Modify: `api/webhook.ts`
- Modify: `api/setup.ts`
- Modify: `src/dev.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `makePgWeightRepository` (Task 5), `makeMemoryWeightRepository` (Task 4), `pesoCommand` (Task 6), `WeightEnv` (Task 2), existing `senderName`/`DEV_USER_ID`.
- Produces: a live `/peso` command over Telegram (webhook) and in the stdin harness (`dev:local`); `weightRepository` present on the composed `Env`.

- [ ] **Step 1: Wire the repository into `env.ts`**

In `src/env.ts`:

Add imports:
```ts
import { makePgWeightRepository } from "./adapters/pg/weight.js";
import type { WeightEnv } from "./domain/weight.js";
```

Add `WeightEnv` to the `Env` intersection:
```ts
export type Env = LoggerEnv &
	ConfigEnv &
	DBEnv &
	EventEnv &
	PendingEnv &
	ParserEnv &
	WeightEnv &
	BotEnv &
	InfraEnv;
```

Build it in `makeEnv` (after `eventRepository`) and add it to the returned object:
```ts
	const weightRepository = makePgWeightRepository({ db, logger });
```
```ts
		eventRepository,
		weightRepository,
```

- [ ] **Step 2: Register the command in `webhook.ts`**

In `api/webhook.ts`, add `pesoCommand` to the `../src/domain/commands.js` import, then register the handler alongside the others (inside `initBot`):

```ts
	bot.command("peso", async (ctx) => {
		const arg = ctx.message.text.replace(/^\/peso(@\S+)?\s*/, "");
		await pesoCommand(
			ctx.chat.id,
			ctx.from.id,
			senderName(ctx.from),
			arg,
			new Date(),
		)(env);
	});
```

- [ ] **Step 3: Advertise the command in `setup.ts`**

In `api/setup.ts`, add to the `COMMANDS` array:
```ts
	{ command: "peso", description: "Peso: registra o mostra lo storico" },
```

- [ ] **Step 4: Wire the dev harness (`dev.ts`)**

In `src/dev.ts`:

Add imports:
```ts
import { makeMemoryWeightRepository } from "./adapters/memory/weight.js";
import type { WeightEnv } from "./domain/weight.js";
```
Add `pesoCommand` to the existing `./domain/commands.js` import.

Widen the env type and add the repository:
```ts
const env: BotEnv & EventEnv & PendingEnv & ParserEnv & WeightEnv & LoggerEnv = {
	logger,
	eventRepository: makeMemoryEventRepository({ logger }),
	weightRepository: makeMemoryWeightRepository({ logger }),
	pendingRepository: makeMemoryPendingRepository({ logger }),
	parser: makeNoopParser(),
	...botEnv,
};
```

Dispatch `/peso [n]` in `handleLine`, immediately before the generic `if (trimmed.startsWith("/"))` branch (so the argument survives):
```ts
	if (trimmed === "/peso" || trimmed.startsWith("/peso ")) {
		const arg = trimmed.slice("/peso".length).trim();
		await pesoCommand(DEV_CHAT_ID, DEV_USER_ID, "papà", arg, new Date())(env);
		return;
	}
```

- [ ] **Step 5: Update the README**

In `README.md`:
- **Roadmap** — remove the `- track peso` line (now implemented).
- **Commands** (the `/stato · /oggi · …` line) — add `/peso`:
  `` `/stato` … · `/peso` (registra/mostra il peso) · `/help` · `/start` ``
- **Local development** command list (the fenced block) — add:
  `` `/peso 3400`  # registra il peso di oggi; `/peso` mostra lo storico ``
- **Project structure** — add `weight.ts` to the `domain/` line and `pg/weight.ts` / `memory/weight.ts` to the adapters line if you enumerate them.

- [ ] **Step 6: Full check**

Run: `npm run check`
Expected: PASS — Biome clean, `tsc --noEmit` clean, all Vitest suites green.

- [ ] **Step 7: Manual smoke test (dev harness)**

Run: `npm run dev:local`, then type:
```
/peso 3400      → ⚖️ Peso di oggi: 3400 g
/peso 3500      → ⚖️ Peso di oggi: 3500 g (aggiornato)
/peso           → ⚖️ Peso  + one dated line 3500 g
/peso 12.5      → Usa /peso 3400 (peso in grammi).
```
Expected: replies as annotated. (Same-day re-entry overwrites; the harness uses in-memory storage.)

- [ ] **Step 8: Commit**

```bash
git add src/env.ts api/webhook.ts api/setup.ts src/dev.ts README.md
git commit -m "feat: wire /peso into webhook, setup, dev harness + docs"
```

---

## Self-Review

**Spec coverage:**
- Record `/peso 3400` (grams, today) → Task 6 (`pesoCommand`) + Task 7 (webhook).
- History `/peso` with deltas → Task 2 (`formatHistory`) + Task 6.
- Separate `weights` table + `WeightRepository` → Task 3 (migration) + Task 2 (port) + Tasks 4/5 (adapters).
- One-per-day upsert + `(aggiornato)` → Task 3 (unique index) + Tasks 4/5 (upsert) + Task 6 (copy).
- 500–30000 g band + usage hint → Task 2 (`parseGrams`) + Task 6.
- Rome day key → Task 1 (`romeDay`).
- Wiring (env/webhook/setup/dev) + HELP_TEXT + README → Tasks 6–7.
- Non-goals (no backfill, no `/annulla` for weights, no report change, no confirm flow, no delta-on-record) → nothing in any task adds them.

**Placeholder scan:** No TBD/TODO; every code step carries full code; every test step carries full assertions.

**Type consistency:** `WeightReading`/`NewWeightReading`/`WeightRepository.upsert(){ reading, overwritten }`/`list` are defined in Task 2 and used verbatim in Tasks 4–7. `pesoCommand(chatId, userId, userName, arg, now)` is defined in Task 6 and called with the same arity in Task 7 (webhook + dev). `romeDay` produced in Task 1, consumed in Task 6. `ON CONFLICT (chat_id, day)` (Task 5) matches the `one_weight_per_day` unique index (Task 3).
