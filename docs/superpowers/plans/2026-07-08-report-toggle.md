# Per-chat Scheduled-Report Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each chat turn the cron-pushed reports (daily + the Monday weekly) on/off with `/report on|off`, defaulting to on.

**Architecture:** Add a `reports_enabled` boolean to the existing `chat_configs` table, expose it through the `ChatConfigRepository` port and both adapters (pg + memory), add a `/report` command mirroring `/nome` in `registration.ts`, and make the cron `continue` past disabled chats. Purely additive; reuses the established per-chat-config pattern.

**Tech Stack:** TypeScript (ESM, Node ≥24), Vitest, node-pg-migrate, Telegraf, Biome.

## Global Constraints

- **Language of user-facing copy:** Italian.
- **Default state:** reports enabled (`reports_enabled` column `NOT NULL DEFAULT true`); existing chats keep receiving reports.
- **Scope:** one toggle silences BOTH the daily and weekly scheduled reports; on-demand commands (`/oggi`, `/ieri`, `/settimana`, `/scaletta`, `/grafici`) are unaffected.
- **Result type:** every repository method returns `Result<T>` (`{ success: true, data } | { success: false, error }`); use `R.success(...)` / the `tryCatch` helper as the surrounding code does.
- **`ChatConfig.reportsEnabled` is always present** (the column has a default), unlike the optional `babyName`.
- **Per-task verification:** `npm run check` (runs `biome check --write`, `tsc --noEmit`, and `vitest run`) must pass before each commit. Individual test files can be run with `npx vitest run <path>`.
- **Follow existing patterns** in each file; do not refactor unrelated code.

---

### Task 1: Migration — add `reports_enabled` column

**Files:**
- Create: `migrations/1783600000000_add-report-toggle.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the `chat_configs.reports_enabled` column (`boolean NOT NULL DEFAULT true`) that Task 2's pg adapter reads/writes.

- [ ] **Step 1: Write the migration**

Create `migrations/1783600000000_add-report-toggle.js` (mirror `1783500000000_add-bottle-support.js`):

```js
/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
	// Per-chat switch for the cron-pushed reports (daily + Monday weekly). Default
	// true so existing chats keep receiving them; a chat opts out via /report off.
	pgm.addColumn("chat_configs", {
		reports_enabled: { type: "boolean", notNull: true, default: true },
	});
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
	pgm.dropColumn("chat_configs", "reports_enabled");
};
```

- [ ] **Step 2: Verify the file is valid JS**

Run: `node --check migrations/1783600000000_add-report-toggle.js`
Expected: no output, exit 0.

- [ ] **Step 3: Lint**

Run: `npx biome check --write migrations/1783600000000_add-report-toggle.js`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/1783600000000_add-report-toggle.js
git commit -m "feat: migration adds chat_configs.reports_enabled"
```

> Note: the migration is applied against the live DB at deploy time (`npm run migrate:up`), not during tests. The memory adapter (Task 2) is the test double for this column.

---

### Task 2: Repository layer — `reportsEnabled` field + `setReportsEnabled`

**Files:**
- Modify: `src/domain/chatConfig.ts`
- Modify: `src/adapters/memory/chatConfig.ts`
- Modify: `src/adapters/pg/chatConfig.ts`
- Modify: `test/unit/testEnv.ts`
- Test: `test/unit/adapters/memory/chatConfig.test.ts`
- Test: `test/unit/adapters/pg/chatConfig.test.ts`

**Interfaces:**
- Consumes: `chat_configs.reports_enabled` (Task 1).
- Produces:
  - `interface ChatConfig { chatId: number; babyName?: string; reportsEnabled: boolean }`
  - `ChatConfigRepository.setReportsEnabled(chatId: number, enabled: boolean): Promise<Result<ChatConfig>>`
  - `makeTestEnv().mocks.chatConfigRepository.setReportsEnabled` (a `vi.fn`)
  These are used by Task 3 (command) and Task 5 (cron).

- [ ] **Step 1: Write the failing memory-adapter tests**

Add these to `test/unit/adapters/memory/chatConfig.test.ts` (inside the existing `describe`):

```ts
it("create defaults reportsEnabled to true", async () => {
	const repo = makeMemoryChatConfigRepository({ logger });
	const c = await repo.create({ chatId: 1, createdByName: "papà" });
	if (c.success) expect(c.data.reportsEnabled).toBe(true);
});

it("setReportsEnabled toggles the flag and round-trips via get", async () => {
	const repo = makeMemoryChatConfigRepository({ logger });
	await repo.create({ chatId: 1, createdByName: "papà" });
	await repo.setReportsEnabled(1, false);
	let got = await repo.get(1);
	if (got.success) expect(got.data?.reportsEnabled).toBe(false);
	await repo.setReportsEnabled(1, true);
	got = await repo.get(1);
	if (got.success) expect(got.data?.reportsEnabled).toBe(true);
});

it("setBabyName preserves an existing reportsEnabled", async () => {
	const repo = makeMemoryChatConfigRepository({ logger });
	await repo.create({ chatId: 1, createdByName: "papà" });
	await repo.setReportsEnabled(1, false);
	await repo.setBabyName(1, "Leo");
	const got = await repo.get(1);
	if (got.success) {
		expect(got.data?.babyName).toBe("Leo");
		expect(got.data?.reportsEnabled).toBe(false);
	}
});

it("setReportsEnabled preserves an existing babyName", async () => {
	const repo = makeMemoryChatConfigRepository({ logger });
	await repo.create({ chatId: 1, createdByName: "papà" });
	await repo.setBabyName(1, "Leo");
	await repo.setReportsEnabled(1, false);
	const got = await repo.get(1);
	if (got.success) {
		expect(got.data?.babyName).toBe("Leo");
		expect(got.data?.reportsEnabled).toBe(false);
	}
});
```

- [ ] **Step 2: Run the memory tests to verify they fail**

Run: `npx vitest run test/unit/adapters/memory/chatConfig.test.ts`
Expected: FAIL — `setReportsEnabled` is not a function / `reportsEnabled` is undefined.

- [ ] **Step 3: Update the domain port**

In `src/domain/chatConfig.ts`, add `reportsEnabled` to `ChatConfig` and `setReportsEnabled` to the interface:

```ts
export interface ChatConfig {
	chatId: number;
	/** Baby name shown in report headers; absent until set via /nome. */
	babyName?: string;
	/** Whether the cron sends this chat its scheduled reports. Defaults true. */
	reportsEnabled: boolean;
}

export interface ChatConfigRepository {
	/** The chat's config row, or null if the chat has never registered. */
	get(chatId: number): Promise<Result<ChatConfig | null>>;
	/** Number of registered chats (for the registration cap). */
	count(): Promise<Result<number>>;
	/** Register a chat (idempotent): create the row, or return the existing one. */
	create(input: {
		chatId: number;
		createdByName: string;
	}): Promise<Result<ChatConfig>>;
	/** Set/replace the baby name on an existing (or upserted) row. */
	setBabyName(chatId: number, babyName: string): Promise<Result<ChatConfig>>;
	/** Enable/disable the scheduled (cron) reports for a chat. */
	setReportsEnabled(
		chatId: number,
		enabled: boolean,
	): Promise<Result<ChatConfig>>;
	/** All registered chats, creation order (for the report cron). */
	listAll(): Promise<Result<ChatConfig[]>>;
}
```

- [ ] **Step 4: Update the memory adapter**

Replace the returned object in `src/adapters/memory/chatConfig.ts` so `create` sets the default, `setBabyName` preserves siblings, and `setReportsEnabled` is added:

```ts
return {
	get: async (chatId) => R.success(byChat.get(chatId) ?? null),

	count: async () => R.success(byChat.size),

	create: async ({ chatId }) => {
		const existing = byChat.get(chatId);
		if (existing) return R.success(existing);
		const created: ChatConfig = { chatId, reportsEnabled: true };
		byChat.set(chatId, created);
		return R.success(created);
	},

	setBabyName: async (chatId, babyName) => {
		const prev = byChat.get(chatId);
		const updated: ChatConfig = {
			chatId,
			babyName,
			reportsEnabled: prev?.reportsEnabled ?? true,
		};
		byChat.set(chatId, updated);
		return R.success(updated);
	},

	setReportsEnabled: async (chatId, enabled) => {
		const prev = byChat.get(chatId);
		const updated: ChatConfig = {
			chatId,
			...(prev?.babyName ? { babyName: prev.babyName } : {}),
			reportsEnabled: enabled,
		};
		byChat.set(chatId, updated);
		return R.success(updated);
	},

	listAll: async () => R.success([...byChat.values()]),
};
```

- [ ] **Step 5: Run the memory tests to verify they pass**

Run: `npx vitest run test/unit/adapters/memory/chatConfig.test.ts`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 6: Write the failing pg-adapter tests**

In `test/unit/adapters/pg/chatConfig.test.ts`, update the `row()` helper default and add tests:

```ts
const row = (over: Record<string, unknown> = {}) => ({
	chat_id: "-100123",
	baby_name: null,
	reports_enabled: true,
	...over,
});
```

```ts
it("get maps reportsEnabled from the column", async () => {
	const db = {
		query: vi.fn().mockResolvedValue([row({ reports_enabled: false })]),
	};
	const repo = makePgChatConfigRepository({ db, logger });
	const r = await repo.get(-100123);
	if (r.success) expect(r.data?.reportsEnabled).toBe(false);
});

it("setReportsEnabled upserts and returns the mapped row", async () => {
	const db = {
		query: vi.fn().mockResolvedValue([row({ reports_enabled: false })]),
	};
	const repo = makePgChatConfigRepository({ db, logger });
	const r = await repo.setReportsEnabled(-100123, false);
	expect(r.success).toBe(true);
	if (r.success) expect(r.data.reportsEnabled).toBe(false);
	const [sql, params] = db.query.mock.calls[0] ?? [];
	expect(sql).toContain("INSERT INTO chat_configs");
	expect(sql).toContain("ON CONFLICT (chat_id) DO UPDATE");
	expect(sql).toContain("reports_enabled");
	expect(params).toEqual([-100123, false]);
});
```

- [ ] **Step 7: Run the pg tests to verify they fail**

Run: `npx vitest run test/unit/adapters/pg/chatConfig.test.ts`
Expected: FAIL — `setReportsEnabled` not a function / `reportsEnabled` undefined.

- [ ] **Step 8: Update the pg adapter**

In `src/adapters/pg/chatConfig.ts`: extend the row type, `COLUMNS`, `mapRow`, and add `setReportsEnabled`.

```ts
interface ChatConfigRow {
	chat_id: string;
	baby_name: string | null;
	reports_enabled: boolean;
}

const mapRow = (row: ChatConfigRow): ChatConfig => ({
	chatId: Number(row.chat_id),
	...(row.baby_name ? { babyName: row.baby_name } : {}),
	reportsEnabled: row.reports_enabled,
});

const COLUMNS = "chat_id, baby_name, reports_enabled";
```

Add `setReportsEnabled` to the returned object, next to `setBabyName` (same upsert shape):

```ts
setReportsEnabled: (chatId: number, enabled: boolean) =>
	tryCatch(
		async () => {
			const rows = await env.db.query(
				`INSERT INTO chat_configs (chat_id, reports_enabled)
				 VALUES ($1, $2)
				 ON CONFLICT (chat_id) DO UPDATE SET reports_enabled = EXCLUDED.reports_enabled
				 RETURNING ${COLUMNS}`,
				[chatId, enabled],
			);
			const r = rows[0] as ChatConfigRow | undefined;
			if (!r) throw new Error("setReportsEnabled returned no row");
			return mapRow(r);
		},
		(e) => e,
	),
```

(`create` is unchanged — its `INSERT` omits `reports_enabled`, so the DB default applies and the extended `RETURNING ${COLUMNS}` reflects it.)

- [ ] **Step 9: Add `setReportsEnabled` to the test-env mock**

In `test/unit/testEnv.ts`, inside `chatConfigRepository`, add after `setBabyName`:

```ts
setReportsEnabled:
	vi.fn<ChatConfigEnv["chatConfigRepository"]["setReportsEnabled"]>(),
```

- [ ] **Step 10: Run the full check**

Run: `npm run check`
Expected: PASS — lint clean, `tsc --noEmit` green (all `ChatConfigRepository` implementers now satisfy the interface), all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/domain/chatConfig.ts src/adapters/memory/chatConfig.ts src/adapters/pg/chatConfig.ts test/unit/testEnv.ts test/unit/adapters/memory/chatConfig.test.ts test/unit/adapters/pg/chatConfig.test.ts
git commit -m "feat: chatConfig supports reportsEnabled flag"
```

---

### Task 3: `/report on|off` command

**Files:**
- Modify: `src/domain/registration.ts`
- Test: `test/unit/domain/registration.test.ts`

**Interfaces:**
- Consumes: `chatConfigRepository.get` and `.setReportsEnabled` (Task 2); `makeTestEnv` (`test/unit/testEnv.ts`).
- Produces: `export const reportCommand: (chatId: number, arg: string) => (env: RegEnv) => Promise<void>` — used by Task 4's webhook wiring.

- [ ] **Step 1: Write the failing command tests**

Add to `test/unit/domain/registration.test.ts`. Import `reportCommand` alongside the existing imports:

```ts
import {
	describeIssueLink,
	nomeCommand,
	registerChat,
	reportCommand,
} from "../../../src/domain/registration.js";
```

Add a new describe block:

```ts
describe("[REGISTRATION] reportCommand", () => {
	it("bare /report shows the enabled state", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: true }),
		);
		await reportCommand(1, "")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).not.toHaveBeenCalled();
		expect(lastMessage(mocks).toLowerCase()).toContain("attivi");
	});

	it("bare /report shows the disabled state", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: false }),
		);
		await reportCommand(1, "")(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("disattivati");
	});

	it("/report off disables the reports", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: true }),
		);
		mocks.chatConfigRepository.setReportsEnabled.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: false }),
		);
		await reportCommand(1, "off")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).toHaveBeenCalledWith(
			1,
			false,
		);
		expect(lastMessage(mocks).toLowerCase()).toContain("disattivati");
	});

	it("/report on enables the reports", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: false }),
		);
		mocks.chatConfigRepository.setReportsEnabled.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: true }),
		);
		await reportCommand(1, "on")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).toHaveBeenCalledWith(
			1,
			true,
		);
		expect(lastMessage(mocks).toLowerCase()).toContain("riattivati");
	});

	it("/report with a bad arg shows a usage hint and changes nothing", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, reportsEnabled: true }),
		);
		await reportCommand(1, "pippo")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("/report on");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/domain/registration.test.ts`
Expected: FAIL — `reportCommand` is not exported.

- [ ] **Step 3: Implement `reportCommand`**

In `src/domain/registration.ts`, add the copy constants near the other message constants (top of file):

```ts
const REPORT_ON_STATE = "📊 Report automatici: attivi";
const REPORT_OFF_STATE = "📊 Report automatici: disattivati";
const REPORT_ENABLED = "🔔 Report automatici riattivati.";
const REPORT_DISABLED = "🔕 Report automatici disattivati.";
const REPORT_USAGE = "Usa /report on oppure /report off.";
```

Append the command at the end of the file (after `nomeCommand`):

```ts
/** `/report on|off` toggles the scheduled reports; bare `/report` shows the state. */
export const reportCommand =
	(chatId: number, arg: string) =>
	async (env: RegEnv): Promise<void> => {
		const trimmed = arg.trim().toLowerCase();

		if (trimmed === "") {
			const curRes = await env.chatConfigRepository.get(chatId);
			if (!curRes.success) {
				env.logger.error("report: get failed", curRes.error);
				await env.bot.sendMessage(chatId, INTERNAL_ERROR);
				return;
			}
			// Unregistered chats never reach this command (the gate blocks them), so a
			// missing row is a defensive case — treat it as the default (enabled).
			const enabled = curRes.data?.reportsEnabled ?? true;
			await env.bot.sendMessage(
				chatId,
				enabled ? REPORT_ON_STATE : REPORT_OFF_STATE,
			);
			return;
		}

		if (trimmed !== "on" && trimmed !== "off") {
			await env.bot.sendMessage(chatId, REPORT_USAGE);
			return;
		}

		const enable = trimmed === "on";
		const set = await env.chatConfigRepository.setReportsEnabled(chatId, enable);
		if (!set.success) {
			env.logger.error("report: setReportsEnabled failed", set.error);
			await env.bot.sendMessage(chatId, INTERNAL_ERROR);
			return;
		}
		await env.bot.sendMessage(
			chatId,
			enable ? REPORT_ENABLED : REPORT_DISABLED,
		);
	};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/domain/registration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/registration.ts test/unit/domain/registration.test.ts
git commit -m "feat: /report on|off command toggles scheduled reports"
```

---

### Task 4: Wire the command — webhook handler, help text, command menu

**Files:**
- Modify: `api/webhook.ts`
- Modify: `src/domain/commands.ts` (HELP_TEXT)
- Modify: `api/setup.ts` (COMMANDS)
- Test: `test/unit/domain/commands.test.ts`
- Test: `test/unit/api/setup.test.ts`

**Interfaces:**
- Consumes: `reportCommand` (Task 3); exported `HELP_TEXT` (`src/domain/commands.ts`) and `COMMANDS` (`api/setup.ts`).
- Produces: a live `/report` handler; menu + help entries.

- [ ] **Step 1: Write the failing content tests**

Add to `test/unit/domain/commands.test.ts` (import `HELP_TEXT` from `../../../src/domain/commands.js` — add it to the existing import if not present):

```ts
it("HELP_TEXT documents the /report command", () => {
	expect(HELP_TEXT).toContain("/report on|off");
});
```

Add to `test/unit/api/setup.test.ts` (import `{ COMMANDS }` from `../../../api/setup.js` — add if not present):

```ts
it("COMMANDS includes the report toggle", () => {
	expect(COMMANDS.some((c) => c.command === "report")).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/domain/commands.test.ts test/unit/api/setup.test.ts`
Expected: FAIL — no `/report` entry yet.

- [ ] **Step 3: Add the HELP_TEXT line**

In `src/domain/commands.ts`, in the `HELP_TEXT` array, add after the `/nome` line:

```ts
	"/nome Mario — imposta il nome del bimbo/a",
	"/report on|off — attiva/disattiva i report automatici",
	"/help — questo messaggio",
```

- [ ] **Step 4: Add the COMMANDS menu entry**

In `api/setup.ts`, in the `COMMANDS` array, add after the `nome` entry:

```ts
	{ command: "nome", description: "Imposta il nome del bimbo/a" },
	{ command: "report", description: "Report automatici on/off" },
	{ command: "help", description: "Aiuto" },
```

- [ ] **Step 5: Wire the webhook handler**

In `api/webhook.ts`, update the import from registration to include `reportCommand`:

```ts
import {
	nomeCommand,
	registerChat,
	reportCommand,
} from "../src/domain/registration.js";
```

Add the command handler next to the `nome` handler:

```ts
	bot.command("report", async (ctx) => {
		const arg = ctx.message.text.replace(/^\/report(@\S+)?\s*/, "");
		await reportCommand(ctx.chat.id, arg)(env);
	});
```

- [ ] **Step 6: Run the full check**

Run: `npm run check`
Expected: PASS — lint clean, types green, all tests pass (including the two new content tests).

- [ ] **Step 7: Commit**

```bash
git add api/webhook.ts src/domain/commands.ts api/setup.ts test/unit/domain/commands.test.ts test/unit/api/setup.test.ts
git commit -m "feat: wire /report command, help text, and menu entry"
```

---

### Task 5: Cron skips chats with reports disabled

**Files:**
- Modify: `api/cron/report.ts`
- Test: `test/unit/api/cron/report.test.ts`

**Interfaces:**
- Consumes: `ChatConfig.reportsEnabled` (Task 2); `sendDailyReport` / `sendWeeklyReport` (`src/domain/commands.ts`); `makeEnv` (`src/env.ts`).
- Produces: cron behaviour — enabled chats get reports, disabled chats are skipped.

- [ ] **Step 1: Write the failing cron test**

In `test/unit/api/cron/report.test.ts`, add hoisted mocks at the top of the file (after the existing imports) and a new describe block. The mocks are hoisted by Vitest above the `import handler` line, so the handler receives them:

```ts
const h = vi.hoisted(() => ({
	sendDailyReport: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
	sendWeeklyReport: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
	listAll: vi.fn(),
	deleteStale: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/domain/commands.js", () => ({
	sendDailyReport: h.sendDailyReport,
	sendWeeklyReport: h.sendWeeklyReport,
}));

vi.mock("../../../../src/env.js", () => ({
	makeEnv: () => ({
		chatConfigRepository: { listAll: h.listAll },
		pendingRepository: { deleteStale: h.deleteStale },
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			log: vi.fn(),
		},
	}),
}));

describe("[CRON report] per-chat toggle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.CRON_SECRET = "secret";
	});

	it("reports to enabled chats and skips disabled ones", async () => {
		h.listAll.mockResolvedValue({
			success: true,
			data: [
				{ chatId: 1, babyName: "Leo", reportsEnabled: true },
				{ chatId: 2, reportsEnabled: false },
			],
		});
		const res = mockRes();
		await handler(
			{
				headers: { authorization: "Bearer secret" },
			} as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(200);
		const dailyChatIds = h.sendDailyReport.mock.calls.map((c) => c[0]);
		expect(dailyChatIds).toContain(1);
		expect(dailyChatIds).not.toContain(2);
	});
});
```

> This is the heaviest test in the suite (it stubs `makeEnv` and the report senders) because the cron handler builds its own env and cannot be injected. The daily assertion is day-independent; since the skip is a single `continue` before both sends, proving daily is skipped proves weekly is too, so the Monday-only weekly branch needs no separate assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/api/cron/report.test.ts`
Expected: FAIL — chat 2 (disabled) still appears in `dailyChatIds` (the handler doesn't skip yet).

- [ ] **Step 3: Add the skip to the cron loop**

In `api/cron/report.ts`, inside the `for (const chat of chats)` loop, add the guard as the first statement:

```ts
		for (const chat of chats) {
			if (!chat.reportsEnabled) {
				env.logger.info(
					`Cron: skipping chat ${chat.chatId} (reports disabled)`,
				);
				continue;
			}
			env.logger.info(`Cron: sending reports to chat ${chat.chatId}`);
			await sendDailyReport(chat.chatId, now, chat.babyName)(env);
			if (isMonday) {
				await sendWeeklyReport(chat.chatId, now, chat.babyName)(env);
			}
			env.logger.info(`Cron: reports sent to chat ${chat.chatId}`);
		}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/api/cron/report.test.ts`
Expected: PASS — both the pre-existing auth-guard tests and the new toggle test.

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/cron/report.ts test/unit/api/cron/report.test.ts
git commit -m "feat: cron skips chats with reports disabled"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: user-facing documentation of `/report`.

- [ ] **Step 1: Document the command**

In `README.md`, find the commands list (where `/nome` is documented) and add a `/report on|off` entry describing that it turns the scheduled (daily + weekly) reports on/off per chat, default on. Match the surrounding formatting.

- [ ] **Step 2: Lint the docs (if README is covered)**

Run: `npx biome check README.md || true`
Expected: no errors (or Biome ignores markdown — either is fine).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document /report scheduled-report toggle"
```

---

## Deploy (post-merge, manual)

1. `npm run migrate:up` — adds `reports_enabled` (existing rows backfill to `true`).
2. Deploy to Vercel (cron honours the column; `/report` handler live).
3. `POST /api/setup` (with the `CRON_SECRET` bearer) — refreshes the Telegram command menu so `/report` appears. No `allowed_updates` change is needed (it's a plain message command).

## Self-Review

**Spec coverage:**
- Migration (`reports_enabled` default true) → Task 1. ✅
- Domain port `reportsEnabled` + `setReportsEnabled` → Task 2. ✅
- pg adapter (COLUMNS, mapRow, setReportsEnabled) → Task 2. ✅
- memory adapter (create default, field-preservation bug fix, setReportsEnabled) → Task 2. ✅
- `/report on|off` command + Italian copy → Task 3. ✅
- Webhook wiring + HELP_TEXT + COMMANDS menu → Task 4. ✅
- Cron skip → Task 5. ✅
- README → Task 6. ✅
- Tests (memory, pg, command, cron) → Tasks 2, 3, 5. ✅
- Deploy steps → Deploy section. ✅

**Type consistency:** `reportsEnabled` (camelCase, domain) vs `reports_enabled` (snake_case, SQL/rows) used consistently. `setReportsEnabled(chatId, enabled)` signature identical across port, pg, memory, test mock, command, and cron consumption. `ChatConfig.reportsEnabled` is non-optional everywhere; test fixtures that construct a `ChatConfig` (Tasks 3, 5) all include it.

**Placeholder scan:** none — every code step shows complete code; every run step shows an exact command and expected result. (Task 6 Step 1 is prose because the README's exact commands-section wording isn't quoted here, but the change is fully specified.)
