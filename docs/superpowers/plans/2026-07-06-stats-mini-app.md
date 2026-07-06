# Telegram Mini App — Baby Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Telegram Mini App that shows a family's baby stats (feeds, sleep, pee, poop, weight) as playful brutalist charts, launched from a `/grafici` button in the chat.

**Architecture:** A static page (`public/app.html`, served by Vercel) opened as a Telegram direct-link Mini App. It fetches `GET /api/stats`, authenticated by validating the Telegram `initData` HMAC (`BOT_TOKEN`) and authorized by `getChatMember`. Aggregation is a new pure domain module (`stats.ts`) that buckets a time window and reuses `report.ts`'s `aggregate`. The DB is never exposed to the browser.

**Tech Stack:** TypeScript (ESM, Node ≥ 24), Vercel serverless functions, telegraf, `pg` (Supabase), luxon, Vitest, Biome. No new runtime dependency; `node:crypto` only.

## Global Constraints

- **Language/runtime:** TypeScript, ESM, Node ≥ 24. Every import of a local `.ts` file uses the `.js` extension (e.g. `import { x } from "./y.js"`).
- **Errors:** domain code returns `Result<T,E>` (`success`/`error` from `src/domain/result.js`); it does not throw. API routes catch and map to HTTP codes.
- **Time:** all date math is `Europe/Rome` via luxon helpers in `src/domain/time.ts` (`romeNow`, `ZONE`). Never use local server time.
- **UI copy:** Italian. Topics: Poppate / Nanna / Pipì / Cacca / Peso. Windows: Giorno / Settimana / Mese.
- **No new dependency.** initData validation uses `node:crypto`.
- **No secret in the client.** The page sends only the raw `initData`; the server derives `chatId` from the *signed* `start_param` inside it.
- **Lint/format:** Biome (tabs, double quotes). Run `npm run check` (lint + typecheck + test) before every commit.
- **Payload duration unit:** all durations in the `/api/stats` payload are **milliseconds** (integers); counts are integers; weight is **kg** (2 decimals). The client formats for display.

---

### Task 1: Config — add `MINIAPP_URL`

`MINIAPP_URL` is the `t.me` deep-link base for the launch button (e.g. `https://t.me/PoppataBot/stats`). Required (the deep link only exists once the app is registered in BotFather). `dev.ts` builds its env without `getConfig`, so this does not affect local dev.

**Files:**
- Modify: `src/config.ts`
- Test: `test/unit/config.test.ts`
- Modify: `.env.sample`

**Interfaces:**
- Produces: `Config.miniAppUrl: string` (consumed by Task 5).

- [ ] **Step 1: Add the failing test expectations**

In `test/unit/config.test.ts`, add `MINIAPP_URL` to `FULL_ENV` and to the cleared-keys list, and assert it parses:

```ts
const FULL_ENV = {
	BOT_TOKEN: "tok",
	DATABASE_URL: "postgres://x",
	GEMINI_API_KEY: "gk",
	CRON_SECRET: "cs",
	WEBHOOK_URL: "https://ex.com",
	WEBHOOK_SECRET: "whs",
	MINIAPP_URL: "https://t.me/Bot/app",
};
```

Add `"MINIAPP_URL"` to the array of keys deleted in `beforeEach`. In the "parses a full environment" test add:

```ts
expect(c.miniAppUrl).toBe("https://t.me/Bot/app");
```

Add a new test:

```ts
it("throws when MINIAPP_URL is missing", () => {
	Object.assign(process.env, FULL_ENV);
	delete process.env.MINIAPP_URL;
	expect(() => getConfig()).toThrow(/MINIAPP_URL/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/config.test.ts`
Expected: FAIL — `c.miniAppUrl` is `undefined`; the new throw test fails (no MINIAPP_URL check yet).

- [ ] **Step 3: Implement the config field**

In `src/config.ts`, add to the `Config` type (after `webhookSecret`):

```ts
	/** t.me deep-link base for the stats Mini App, e.g. https://t.me/Bot/app */
	miniAppUrl: string;
```

And in `getConfig`'s returned object (after `webhookSecret: required("WEBHOOK_SECRET"),`):

```ts
		miniAppUrl: required("MINIAPP_URL"),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/config.test.ts`
Expected: PASS

- [ ] **Step 5: Update `.env.sample`**

Add after the `WEBHOOK_SECRET=` line:

```
# Telegram Mini App (register with BotFather /newapp; t.me deep-link base)
MINIAPP_URL=
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/unit/config.test.ts .env.sample
git commit -m "feat: add MINIAPP_URL config"
```

---

### Task 2: `src/domain/miniapp.ts` — initData validation + authorization decision

Pure module. `validateInitData` recomputes the Telegram HMAC and checks freshness; `authorizeDecision` decides whether a membership check is needed.

**Files:**
- Create: `src/domain/miniapp.ts`
- Test: `test/unit/domain/miniapp.test.ts`

**Interfaces:**
- Consumes: `Result`, `success`, `error` from `src/domain/result.js`.
- Produces:
  - `validateInitData(raw: string, botToken: string, maxAgeSec: number, now: Date): Result<{ userId: number; startParam?: string; authDate: number }>`
  - `authorizeDecision(p: { chatId: number; userId: number }): "self" | "needs-membership"`

- [ ] **Step 1: Write the failing test**

Create `test/unit/domain/miniapp.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeDecision, validateInitData } from "../../../src/domain/miniapp.js";

const TOKEN = "12345:abcdef";

/** Build a signed initData query string the same way Telegram does. */
const sign = (fields: Record<string, string>, token: string): string => {
	const params = new URLSearchParams(fields);
	const dataCheck = [...params.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");
	const secret = createHmac("sha256", "WebAppData").update(token).digest();
	const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
	params.set("hash", hash);
	return params.toString();
};

const NOW = new Date("2026-07-08T12:00:00Z");
const authDate = String(Math.floor(NOW.getTime() / 1000) - 30);

describe("[MINIAPP] validateInitData", () => {
	it("accepts a correctly signed payload and extracts user id + start_param", () => {
		const raw = sign(
			{ user: JSON.stringify({ id: 42, first_name: "A" }), auth_date: authDate, start_param: "-100999" },
			TOKEN,
		);
		const res = validateInitData(raw, TOKEN, 86400, NOW);
		expect(res.success).toBe(true);
		if (res.success) {
			expect(res.data.userId).toBe(42);
			expect(res.data.startParam).toBe("-100999");
		}
	});

	it("rejects a tampered field", () => {
		const raw = sign({ user: JSON.stringify({ id: 42 }), auth_date: authDate }, TOKEN);
		const tampered = raw.replace(/id%22%3A42/, "id%22%3A99").replace(/id":42/, 'id":99');
		const res = validateInitData(tampered, TOKEN, 86400, NOW);
		expect(res.success).toBe(false);
	});

	it("rejects a wrong token", () => {
		const raw = sign({ user: JSON.stringify({ id: 42 }), auth_date: authDate }, TOKEN);
		expect(validateInitData(raw, "99999:zzz", 86400, NOW).success).toBe(false);
	});

	it("rejects a stale auth_date", () => {
		const stale = String(Math.floor(NOW.getTime() / 1000) - 90000);
		const raw = sign({ user: JSON.stringify({ id: 42 }), auth_date: stale }, TOKEN);
		expect(validateInitData(raw, TOKEN, 86400, NOW).success).toBe(false);
	});

	it("rejects when hash is missing", () => {
		expect(validateInitData("user=%7B%7D&auth_date=1", TOKEN, 86400, NOW).success).toBe(false);
	});
});

describe("[MINIAPP] authorizeDecision", () => {
	it("returns 'self' for a private chat (chatId === userId)", () => {
		expect(authorizeDecision({ chatId: 42, userId: 42 })).toBe("self");
	});
	it("returns 'needs-membership' for a group chat", () => {
		expect(authorizeDecision({ chatId: -100999, userId: 42 })).toBe("needs-membership");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/domain/miniapp.test.ts`
Expected: FAIL with "Cannot find module '.../miniapp.js'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/miniapp.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { error, type Result, success } from "./result.js";

export interface ValidatedInitData {
	userId: number;
	startParam?: string;
	authDate: number;
}

/**
 * Validate a Telegram Mini App `initData` string:
 *   secret = HMAC_SHA256("WebAppData", botToken)
 *   check  = sorted "k=v" of every field except `hash`/`signature`, joined by "\n"
 *   valid iff hex(HMAC_SHA256(check, secret)) === hash  AND  auth_date is fresh.
 * `hash` (bot-token HMAC) and `signature` (third-party Ed25519) are both excluded
 * from the check string; only `hash` is verified here.
 */
export const validateInitData = (
	raw: string,
	botToken: string,
	maxAgeSec: number,
	now: Date,
): Result<ValidatedInitData> => {
	const params = new URLSearchParams(raw);
	const hash = params.get("hash");
	if (!hash) return error(new Error("initData: missing hash"));
	params.delete("hash");
	params.delete("signature");

	const dataCheck = [...params.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");

	const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
	const computed = createHmac("sha256", secret).update(dataCheck).digest("hex");

	const a = Buffer.from(computed, "hex");
	const b = Buffer.from(hash, "hex");
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return error(new Error("initData: bad hash"));
	}

	const authDate = Number(params.get("auth_date"));
	if (!Number.isFinite(authDate)) return error(new Error("initData: bad auth_date"));
	if (now.getTime() / 1000 - authDate > maxAgeSec) {
		return error(new Error("initData: stale"));
	}

	const userRaw = params.get("user");
	if (!userRaw) return error(new Error("initData: missing user"));
	let userId: number;
	try {
		userId = Number((JSON.parse(userRaw) as { id: unknown }).id);
	} catch {
		return error(new Error("initData: bad user"));
	}
	if (!Number.isFinite(userId)) return error(new Error("initData: bad user id"));

	const startParam = params.get("start_param") ?? undefined;
	return success({ userId, authDate, ...(startParam ? { startParam } : {}) });
};

export type AuthzKind = "self" | "needs-membership";

/** A private chat's id equals the user's id — the viewer IS the chat, so no
 *  membership lookup is needed. Any other (group/supergroup) id must be checked. */
export const authorizeDecision = (p: {
	chatId: number;
	userId: number;
}): AuthzKind => (p.chatId === p.userId ? "self" : "needs-membership");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/domain/miniapp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/miniapp.ts test/unit/domain/miniapp.test.ts
git commit -m "feat: validate Telegram Mini App initData + authz decision"
```

---

### Task 3: `src/domain/time.ts` — `bucketWindows`

Slices a timeframe into the sub-windows the charts plot. Rome-aware; deterministic given `now`.

**Files:**
- Modify: `src/domain/time.ts`
- Test: `test/unit/domain/time.test.ts`

**Interfaces:**
- Produces:
  - `type Frame = "day" | "week" | "month"`
  - `bucketWindows(now: Date, frame: Frame): { start: Date; end: Date; label: string }[]` — Giorno: 8×3h from Rome midnight (labels `"00".."21"`); Settimana: 7 daily from ISO week start Monday (labels `Lun..Dom`); Mese: 30 daily ending today (label = day-of-month every 5th bucket, else `""`).

- [ ] **Step 1: Write the failing test**

Append to `test/unit/domain/time.test.ts`:

```ts
import { bucketWindows } from "../../../src/domain/time.js";

describe("[TIME] bucketWindows", () => {
	const now = new Date("2026-07-08T12:00:00+02:00"); // Wed

	it("day → 8 three-hour buckets from Rome midnight", () => {
		const b = bucketWindows(now, "day");
		expect(b).toHaveLength(8);
		expect(b.map((x) => x.label)).toEqual(["00", "03", "06", "09", "12", "15", "18", "21"]);
		expect(b[0]?.start.toISOString()).toBe(new Date("2026-07-08T00:00:00+02:00").toISOString());
		expect(b[1]?.start.toISOString()).toBe(new Date("2026-07-08T03:00:00+02:00").toISOString());
	});

	it("week → 7 daily buckets from Monday", () => {
		const b = bucketWindows(now, "week");
		expect(b).toHaveLength(7);
		expect(b.map((x) => x.label)).toEqual(["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]);
		expect(b[0]?.start.toISOString()).toBe(new Date("2026-07-06T00:00:00+02:00").toISOString());
	});

	it("month → 30 daily buckets ending today", () => {
		const b = bucketWindows(now, "month");
		expect(b).toHaveLength(30);
		expect(b[0]?.start.toISOString()).toBe(new Date("2026-06-09T00:00:00+02:00").toISOString());
		expect(b[29]?.start.toISOString()).toBe(new Date("2026-07-08T00:00:00+02:00").toISOString());
		expect(b[0]?.label).toBe("9"); // every 5th bucket labelled
		expect(b[1]?.label).toBe("");
	});
});
```

(If `describe`/`expect`/`it` are already imported at the top of the file, do not re-import them — only add the `bucketWindows` import and the new `describe` block.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/domain/time.test.ts`
Expected: FAIL — `bucketWindows` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/time.ts`:

```ts
export type Frame = "day" | "week" | "month";

const WEEK_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

/** Sub-windows the Mini App charts plot, in Europe/Rome, deterministic in `now`.
 *  Buckets may extend past `now` (future buckets simply aggregate to zero). */
export const bucketWindows = (
	now: Date,
	frame: Frame,
): { start: Date; end: Date; label: string }[] => {
	const n = romeNow(now);
	if (frame === "day") {
		const base = n.startOf("day");
		return Array.from({ length: 8 }, (_, i) => {
			const s = base.plus({ hours: i * 3 });
			return {
				start: s.toJSDate(),
				end: s.plus({ hours: 3 }).toJSDate(),
				label: s.toFormat("HH"),
			};
		});
	}
	if (frame === "week") {
		const base = n.startOf("week"); // luxon: Monday
		return Array.from({ length: 7 }, (_, i) => {
			const s = base.plus({ days: i });
			return {
				start: s.toJSDate(),
				end: s.plus({ days: 1 }).toJSDate(),
				label: WEEK_LABELS[i] as string,
			};
		});
	}
	const base = n.startOf("day").minus({ days: 29 });
	return Array.from({ length: 30 }, (_, i) => {
		const s = base.plus({ days: i });
		return {
			start: s.toJSDate(),
			end: s.plus({ days: 1 }).toJSDate(),
			label: i % 5 === 0 ? s.toFormat("d") : "",
		};
	});
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/domain/time.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/time.ts test/unit/domain/time.test.ts
git commit -m "feat: add bucketWindows time helper"
```

---

### Task 4: `src/domain/stats.ts` — payload builder

Pure module. Buckets events per frame (reusing `aggregate`/`aggregateWeekly` from `report.ts`), maps weights g→kg, and assembles the `/api/stats` payload.

**Files:**
- Create: `src/domain/stats.ts`
- Test: `test/unit/domain/stats.test.ts`

**Interfaces:**
- Consumes: `BabyEvent` (`event.js`), `aggregate`/`aggregateWeekly` (`report.js`), `WeightReading` (`weight.js`), `bucketWindows`/`Frame` (`time.js`).
- Produces:
  - Types `TopicSeries`, `EatSeries`, `SleepSeries`, `FrameStats`, `WeightPoint`, `StatsPayload`.
  - `buildStatsPayload(input: { events: BabyEvent[]; weights: WeightReading[]; babyName?: string; now: Date }): StatsPayload`

- [ ] **Step 1: Write the failing test**

Create `test/unit/domain/stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BabyEvent } from "../../../src/domain/event.js";
import { buildStatsPayload } from "../../../src/domain/stats.js";
import type { WeightReading } from "../../../src/domain/weight.js";

const d = (iso: string) => new Date(iso);
const now = d("2026-07-08T12:00:00+02:00"); // Wed

const ev = (over: Partial<BabyEvent>): BabyEvent => ({
	id: Math.random().toString(),
	chatId: 1,
	userId: 1,
	userName: "a",
	type: "eat",
	startedAt: d("2026-07-08T09:00:00+02:00"),
	source: "rules",
	rawText: "",
	messageId: 1,
	createdAt: d("2026-07-08T09:00:00+02:00"),
	...over,
});

describe("[STATS] buildStatsPayload", () => {
	const events: BabyEvent[] = [
		ev({ type: "eat", side: "dx", startedAt: d("2026-07-08T09:00:00+02:00"), endedAt: d("2026-07-08T09:30:00+02:00") }),
		ev({ type: "bottle", amountMl: 120, startedAt: d("2026-07-08T10:00:00+02:00") }),
		ev({ type: "pee", startedAt: d("2026-07-08T07:00:00+02:00") }),
		ev({ type: "sleep", startedAt: d("2026-07-08T01:00:00+02:00"), endedAt: d("2026-07-08T03:30:00+02:00") }),
		ev({ type: "sleep", startedAt: d("2026-07-08T11:30:00+02:00") }), // open
	];
	const weights: WeightReading[] = [
		{ id: "1", chatId: 1, day: "2026-07-01", grams: 5900, userId: 1, userName: "a", createdAt: d("2026-07-01T08:00:00+02:00") },
		{ id: "2", chatId: 1, day: "2026-07-05", grams: 6100, userId: 1, userName: "a", createdAt: d("2026-07-05T08:00:00+02:00") },
	];
	const p = buildStatsPayload({ events, weights, babyName: "Mochi", now });

	it("counts feeds (breast + bottle) per day bucket and in total", () => {
		// bucket index 3 == "09" window [09:00,12:00): one feed + one bottle
		expect(p.day.eat.buckets[3]).toBe(2);
		expect(p.day.eat.total).toBe(2);
		expect(p.day.eat.feedCount).toBe(1);
		expect(p.day.eat.bottleCount).toBe(1);
		expect(p.day.eat.bottleMl).toBe(120);
		expect(p.day.eat.feedDx).toBe(1);
		expect(p.day.eat.feedSx).toBe(0);
	});

	it("places pee in the correct 3h bucket", () => {
		expect(p.day.pee.buckets[2]).toBe(1); // "06" window [06:00,09:00)
		expect(p.day.pee.total).toBe(1);
	});

	it("splits a sleep across buckets by overlap and excludes the open one", () => {
		expect(p.day.sleep.buckets[0]).toBe(2 * 3_600_000); // 01:00–03:00
		expect(p.day.sleep.buckets[1]).toBe(30 * 60_000); // 03:00–03:30
		expect(p.day.sleep.total).toBe(150 * 60_000); // 2h30 closed; open excluded
		expect(p.openSession).toBe("sleep");
	});

	it("maps weight grams to kg", () => {
		expect(p.weight).toEqual([
			{ day: "2026-07-01", kg: 5.9 },
			{ day: "2026-07-05", kg: 6.1 },
		]);
	});

	it("carries the baby name and a generatedAt stamp", () => {
		expect(p.babyName).toBe("Mochi");
		expect(p.generatedAt).toBe(now.toISOString());
	});

	it("puts today's events in the week's Wednesday bucket", () => {
		expect(p.week.eat.buckets[2]).toBe(2); // Mer
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/domain/stats.test.ts`
Expected: FAIL with "Cannot find module '.../stats.js'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/stats.ts`:

```ts
import type { BabyEvent } from "./event.js";
import { aggregate, aggregateWeekly } from "./report.js";
import { bucketWindows, type Frame } from "./time.js";
import type { WeightReading } from "./weight.js";

export interface TopicSeries {
	/** per-bucket value: a count, or milliseconds for sleep */
	buckets: number[];
	labels: string[];
	/** window total: a count, or milliseconds for sleep */
	total: number;
	/** per-day average over the frame (count/day, or ms/day for sleep) */
	avgPerDay: number;
}

export interface EatSeries extends TopicSeries {
	feedCount: number;
	bottleCount: number;
	bottleMl: number;
	avgFeedMs: number;
	feedDx: number;
	feedSx: number;
}

export interface SleepSeries extends TopicSeries {
	longestSleepMs: number;
}

export interface FrameStats {
	labels: string[];
	eat: EatSeries;
	sleep: SleepSeries;
	pee: TopicSeries;
	poo: TopicSeries;
}

export interface WeightPoint {
	day: string;
	kg: number;
}

export interface StatsPayload {
	babyName?: string;
	generatedAt: string;
	day: FrameStats;
	week: FrameStats;
	month: FrameStats;
	weight: WeightPoint[];
	openSession?: "eat" | "sleep";
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const DAYS: Record<Frame, number> = { day: 1, week: 7, month: 30 };

const frameStats = (
	events: BabyEvent[],
	frame: Frame,
	now: Date,
): FrameStats => {
	const buckets = bucketWindows(now, frame);
	const labels = buckets.map((b) => b.label);
	const per = buckets.map((b) => aggregate(events, { start: b.start, end: b.end }));
	const whole = aggregateWeekly(events, {
		start: buckets[0]?.start ?? now,
		end: now,
	});
	const days = DAYS[frame];

	const eatTotal = whole.feedCount + whole.bottleCount;
	const eat: EatSeries = {
		buckets: per.map((s) => s.feedCount + s.bottleCount),
		labels,
		total: eatTotal,
		avgPerDay: round1(eatTotal / days),
		feedCount: whole.feedCount,
		bottleCount: whole.bottleCount,
		bottleMl: whole.bottleMl,
		avgFeedMs: whole.avgFeedMs,
		feedDx: whole.feedDx,
		feedSx: whole.feedSx,
	};
	const sleep: SleepSeries = {
		buckets: per.map((s) => s.sleepMs),
		labels,
		total: whole.sleepMs,
		avgPerDay: Math.round(whole.sleepMs / days),
		longestSleepMs: whole.longestSleepMs,
	};
	const pee: TopicSeries = {
		buckets: per.map((s) => s.peeCount),
		labels,
		total: whole.peeCount,
		avgPerDay: round1(whole.peeCount / days),
	};
	const poo: TopicSeries = {
		buckets: per.map((s) => s.poopCount),
		labels,
		total: whole.poopCount,
		avgPerDay: round1(whole.poopCount / days),
	};
	return { labels, eat, sleep, pee, poo };
};

export const buildStatsPayload = (input: {
	events: BabyEvent[];
	weights: WeightReading[];
	babyName?: string;
	now: Date;
}): StatsPayload => {
	const { events, weights, babyName, now } = input;
	const weight: WeightPoint[] = weights.map((r) => ({
		day: r.day,
		kg: Math.round(r.grams / 10) / 100,
	}));
	const open = events.find(
		(e) => (e.type === "eat" || e.type === "sleep") && e.endedAt === undefined,
	);
	return {
		...(babyName ? { babyName } : {}),
		generatedAt: now.toISOString(),
		day: frameStats(events, "day", now),
		week: frameStats(events, "week", now),
		month: frameStats(events, "month", now),
		weight,
		...(open ? { openSession: open.type as "eat" | "sleep" } : {}),
	};
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/domain/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/stats.ts test/unit/domain/stats.test.ts
git commit -m "feat: add stats payload builder"
```

---

### Task 5: `/grafici` command — bot port, adapters, command, wiring

Add a `sendLinkButton` method to the `BotEnv.bot` port (mirrors `sendConfirmation`), implement it in the telegraf + console adapters, add the mock to `testEnv`, add `graficiCommand`, and wire it into the webhook + command list + dev harness.

**Files:**
- Modify: `src/domain/bot.ts`, `src/adapters/telegraf/bot.ts`, `src/adapters/console/bot.ts`, `test/unit/testEnv.ts`
- Modify: `src/domain/commands.ts`, `api/webhook.ts`, `api/setup.ts`, `src/dev.ts`
- Test: `test/unit/domain/commands.test.ts`, `test/unit/api/setup.test.ts`

**Interfaces:**
- Consumes: `Config.miniAppUrl` (Task 1).
- Produces:
  - `BotEnv.bot.sendLinkButton(chatId: number, text: string, buttonText: string, url: string): Promise<void>`
  - `graficiCommand(chatId: number, miniAppUrl: string): (env: BotEnv) => Promise<void>` in `src/domain/commands.ts`
  - `COMMANDS` exported from `api/setup.ts`.

- [ ] **Step 1: Add the `sendLinkButton` mock to `testEnv` and write the failing command test**

In `test/unit/testEnv.ts`, add to the `bot` mock object (after `clearKeyboard`):

```ts
			sendLinkButton: vi.fn<BotEnv["bot"]["sendLinkButton"]>(),
```

Add a test to `test/unit/domain/commands.test.ts` (place with the other command tests; reuse the file's existing `makeTestEnv` import):

```ts
import { graficiCommand } from "../../../src/domain/commands.js";

describe("[COMMANDS] graficiCommand", () => {
	it("sends a link button to the Mini App with the chat id in startapp", async () => {
		const { mocks, env } = makeTestEnv();
		mocks.bot.sendLinkButton.mockResolvedValue();
		await graficiCommand(-100999, "https://t.me/Bot/app")(env);
		expect(mocks.bot.sendLinkButton).toHaveBeenCalledWith(
			-100999,
			expect.any(String),
			expect.any(String),
			"https://t.me/Bot/app?startapp=-100999",
		);
	});
});
```

(If `describe`/`it`/`expect`/`makeTestEnv` are already imported at the top of `commands.test.ts`, add only the `graficiCommand` import.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: FAIL — `graficiCommand` not exported; type error on `sendLinkButton` (not yet on the port).

- [ ] **Step 3: Add `sendLinkButton` to the port**

In `src/domain/bot.ts`, add to the `bot` interface in `BotEnv` (after the `clearKeyboard` signature):

```ts
		sendLinkButton(
			chatId: number,
			text: string,
			buttonText: string,
			url: string,
		): Promise<void>;
```

- [ ] **Step 4: Implement it in the telegraf adapter**

In `src/adapters/telegraf/bot.ts`, add to the `botEnv.bot` object (after `clearKeyboard`):

```ts
				sendLinkButton: async (chatId, text, buttonText, url) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: { inline_keyboard: [[{ text: buttonText, url }]] },
					});
				},
```

- [ ] **Step 5: Implement it in the console adapter**

In `src/adapters/console/bot.ts`, add to the `botEnv.bot` object (after `clearKeyboard`):

```ts
				sendLinkButton: async (chatId, text, buttonText, url) => {
					console.log(`\n💬 [${chatId}] ${text}\n   [${buttonText}] → ${url}`);
				},
```

- [ ] **Step 6: Add `graficiCommand`**

In `src/domain/commands.ts`, add (near the other `*Command` exports; import `BotEnv` if not already imported — it is used by other commands in this file):

```ts
const GRAFICI_TEXT = "📊 Apri le statistiche del bambino";
const GRAFICI_BUTTON = "📊 Apri statistiche";

/** Reply with a button that opens the stats Mini App for this chat. */
export const graficiCommand =
	(chatId: number, miniAppUrl: string) =>
	async (env: BotEnv): Promise<void> => {
		await env.bot.sendLinkButton(
			chatId,
			GRAFICI_TEXT,
			GRAFICI_BUTTON,
			`${miniAppUrl}?startapp=${chatId}`,
		);
	};
```

- [ ] **Step 7: Run the command tests to verify they pass**

Run: `npx vitest run test/unit/domain/commands.test.ts`
Expected: PASS

- [ ] **Step 8: Write the failing setup test**

In `test/unit/api/setup.test.ts`, add at the top-level (after the imports):

```ts
import { COMMANDS } from "../../../api/setup.js";

describe("[SETUP] command list", () => {
	it("includes /grafici", () => {
		expect(COMMANDS.some((c) => c.command === "grafici")).toBe(true);
	});
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npx vitest run test/unit/api/setup.test.ts`
Expected: FAIL — `COMMANDS` is not exported.

- [ ] **Step 10: Export `COMMANDS` and add the entry**

In `api/setup.ts`, change `const COMMANDS = [` to `export const COMMANDS = [` and add an entry (before `{ command: "nome", ... }`):

```ts
	{ command: "grafici", description: "Grafici e statistiche" },
```

- [ ] **Step 11: Wire the command into the webhook**

In `api/webhook.ts`, add the import:

```ts
import { graficiCommand } from "../src/domain/commands.js";
```

(Merge into the existing `../src/domain/commands.js` import list rather than adding a second import from the same module.)

In `initBot`, add a command handler (next to `bot.command("stato", …)`):

```ts
		bot.command("grafici", async (ctx) => {
			await graficiCommand(ctx.chat.id, env.config.miniAppUrl)(env);
		});
```

- [ ] **Step 12: Add a `/grafici` case to the dev harness**

In `src/dev.ts`, add a constant near `DEV_REPO_ISSUES_URL`:

```ts
const DEV_MINIAPP_URL = "https://t.me/Bot/app";
```

Import `graficiCommand` (merge into the existing `./domain/commands.js` import list), and add a case in `runCommand`'s `switch` (before `default:`):

```ts
		case "/grafici":
			await graficiCommand(DEV_CHAT_ID, DEV_MINIAPP_URL)(env);
			return true;
```

- [ ] **Step 13: Run the full check**

Run: `npm run check`
Expected: lint clean, typecheck clean, all tests PASS.

- [ ] **Step 14: Commit**

```bash
git add src/domain/bot.ts src/adapters/telegraf/bot.ts src/adapters/console/bot.ts test/unit/testEnv.ts src/domain/commands.ts test/unit/domain/commands.test.ts api/webhook.ts api/setup.ts test/unit/api/setup.test.ts src/dev.ts
git commit -m "feat: /grafici command opens the stats Mini App"
```

---

### Task 6: `api/stats.ts` — the data endpoint

Validates `initData`, resolves + authorizes the chat, reads events/weights/config, returns the payload.

**Files:**
- Create: `api/stats.ts`
- Modify: `vercel.json`
- Test: `test/unit/api/stats.test.ts`

**Interfaces:**
- Consumes: `validateInitData`, `authorizeDecision` (Task 2); `buildStatsPayload` (Task 4); `bucketWindows` (Task 3); `makeEnv`/`Env` (`src/env.js`).

- [ ] **Step 1: Write the failing test (guard paths)**

Create `test/unit/api/stats.test.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../api/stats.js";

const mockRes = () => {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	return res;
};

const FULL_ENV = {
	BOT_TOKEN: "tok",
	DATABASE_URL: "postgres://x",
	GEMINI_API_KEY: "gk",
	CRON_SECRET: "cs",
	WEBHOOK_URL: "https://ex.com",
	WEBHOOK_SECRET: "whs",
	MINIAPP_URL: "https://t.me/Bot/app",
};

describe("[STATS] guards", () => {
	let saved: NodeJS.ProcessEnv;
	beforeEach(() => {
		saved = { ...process.env };
		Object.assign(process.env, FULL_ENV);
	});
	afterEach(() => {
		process.env = saved;
	});

	it("405 for non-GET", async () => {
		const res = mockRes();
		await handler(
			{ method: "POST", headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(405);
	});

	it("401 when the init-data header is missing", async () => {
		const res = mockRes();
		await handler(
			{ method: "GET", headers: {} } as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it("401 when the init-data is invalid", async () => {
		const res = mockRes();
		await handler(
			{
				method: "GET",
				headers: { "x-telegram-init-data": "user=%7B%7D&auth_date=1&hash=deadbeef" },
			} as unknown as VercelRequest,
			res as unknown as VercelResponse,
		);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/api/stats.test.ts`
Expected: FAIL with "Cannot find module '.../api/stats.js'".

- [ ] **Step 3: Write the endpoint**

Create `api/stats.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authorizeDecision, validateInitData } from "../src/domain/miniapp.js";
import { buildStatsPayload } from "../src/domain/stats.js";
import { bucketWindows } from "../src/domain/time.js";
import { type Env, makeEnv } from "../src/env.js";

let env: Env;
let initialized = false;

const ACTIVE = new Set(["creator", "administrator", "member", "restricted"]);
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<VercelResponse> {
	if (req.method !== "GET") {
		return res.status(405).json({ error: "Method not allowed" });
	}
	const rawHeader = req.headers["x-telegram-init-data"];
	const initData = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
	if (!initData) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	if (!initialized) {
		env = makeEnv();
		initialized = true;
	}

	const valid = validateInitData(
		initData,
		env.config.botToken,
		INIT_DATA_MAX_AGE_SEC,
		new Date(),
	);
	if (!valid.success) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	const { userId, startParam } = valid.data;

	const chatId = Number(startParam);
	if (!Number.isFinite(chatId)) {
		return res.status(400).json({ error: "Bad chat" });
	}

	try {
		if (authorizeDecision({ chatId, userId }) === "needs-membership") {
			let status: string;
			try {
				const member = await env.telegrafBot.telegram.getChatMember(chatId, userId);
				status = member.status;
			} catch {
				// getChatMember throws for a non-participant — treat as forbidden.
				return res.status(403).json({ error: "Forbidden" });
			}
			if (!ACTIVE.has(status)) {
				return res.status(403).json({ error: "Forbidden" });
			}
		}

		const now = new Date();
		const monthStart = bucketWindows(now, "month")[0]?.start ?? now;
		const [eventsRes, weightsRes, cfgRes] = await Promise.all([
			env.eventRepository.listSince(chatId, monthStart, now),
			env.weightRepository.list(chatId),
			env.chatConfigRepository.get(chatId),
		]);
		if (!eventsRes.success) throw eventsRes.error;
		if (!weightsRes.success) throw weightsRes.error;
		const babyName =
			cfgRes.success && cfgRes.data?.babyName ? cfgRes.data.babyName : undefined;

		const payload = buildStatsPayload({
			events: eventsRes.data,
			weights: weightsRes.data,
			now,
			...(babyName ? { babyName } : {}),
		});
		return res.status(200).json(payload);
	} catch (error) {
		console.error("Stats error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/api/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Register the function in `vercel.json`**

In `vercel.json`, add to `"functions"` (after the `api/webhook.ts` entry):

```json
		"api/stats.ts": { "maxDuration": 10 },
```

- [ ] **Step 6: Run the full check**

Run: `npm run check`
Expected: all PASS, lint + typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add api/stats.ts test/unit/api/stats.test.ts vercel.json
git commit -m "feat: add /api/stats endpoint for the Mini App"
```

---

### Task 7: `public/app.html` — the Mini App page

Port the existing prototype to Italian, wire it to `GET /api/stats` via the Telegram WebApp SDK, and render weight as a real-readings line. No unit test (static asset); verified manually against a deployed endpoint.

**Files:**
- Create: `public/app.html` (copied from `stats-prototype/baby-stats-tracker.html`, then edited)

**Interfaces:**
- Consumes: the `StatsPayload` JSON from Task 6.

- [ ] **Step 1: Copy the prototype**

```bash
cp stats-prototype/baby-stats-tracker.html public/app.html
```

- [ ] **Step 2: Add the Telegram SDK script**

In `public/app.html`, inside `<head>` (right after the `<title>` line), add:

```html
	<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

- [ ] **Step 3: Italianize the static HTML**

Apply these exact text replacements in the markup:
- `<span class="kicker">Baby Stats</span>` → `<span class="kicker">Statistiche</span>`
- `<h1 id="topicTitle">Feeds</h1>` → `<h1 id="topicTitle">Poppate</h1>`
- `<div class="label" id="heroLabel">Today’s feeds</div>` → `<div class="label" id="heroLabel">Poppate oggi</div>`
- `<div class="sub" id="heroSub">bottles + breast</div>` → `<div class="sub" id="heroSub">seno + biberon</div>`
- Topic buttons text: `Eat`→`Poppate`, `Sleep`→`Nanna`, `Pee`→`Pipì`, `Poo`→`Cacca`, `Weight`→`Peso`.
- Timeframe buttons: `Day`→`Giorno`, `Week`→`Settimana`, `Month`→`Mese`; the `<span class="title">Window</span>` → `<span class="title">Periodo</span>`.
- Footer: `<span class="live"><span class="dot"></span>Sample data</span>` → `<span class="live"><span class="dot"></span>Dati live</span>`; leave `<span id="babyName">…</span>` (JS overwrites it).

- [ ] **Step 4: Replace the entire `<script> … </script>` block**

Delete the prototype's whole `<script>(function(){ … })();</script>` and replace it with:

```html
<script>
(function () {
  const $ = (id) => document.getElementById(id);
  const getVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const TOPICS = {
    eat:    { title: "Poppate", glyph: "🍼", varName: "--eat" },
    sleep:  { title: "Nanna",   glyph: "😴", varName: "--sleep" },
    pee:    { title: "Pipì",    glyph: "💦", varName: "--pee" },
    poo:    { title: "Cacca",   glyph: "💩", varName: "--poo" },
    weight: { title: "Peso",    glyph: "⚖️", varName: "--weight" },
  };
  const FRAME_LABEL = { day: "Oggi", week: "Questa settimana", month: "Questo mese" };
  const RANGE_DAYS = { day: 7, week: 7, month: 30 };

  const hrs = (ms) => +(ms / 3_600_000).toFixed(1);
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60_000);
    const h = Math.floor(m / 60), r = m % 60;
    return h > 0 ? (r > 0 ? h + "h " + r + "m" : h + "h") : m + "m";
  };
  const fmtDay = (ymd) => { const [, mo, da] = ymd.split("-"); return Number(da) + "/" + Number(mo); };

  const cvs = $("chart"), ctx = cvs.getContext("2d");
  let P = null, topic = "eat", frame = "day";

  function fatal(msg) {
    document.body.innerHTML =
      '<main class="phone" style="padding:24px"><h1 style="font-family:var(--font-display);text-transform:uppercase">Ops</h1><p style="margin-top:12px;font-weight:600">' +
      msg + "</p></main>";
  }

  async function load() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData) { fatal("Apri questa pagina dal bot su Telegram."); return; }
    tg.ready(); tg.expand();
    let res;
    try {
      res = await fetch("/api/stats", { headers: { "X-Telegram-Init-Data": tg.initData } });
    } catch (_e) { fatal("Errore di rete. Riprova."); return; }
    if (res.status === 401) { fatal("Sessione non valida. Riapri dal bot."); return; }
    if (res.status === 403) { fatal("Non sei autorizzato a vedere queste statistiche."); return; }
    if (!res.ok) { fatal("Errore del server. Riprova più tardi."); return; }
    P = await res.json();
    $("babyName").textContent = P.babyName ? "👶 " + P.babyName : "";
    restore();
    setTopic(topic);
    setFrame(frame);
  }

  // { values, labels, line, decimal, color }
  function series() {
    const color = getVar(TOPICS[topic].varName);
    if (topic === "weight") {
      const cutoff = Date.parse(P.generatedAt) - RANGE_DAYS[frame] * 86_400_000;
      const pts = P.weight.filter((p) => Date.parse(p.day + "T00:00:00Z") >= cutoff);
      return { values: pts.map((p) => p.kg), labels: pts.map((p) => fmtDay(p.day)), line: true, decimal: true, color };
    }
    const fs = P[frame], t = fs[topic];
    const values = topic === "sleep" ? t.buckets.map(hrs) : t.buckets;
    return { values, labels: fs.labels, line: false, decimal: topic === "sleep", color };
  }

  function setHeroAndCards() {
    if (topic === "weight") {
      const pts = P.weight;
      const latest = pts.length ? pts[pts.length - 1].kg : null;
      const delta = pts.length >= 2 ? +(pts[pts.length - 1].kg - pts[0].kg).toFixed(2) : 0;
      $("heroLabel").textContent = "Peso";
      $("heroValue").textContent = latest === null ? "—" : latest;
      $("heroSub").textContent = "kg · ultimo";
      $("statTotal").textContent = latest === null ? "—" : latest + "kg";
      $("statTotalK").innerHTML = "Ultimo<small>peso</small>";
      $("statAvg").textContent = (delta >= 0 ? "+" : "") + delta + "kg";
      $("statAvgK").innerHTML = "Variazione<small>sul periodo</small>";
      return;
    }
    const t = P[frame][topic];
    if (topic === "eat") {
      $("heroLabel").textContent = FRAME_LABEL[frame] + " · poppate";
      $("heroValue").textContent = t.total;
      $("heroSub").textContent = t.feedSx + " sx · " + t.feedDx + " dx";
      $("statTotal").textContent = t.bottleMl + "ml";
      $("statTotalK").innerHTML = "Biberon<small>" + t.bottleCount + " biberon</small>";
      $("statAvg").textContent = fmtDur(t.avgFeedMs);
      $("statAvgK").innerHTML = "Media<small>per poppata</small>";
    } else if (topic === "sleep") {
      $("heroLabel").textContent = FRAME_LABEL[frame] + " · sonno";
      $("heroValue").textContent = hrs(t.total) + "h";
      $("heroSub").textContent = "totale";
      $("statTotal").textContent = hrs(t.longestSleepMs) + "h";
      $("statTotalK").innerHTML = "Più lunga<small>nel periodo</small>";
      $("statAvg").textContent = hrs(t.avgPerDay) + "h";
      $("statAvgK").innerHTML = "Media<small>al giorno</small>";
    } else {
      $("heroLabel").textContent = FRAME_LABEL[frame] + " · " + TOPICS[topic].title.toLowerCase();
      $("heroValue").textContent = t.total;
      $("heroSub").textContent = "totale";
      $("statTotal").textContent = t.total;
      $("statTotalK").innerHTML = "Totale<small>nel periodo</small>";
      $("statAvg").textContent = t.avgPerDay;
      $("statAvgK").innerHTML = "Media<small>al giorno</small>";
    }
  }

  function render() {
    if (!P) return;
    const s = series();
    setHeroAndCards();
    drawChart(s.values, s.labels, s);
    cvs.setAttribute("aria-label", TOPICS[topic].title + ": " + s.values.join(", "));
  }

  function setTopic(t) {
    topic = t;
    document.querySelectorAll(".topic").forEach((b) => b.setAttribute("aria-pressed", b.dataset.topic === t));
    const accent = getVar(TOPICS[t].varName);
    document.documentElement.style.setProperty("--accent", accent);
    document.querySelectorAll(".topic").forEach((b) => b.style.removeProperty("--tc"));
    const active = document.querySelector('.topic[data-topic="' + t + '"]');
    if (active) active.style.setProperty("--tc", accent);
    $("topicTitle").textContent = TOPICS[t].title;
    $("heroGlyph").textContent = TOPICS[t].glyph;
    persist();
    render();
  }
  function setFrame(f) {
    frame = f;
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.frame === f));
    persist();
    render();
  }

  function drawChart(arr, labs, d) {
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.clientWidth, h = 200;
    cvs.width = w * dpr; cvs.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 6, r: 6, t: 14, b: 6 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const n = arr.length;
    const ax = $("axis"); ax.innerHTML = "";
    if (n === 0) { return; }
    const max = Math.max(...arr) * 1.15 || 1;
    const min = d.line ? Math.min(...arr) * 0.985 : 0;
    const span = (max - min) || 1;

    if (d.line) {
      ctx.strokeStyle = "#e7e2d6"; ctx.lineWidth = 1;
      for (let g = 0; g <= 3; g++) { const y = pad.t + ih * (g / 3); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
      const pts = arr.map((v, i) => [pad.l + iw * (n === 1 ? 0.5 : i / (n - 1)), pad.t + ih * (1 - (v - min) / span)]);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.lineTo(pts[n - 1][0], pad.t + ih); ctx.lineTo(pts[0][0], pad.t + ih); ctx.closePath();
      ctx.fillStyle = hexA(d.color, 0.22); ctx.fill();
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = d.color; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.stroke();
      pts.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#141210"; ctx.stroke(); });
    } else {
      const gap = 8, bw = (iw - gap * (n - 1)) / n;
      arr.forEach((v, i) => {
        const bh = ih * (v / max);
        const x = pad.l + i * (bw + gap), y = pad.t + ih - bh;
        ctx.fillStyle = "#141210"; ctx.fillRect(x + 3, y + 3, bw, bh);
        ctx.fillStyle = d.color; ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = "#141210"; ctx.lineWidth = 3; ctx.strokeRect(x, y, bw, bh);
        if (v > 0 && bw > 16) { ctx.fillStyle = "#141210"; ctx.font = "700 11px system-ui"; ctx.textAlign = "center"; ctx.fillText(String(v), x + bw / 2, y - 4); }
      });
    }
    labs.forEach((l) => { const sp = document.createElement("span"); sp.textContent = l; ax.appendChild(sp); });
  }
  function hexA(hex, a) {
    const hx = hex.replace("#", "");
    const r = parseInt(hx.substr(0, 2), 16), g = parseInt(hx.substr(2, 2), 16), b = parseInt(hx.substr(4, 2), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function persist() {
    try { localStorage.setItem("babystats", JSON.stringify({ topic, frame })); } catch (_e) {}
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem("babystats") || "{}");
      if (s.topic && TOPICS[s.topic]) topic = s.topic;
      if (["day", "week", "month"].includes(s.frame)) frame = s.frame;
    } catch (_e) {}
  }

  document.querySelectorAll(".topic").forEach((b) => b.addEventListener("click", () => setTopic(b.dataset.topic)));
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setFrame(b.dataset.frame)));
  window.addEventListener("resize", render);

  load();
})();
</script>
```

- [ ] **Step 5: Sanity-check locally (structure only, no data)**

Run: `npx serve public` (or any static server) and open `/app.html` in a browser.
Expected: the page renders the shell and shows "Apri questa pagina dal bot su Telegram." (there is no Telegram SDK context in a plain browser — this is the correct fallback).

- [ ] **Step 6: Commit**

```bash
git add public/app.html
git commit -m "feat: Mini App stats page (Italian, live data)"
```

---

### Task 8: Docs — README + roadmap

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add `/grafici` to the commands table**

In `README.md`, add a row to the Commands table (after the `/peso` row):

```
| `/grafici` | apri la mini app con grafici e statistiche |
```

- [ ] **Step 2: Add a Mini App section**

Add a short section (after "Reports"), documenting:
- What it shows (feeds / sleep / pee / poop / weight, over day / week / month).
- Security: `initData` HMAC (`BOT_TOKEN`) + `getChatMember`; the DB is never exposed.
- One-time setup: BotFather `/newapp` (short name + Web App URL `https://<deployment>/app.html`), set `MINIAPP_URL`, re-run `/api/setup`.

```markdown
### Stats Mini App

`/grafici` posts a button that opens a **Telegram Mini App** (`public/app.html`,
served by Vercel) with playful charts of feeds, sleep, pee, poop and weight over
**Giorno / Settimana / Mese**. It reads `GET /api/stats`, which validates the
Telegram `initData` HMAC (`BOT_TOKEN`) and checks group membership via
`getChatMember` before returning anything — the Postgres connection is never
exposed to the browser.

**One-time setup:** register a direct-link Mini App with BotFather (`/newapp` →
pick the bot → short name, e.g. `stats` → Web App URL
`https://<deployment>/app.html`), set `MINIAPP_URL=https://t.me/<botusername>/<shortname>`
in the environment, then re-run `/api/setup`.
```

- [ ] **Step 3: Tick the roadmap bullet**

Change `- [ ] mini app telegram that shows graphs / stats` to `- [x] mini app telegram that shows graphs / stats`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the stats Mini App"
```

---

## Self-Review

**Spec coverage:**
- Mini App page → Task 7. `api/stats` (initData HMAC + `getChatMember` + `start_param` chatId) → Tasks 2, 6. Aggregation/bucketing reusing `report.ts` → Tasks 3, 4. Eat = feed count + rich cards → Tasks 4 (payload fields) + 7 (cards). Giorno(3h)/Settimana/Mese + new month window → Task 3. Weight = kg line, range = timeframe, Giorno→latest+delta → Tasks 4 + 7. Italian UI → Task 7. `/grafici` launch button + `MINIAPP_URL` + BotFather step → Tasks 1, 5, 8. Combined single payload → Tasks 4, 6. All covered.

**Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands.

**Type consistency:** `validateInitData`/`authorizeDecision` signatures match between Task 2 definition and Task 6 use. `buildStatsPayload` input/output match between Task 4 and Task 6. `sendLinkButton(chatId, text, buttonText, url)` is identical across the port (Task 5 Step 3), both adapters (Steps 4–5), the mock (Step 1), `graficiCommand` (Step 6), and the command test (Step 1). `bucketWindows(now, frame)` matches between Task 3 and Tasks 4/6. Payload field names (`feedCount`, `bottleMl`, `avgFeedMs`, `feedDx`, `feedSx`, `longestSleepMs`, `avgPerDay`, `total`, `buckets`, `labels`, `weight[].kg`, `openSession`) are consistent between `stats.ts` (Task 4) and `app.html` (Task 7).

## Manual verification (after deploy)

Not unit-testable; confirm once deployed:
1. BotFather `/newapp` done, `MINIAPP_URL` set, `/api/setup` re-run.
2. `/grafici` in a registered group → button appears → opens the Mini App.
3. A group member sees charts; topics + Giorno/Settimana/Mese switch with no reload; weight shows the kg line.
4. Opening the page URL in a plain browser shows the "apri dal bot" fallback (no data leak).
5. (Optional) A user who is not a member of the group cannot load another chat's stats (403).
