# Ask Breast Side + destro/sinistro Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a feed (`eat`) start arrives without a breast side, ask for it with `[Sinistro][Destro]` buttons and save on tap; also accept `destro`/`sinistro` as input and display them (instead of `dx`/`sx`) in per-event bot copy.

**Architecture:** Reuse the existing pending-confirmation store — a "side prompt" is a pending row holding the side-less intent, distinguished only by the callback verb (`dx:`/`sx:` vs `conf:`/`ann:`). Callback routing is already generic (`data.split(":")`), so new verbs need no adapter routing. The invariant enforced across both save boundaries (message path + confirm callback): *an `eat` start is never persisted without a side.*

**Tech Stack:** TypeScript ESM (Node ≥ 24), telegraf, Vitest, Biome (tab indentation).

## Global Constraints

- Storage and the Gemini enum stay canonical: `Side = "dx" | "sx"`, Gemini `dx | sx | none`. The alias is input-parsing + display only. No DB migration.
- Reports are unchanged — the stat line keeps compact `dx N, sx N` (`report.ts` is not touched).
- Copy (verbatim): side prompt `"Per quale seno? 🤱"`; buttons `"Sinistro"` (`sx:<id>`) and `"Destro"` (`dx:<id>`); side-tap confirmation `"<start-line> ✅"` where the start-line is `"Poppata iniziata alle HH:MM — seno destro"`.
- Display map: `SIDE_LABEL: Record<Side, string> = { dx: "destro", sx: "sinistro" }`.
- Side applies only to `eat` + `start`. No `sleep`/`pee`/`poop`/`end` side.
- Biome formatting: tabs, double quotes. Run `npm run lint:apply` before committing if formatting drifts.

---

### Task 1: destro/sinistro aliases (input) + SIDE_LABEL display (output)

**Files:**
- Modify: `src/domain/parse.ts` (side regexes, ~lines 61-62)
- Modify: `src/domain/event.ts` (add `SIDE_LABEL`, after `LABEL` ~line 55-60)
- Modify: `src/domain/bot.ts` (`describeIntent` ~line 75; import `SIDE_LABEL`)
- Test: `test/unit/domain/parse.test.ts`, `test/unit/domain/bot.test.ts`

**Interfaces:**
- Produces: `SIDE_LABEL: Record<Side, string>` exported from `src/domain/event.js`.

- [ ] **Step 1: Add failing parse-alias cases**

In `test/unit/domain/parse.test.ts`, add these two entries to the `cases` array (e.g. right after the `"poppata sinistra"` case at line 66-69):

```ts
		{
			input: "poppata destro",
			expect: { type: "eat", action: "start", side: "dx", confidence: 1 },
		},
		{
			input: "poppata sinistro",
			expect: { type: "eat", action: "start", side: "sx", confidence: 1 },
		},
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/domain/parse.test.ts`
Expected: FAIL — `"poppata destro"` yields no `side` (currently `destro`/`sinistro` are unmatched).

- [ ] **Step 3: Extend the side regexes**

In `src/domain/parse.ts` replace lines 61-62:

```ts
const SIDE_DX = /\b(dx|destra|destro|right)\b/;
const SIDE_SX = /\b(sx|sinistra|sinistro|left)\b/;
```

- [ ] **Step 4: Run to verify parse cases pass**

Run: `npx vitest run test/unit/domain/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `SIDE_LABEL` to the domain**

In `src/domain/event.ts`, add after the `LABEL` constant (after line 60):

```ts
/** Human display for a side — bot copy uses these, storage stays dx/sx. */
export const SIDE_LABEL: Record<Side, string> = {
	dx: "destro",
	sx: "sinistro",
};
```

- [ ] **Step 6: Add a failing describeIntent-output test**

In `test/unit/domain/bot.test.ts`, add inside `describe("[BOT] handleMessage", ...)` (e.g. after the low-confidence test at line 143):

```ts
	it("shows the side as destro/sinistro in confirm copy", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.parser.parse.mockResolvedValue(
			success({ type: "eat", action: "start", side: "dx", confidence: 0.4 }),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p9", createdAt: new Date() }),
		);

		await handleMessage(msg("qualcosa di poco chiaro"))(env);

		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("destro"),
			"p9",
		);
	});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "destro/sinistro in confirm copy"`
Expected: FAIL — copy currently contains `dx`, not `destro`.

- [ ] **Step 8: Map the side in `describeIntent`**

In `src/domain/bot.ts`, update the `event.js` import to include `SIDE_LABEL`:

```ts
import {
	type BabyEvent,
	type EventEnv,
	type EventSource,
	LABEL,
	type NewBabyEvent,
	SIDE_LABEL,
} from "./event.js";
```

Then in `describeIntent` replace line 75:

```ts
	if (intent.side) parts.push(SIDE_LABEL[intent.side]);
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS (all files).

- [ ] **Step 10: Commit**

```bash
git add src/domain/parse.ts src/domain/event.ts src/domain/bot.ts test/unit/domain/parse.test.ts test/unit/domain/bot.test.ts
git commit -m "feat: accept destro/sinistro and display sides as words"
```

---

### Task 2: `sendSidePrompt` port + adapters + test mock

**Files:**
- Modify: `src/domain/bot.ts` (`BotEnv.bot` interface, ~lines 16-28)
- Modify: `src/adapters/telegraf/bot.ts` (after `sendConfirmation`, ~line 49)
- Modify: `src/adapters/console/bot.ts` (after `sendConfirmation`, ~line 30)
- Modify: `test/unit/testEnv.ts` (bot mock, ~line 27)
- Test: `test/unit/adapters/telegraf/bot.test.ts`

**Interfaces:**
- Produces: `BotEnv.bot.sendSidePrompt(chatId: number, text: string, pendingId: string): Promise<void>` — renders two inline buttons with callback data `sx:<pendingId>` and `dx:<pendingId>`.

- [ ] **Step 1: Add the port method to `BotEnv`**

In `src/domain/bot.ts`, inside `BotEnv.bot`, add after the `sendConfirmation` method (after line 24):

```ts
		sendSidePrompt(
			chatId: number,
			text: string,
			pendingId: string,
		): Promise<void>;
```

- [ ] **Step 2: Add a failing telegraf test**

In `test/unit/adapters/telegraf/bot.test.ts`, add after the `sendConfirmation` test (after line 63):

```ts
	it("sendSidePrompt builds sx:/dx: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await botEnv.bot.sendSidePrompt(1, "Per quale seno? 🤱", "p1");
		expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Per quale seno? 🤱", {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Sinistro", callback_data: "sx:p1" },
						{ text: "Destro", callback_data: "dx:p1" },
					],
				],
			},
		});
	});
```

- [ ] **Step 3: Run to verify it fails (compile error)**

Run: `npx vitest run test/unit/adapters/telegraf/bot.test.ts`
Expected: FAIL — `sendSidePrompt` does not exist on the telegraf botEnv (type error / undefined).

- [ ] **Step 4: Implement `sendSidePrompt` in the telegraf adapter**

In `src/adapters/telegraf/bot.ts`, add after the `sendConfirmation` block (after line 49):

```ts
					sendSidePrompt: async (chatId, text, pendingId) => {
						await bot.telegram.sendMessage(chatId, text, {
							reply_markup: {
								inline_keyboard: [
									[
										{ text: "Sinistro", callback_data: `sx:${pendingId}` },
										{ text: "Destro", callback_data: `dx:${pendingId}` },
									],
								],
							},
						});
					},
```

- [ ] **Step 5: Implement `sendSidePrompt` in the console adapter**

In `src/adapters/console/bot.ts`, add after the `sendConfirmation` block (after line 30):

```ts
				sendSidePrompt: async (chatId, text, pendingId) => {
					const mid = ++msgSeq;
					state.lastPendingId = pendingId;
					state.lastConfirmationMessageId = mid;
					console.log(
						`\n🤱  [${chatId}] ${text}\n   [Sinistro] [Destro]   (pending ${pendingId}, msg ${mid})\n   → scrivi "sx" o "dx"`,
					);
				},
```

- [ ] **Step 6: Add `sendSidePrompt` to the test mock**

In `test/unit/testEnv.ts`, add to the `bot` mock after the `sendConfirmation` line (line 27):

```ts
			sendSidePrompt: vi.fn<BotEnv["bot"]["sendSidePrompt"]>(),
```

- [ ] **Step 7: Run typecheck + suite**

Run: `npm run typecheck && npm test`
Expected: PASS. The new telegraf test passes; no other file fails to compile.

- [ ] **Step 8: Commit**

```bash
git add src/domain/bot.ts src/adapters/telegraf/bot.ts src/adapters/console/bot.ts test/unit/testEnv.ts test/unit/adapters/telegraf/bot.test.ts
git commit -m "feat: add sendSidePrompt port + telegraf/console adapters"
```

---

### Task 3: Ask side on feed start (message path) + side echo on typed-no-time

**Files:**
- Modify: `src/domain/bot.ts` (add `SIDE_PROMPT`, `needsSide`, `promptSide`, `startedText`; update `save`; update `handleMessage` save branch)
- Test: `test/unit/domain/bot.test.ts`

**Interfaces:**
- Consumes: `SIDE_LABEL` (Task 1), `BotEnv.bot.sendSidePrompt` (Task 2), existing `createPending` shape, `PendingEnv`.
- Produces:
  - `needsSide(intent: Intent): boolean` — `intent.type === "eat" && intent.action === "start" && !intent.side`.
  - `promptSide(env: BotEnv & PendingEnv & LoggerEnv, ctx: EventContext, intent: Intent): Promise<void>` — creates a pending holding `intent` and calls `sendSidePrompt`.
  - `startedText(intent: Intent): string` — `"<Cap label> iniziata alle HH:MM"`, plus `" — seno <word>"` when `intent.side` is set.

- [ ] **Step 1: Repurpose the assumed-time test onto a no-side type, and add the new prompt/echo tests**

In `test/unit/domain/bot.test.ts`, change the existing test at lines 108-122 to use `nanna` (a sleep start still announces its assumed time and has no side):

```ts
	it("announces the assumed start time when a start has no explicit time", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		// "nanna" with no time → starts at the message arrival time (09:30)
		await handleMessage(msg("nanna"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Nanna iniziata alle 9:30");
		expect(mocks.bot.react).not.toHaveBeenCalled();
	});
```

Then add these three tests after it (inside `describe("[BOT] handleMessage", ...)`):

```ts
	it("asks for the side when a feed start has no side (no time)", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.stringContaining("seno"),
			"ps1",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("asks for the side when a feed start has a time but no side", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps2", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio poppata 9.15"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"ps2",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});

	it("echoes the side when a feed start gives a side but no time", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleMessage(msg("poppata dx"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.side).toBe("dx");
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toBe("Poppata iniziata alle 9:30 — seno destro");
		expect(mocks.bot.sendSidePrompt).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run test/unit/domain/bot.test.ts`
Expected: FAIL — `poppata` currently inserts instead of prompting; `poppata dx` reply lacks `— seno destro`.

- [ ] **Step 3: Add `SIDE_PROMPT`, `needsSide`, `startedText`, `promptSide`**

In `src/domain/bot.ts`, add `SIDE_PROMPT` beside the other copy constants (after `INTERNAL_ERROR`, line 59):

```ts
const SIDE_PROMPT = "Per quale seno? 🤱";
```

Add `needsSide` after `describeIntent` (after line 82):

```ts
/** A feed start that still needs its breast side chosen. */
const needsSide = (intent: Intent): boolean =>
	intent.type === "eat" && intent.action === "start" && !intent.side;
```

Replace the `cap` helper (line 165) and add `startedText` right after it:

```ts
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Poppata iniziata alle 09:15", plus "— seno destro" when a side is set. */
const startedText = (intent: Intent): string => {
	let text = `${cap(LABEL[intent.type])} iniziata alle ${hhmm(intent.at)}`;
	if (intent.side) text += ` — seno ${SIDE_LABEL[intent.side]}`;
	return text;
};
```

Add `promptSide` after the `createPending` function (after line 149):

```ts
const promptSide = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	intent: Intent,
): Promise<void> => {
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: SIDE_PROMPT,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (side) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendSidePrompt(ctx.chatId, SIDE_PROMPT, created.data.id);
};
```

- [ ] **Step 4: Use `startedText` in `save`**

In `src/domain/bot.ts`, in `save`, replace the no-explicit-time start branch (lines 189-195):

```ts
	// A start whose time we defaulted to "now": confirm the assumed time in words
	// (eat→"poppata", sleep→"nanna" are both feminine, so "iniziata" agrees).
	if (intent.action === "start" && !timeGiven) {
		await env.bot.sendMessage(ctx.chatId, startedText(intent));
		return;
	}
```

- [ ] **Step 5: Divert the save decision to the side prompt**

In `src/domain/bot.ts`, in `handleMessage`, replace the `case "save"` branch (lines 361-363):

```ts
			case "save":
				if (needsSide(decision.intent)) {
					await promptSide(env, ctx, decision.intent);
					return;
				}
				await save(env, ctx, decision.intent, timeGiven);
				return;
```

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS. Note the existing `"inizio poppata dx 9.15"` test (side given, time given) still reacts 👍 — unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: ask breast side on feed start; echo side on timeless start"
```

---

### Task 4: Handle the side buttons + chain confirmations into the side prompt

**Files:**
- Modify: `src/domain/bot.ts` (`handleCallback`, ~lines 215-263)
- Test: `test/unit/domain/bot.test.ts`

**Interfaces:**
- Consumes: `needsSide`, `promptSide`, `startedText`, `applyIntent`, `SIDE_LABEL`.
- Produces: `handleCallback` handling for verbs `dx`/`sx` (fill side + save) and a `conf`-branch divert when the confirmed intent still `needsSide`.

- [ ] **Step 1: Add failing callback tests**

In `test/unit/domain/bot.test.ts`, add inside `describe("[BOT] handleCallback", ...)` (after the stale test, before the closing `});` at line 249). These reuse the existing `cb` and `pending` helpers:

```ts
	const feedStartPending = (id: string): PendingConfirmation =>
		pending({
			id,
			rawText: "poppata",
			intent: {
				type: "eat",
				action: "start",
				at: new Date("2026-07-02T09:15:00+02:00"),
				source: "rules",
				confidence: 1,
			},
			warning: "Per quale seno? 🤱",
		});

	it("dx button fills the side, saves the feed, and confirms", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(feedStartPending("ps1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("dx:ps1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.side).toBe("dx");
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("seno destro");
		expect(text).toContain("✅");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("ps1");
		expect(mocks.bot.answerCallback).toHaveBeenCalled();
	});

	it("confirming a sideless feed start asks for the side instead of saving", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(feedStartPending("p1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps2", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"ps2",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("p1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "button fills the side"`
Expected: FAIL — `dx:` verb is currently treated as `conf` fallthrough (no side set / wrong behavior).

- [ ] **Step 3: Restructure `handleCallback`**

In `src/domain/bot.ts`, replace the block from the `ann` branch through the end of the confirm logic (lines 238-262) with:

```ts
		if (verb === "ann") {
			await env.pendingRepository.delete(p.id);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.bot.answerCallback(cb.id, "Annullato");
			return;
		}

		const ctx: EventContext = {
			chatId: p.chatId,
			userId: p.userId,
			userName: p.userName,
			messageId: p.messageId,
			rawText: p.rawText,
		};

		// Side buttons: fill the missing breast, then save the feed start.
		if (verb === "dx" || verb === "sx") {
			const intent: Intent = { ...p.intent, side: verb };
			const applied = await applyIntent(intent, ctx)(env);
			if (!applied.success) {
				env.logger.error("applyIntent (side) failed", applied.error);
				await env.bot.answerCallback(cb.id, "Errore");
				return;
			}
			await env.bot.sendMessage(ctx.chatId, `${startedText(intent)} ✅`);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

		// verb === "conf": a confirmed feed start still missing its side asks for it.
		if (needsSide(p.intent)) {
			await promptSide(env, ctx, p.intent);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}

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
```

Note: `verb === "dx" || verb === "sx"` narrows `verb` to `"dx" | "sx"`, which is assignable to `Intent["side"]`.

- [ ] **Step 4: Run the suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. Existing confirm/annulla/end/stale callback tests still pass (their intents are not sideless feed starts).

- [ ] **Step 5: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: handle side buttons and chain confirmations into side prompt"
```

---

### Task 5: Dev harness side inputs + docs

**Files:**
- Modify: `src/dev.ts` (button-sim branch ~lines 107-122; startup hint ~line 143)
- Modify: `README.md` (local-dev command list)
- Modify: `src/domain/commands.ts` (`/help` copy, ~line 26)

**Interfaces:**
- Consumes: `handleCallback` verbs `dx`/`sx` (Task 4).

- [ ] **Step 1: Accept `sx`/`dx` in the dev harness and fix the pending-id clobber**

In `src/dev.ts`, replace the button-sim branch (lines 107-122):

```ts
	if (["conf", "ann", "dx", "sx"].includes(trimmed)) {
		const pendingId = state.lastPendingId;
		if (!pendingId) {
			console.log("   (nessuna conferma in sospeso)");
			return;
		}
		await handleCallback({
			id: "cb",
			chatId: DEV_CHAT_ID,
			userId: DEV_USER_ID,
			userName: "papà",
			data: `${trimmed}:${pendingId}`,
			messageId: state.lastConfirmationMessageId ?? 0,
		})(env);
		// A callback may open a NEW prompt (e.g. conf → side prompt), which the
		// console adapter records in state.lastPendingId. Only clear when unchanged.
		if (state.lastPendingId === pendingId) state.lastPendingId = undefined;
		return;
	}
```

- [ ] **Step 2: Update the dev startup hint**

In `src/dev.ts`, replace the startup `console.log` (lines 142-144):

```ts
console.log(
	'poppata-bot dev:local — scrivi messaggi (es. "inizio poppata dx 9.15"), /comandi, o conf/ann/sx/dx. Ctrl+D per uscire.',
);
```

- [ ] **Step 3: Manually verify the side-prompt flow locally**

Run:

```bash
printf 'poppata\ndx\n' | npm run dev:local
```

Expected output contains the side prompt (`🤱 ... [Sinistro] [Destro]`) followed, after `dx`, by a confirmation line containing `seno destro ✅`. Also verify the confirm-chain:

```bash
printf 'nanna\npoppata\nconf\nsx\n' | npm run dev:local
```

Expected: `poppata` while a nanna is open → a `[Conferma][Annulla]` prompt; `conf` → a `[Sinistro][Destro]` side prompt; `sx` → confirmation containing `seno sinistro ✅`.

- [ ] **Step 4: Update the README dev command list**

In `README.md`, in the `npm run dev:local` fenced example block, replace the two confirmation-button lines:

```
conf                       # → press the last [Conferma] button
ann                        # → press the last [Annulla] button
sx / dx                    # → tap the [Sinistro] / [Destro] side button
```

- [ ] **Step 5: Update the `/help` copy**

In `src/domain/commands.ts`, replace the feed example line (line 26):

```ts
	'• "inizio poppata dx 9.15" — inizio poppata (dx/sx, o destro/sinistro; se manca te lo chiedo) alle 9:15',
```

- [ ] **Step 6: Verify build, lint, and full check**

Run: `npm run check`
Expected: lint clean, typecheck clean, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dev.ts README.md src/domain/commands.ts
git commit -m "docs: dev harness side inputs + help copy for side prompt"
```

---

## Self-Review

**Spec coverage:**
- Req 2 input aliases → Task 1 (regex). ✓
- Req 2 output display → Task 1 (`SIDE_LABEL` + `describeIntent`), Task 3/4 (`startedText`, side-tap confirmation). ✓
- Req 1 ask on every feed start → Task 3 (message save path), Task 4 (`conf` divert covers open-session + low-confidence chains). ✓
- Side buttons rendering → Task 2 (telegraf/console). ✓
- Side-tap save + confirmation copy → Task 4. ✓
- #3 echo side on typed-no-time → Task 3 (`startedText` in `save`). ✓
- Reports untouched → confirmed (no task edits `report.ts`). ✓
- Dev harness + docs → Task 5. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `needsSide`, `promptSide`, `startedText`, `SIDE_LABEL`, `SIDE_PROMPT`, `sendSidePrompt` names are used identically across Tasks 1-5. `verb === "dx" | "sx"` narrows to `Intent["side"]`. `promptSide` env type `BotEnv & PendingEnv & LoggerEnv` is satisfied by both `handleMessage` and `handleCallback` env unions.
