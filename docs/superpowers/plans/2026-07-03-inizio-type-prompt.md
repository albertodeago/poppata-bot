# Inizio Type Prompt (Poppata / Nanna) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a message is a start with no recognizable type (`inizio`, `inizio 9.15`, `comincia`, `start`), ask "Poppata o nanna?" with two inline buttons; Nanna saves a sleep start, Poppata chains into the existing side prompt.

**Architecture:** Reuse the existing pending-confirmation + inline-button mechanism. A new `sendTypePrompt` port renders `[Poppata] [Nanna]` buttons carrying verbs `eat:` / `sleep:`. `handleMessage` diverts a typeless start (rules verdict, before the Gemini fallback) to a new `promptType` helper that stores a pending with a placeholder `type` the button verb overwrites. `handleCallback` gains an `eat`/`sleep` branch: `eat` → `promptSide` (existing), `sleep` → `applyIntent` (existing).

**Tech Stack:** TypeScript (ESM, Node ≥ 24), hexagonal ports/adapters, `Result<T,E>`, telegraf, Vitest, Biome.

## Global Constraints

- **Copy (verbatim):** type prompt text = `Poppata o nanna? 🍼`; button labels = `Poppata` and `Nanna` (no emoji on buttons).
- **Callback verbs:** `eat` for Poppata, `sleep` for Nanna (the `EventType` values), format `verb:pendingId` (split on `:`), matching the existing `dx`/`sx` convention.
- **Skip Gemini** for the type prompt — it fires from the rules verdict only.
- **Trigger:** rules yield `action === "start"` and no `type`. Any given time is preserved.
- **No schema/migration/`parse.ts` change.** The button path does not run `decide()` (matches the `dx`/`sx` precedent).
- **Gate:** `npm run check` (Biome + `tsc --noEmit` + Vitest) must pass before every commit.
- Storage stays canonical (`EventType` `eat|sleep|pee|poop`); the placeholder `type` in the type-prompt pending is never persisted — the verb overwrites it.

---

### Task 1: `sendTypePrompt` port + telegraf/console adapters + test mock

Add the new bot port across the interface and all three implementers so the project typechecks, and render the buttons in telegraf.

**Files:**
- Modify: `src/domain/bot.ts` (the `BotEnv.bot` interface, ~lines 18-35)
- Modify: `src/adapters/telegraf/bot.ts` (~after the `sendSidePrompt` impl, lines 50-61)
- Modify: `src/adapters/console/bot.ts` (~after the `sendSidePrompt` impl, lines 31-38)
- Modify: `test/unit/testEnv.ts` (the `bot` mock, ~lines 25-32)
- Test: `test/unit/adapters/telegraf/bot.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `BotEnv.bot.sendTypePrompt(chatId: number, text: string, pendingId: string): Promise<void>`. Telegraf renders `[{text:"Poppata", callback_data:`eat:${id}`},{text:"Nanna", callback_data:`sleep:${id}`}]`. The `testEnv` mock exposes `mocks.bot.sendTypePrompt` as a `vi.fn`.

- [ ] **Step 1: Write the failing telegraf test**

Add to `test/unit/adapters/telegraf/bot.test.ts` after the `sendSidePrompt` test (after line 79):

```ts
	it("sendTypePrompt builds eat:/sleep: inline buttons", async () => {
		const { Ctor, telegram } = makeFake();
		const { botEnv } = makeTelegrafAdapter(Ctor)({ config, logger });
		await botEnv.bot.sendTypePrompt(1, "Poppata o nanna? 🍼", "p1");
		expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Poppata o nanna? 🍼", {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Poppata", callback_data: "eat:p1" },
						{ text: "Nanna", callback_data: "sleep:p1" },
					],
				],
			},
		});
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/adapters/telegraf/bot.test.ts -t "sendTypePrompt"`
Expected: FAIL — `botEnv.bot.sendTypePrompt is not a function` (method not implemented yet).

- [ ] **Step 3: Add `sendTypePrompt` to the `BotEnv` interface**

In `src/domain/bot.ts`, inside `BotEnv.bot` add the method right after `sendSidePrompt` (after line 31):

```ts
		sendTypePrompt(
			chatId: number,
			text: string,
			pendingId: string,
		): Promise<void>;
```

- [ ] **Step 4: Implement it in the telegraf adapter**

In `src/adapters/telegraf/bot.ts`, add after the `sendSidePrompt` implementation (after line 61):

```ts
				sendTypePrompt: async (chatId, text, pendingId) => {
					await bot.telegram.sendMessage(chatId, text, {
						reply_markup: {
							inline_keyboard: [
								[
									{ text: "Poppata", callback_data: `eat:${pendingId}` },
									{ text: "Nanna", callback_data: `sleep:${pendingId}` },
								],
							],
						},
					});
				},
```

- [ ] **Step 5: Implement it in the console adapter**

In `src/adapters/console/bot.ts`, add after the `sendSidePrompt` implementation (after line 38):

```ts
				sendTypePrompt: async (chatId, text, pendingId) => {
					const mid = ++msgSeq;
					state.lastPendingId = pendingId;
					state.lastConfirmationMessageId = mid;
					console.log(
						`\n🍼  [${chatId}] ${text}\n   [Poppata] [Nanna]   (pending ${pendingId}, msg ${mid})\n   → scrivi "eat" o "sleep"`,
					);
				},
```

- [ ] **Step 6: Add the method to the test mock**

In `test/unit/testEnv.ts`, add to the `bot` object after `sendSidePrompt` (after line 29):

```ts
			sendTypePrompt: vi.fn<BotEnv["bot"]["sendTypePrompt"]>(),
```

- [ ] **Step 7: Run the full gate**

Run: `npm run check`
Expected: PASS — Biome clean, `tsc --noEmit` clean (all implementers satisfy the new port), all Vitest suites green including the new telegraf test.

- [ ] **Step 8: Commit**

```bash
git add src/domain/bot.ts src/adapters/telegraf/bot.ts src/adapters/console/bot.ts test/unit/testEnv.ts test/unit/adapters/telegraf/bot.test.ts
git commit -m "feat: add sendTypePrompt port + telegraf/console adapters"
```

---

### Task 2: Domain logic — prompt a typeless start, handle the type buttons

Divert a typeless start to the type prompt, and handle the `eat`/`sleep` taps (chain to side / save sleep).

**Files:**
- Modify: `src/domain/bot.ts` (add `TYPE_PROMPT` const near `SIDE_PROMPT` line 68; add `promptType` helper near `promptSide` after line 194; hook in `handleMessage` after line 353; add branch in `handleCallback` after line 316)
- Test: `test/unit/domain/bot.test.ts`

**Interfaces:**
- Consumes: `BotEnv.bot.sendTypePrompt` (Task 1); existing `promptSide(env, ctx, intent, now)`, `applyIntent(intent, ctx)(env)`, `needsSide(intent)`, `startedText(intent)`, `EventContext`, `Intent`, `INTERNAL_ERROR`, `resolveClock`, `romeNow`.
- Produces: behavior only — a typeless start emits `sendTypePrompt`; `eat:`/`sleep:` callbacks resolve it. No new exported symbols.

- [ ] **Step 1: Write the failing handleMessage tests**

In `test/unit/domain/bot.test.ts`, add inside the `describe("[BOT] handleMessage", …)` block (e.g. after the existing side-prompt tests, before its closing `});` at line 335):

```ts
	it("asks poppata vs nanna for a typeless start", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pt1", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio"))(env);

		expect(mocks.bot.sendTypePrompt).toHaveBeenCalledWith(
			1,
			"Poppata o nanna? 🍼",
			"pt1",
		);
		expect(mocks.parser.parse).not.toHaveBeenCalled();
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});

	it("preserves a given time into the type prompt intent", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pt2", createdAt: new Date() }),
		);

		await handleMessage(msg("inizio 9.15"))(env);

		const created = mocks.pendingRepository.create.mock.calls[0]?.[0];
		expect(created?.intent.at).toEqual(new Date("2026-07-02T09:15:00+02:00"));
		expect(created?.intent.action).toBe("start");
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "typeless start"`
Expected: FAIL — `sendTypePrompt` never called (message currently falls through to the Gemini/help path); `pendingRepository.create` not called.

- [ ] **Step 3: Add the `TYPE_PROMPT` constant**

In `src/domain/bot.ts`, add right after `const SIDE_PROMPT = "Per quale seno? 🤱";` (line 68):

```ts
const TYPE_PROMPT = "Poppata o nanna? 🍼";
```

- [ ] **Step 4: Add the `promptType` helper**

In `src/domain/bot.ts`, add after the `promptSide` helper (after line 194):

```ts
const promptType = async (
	env: BotEnv & PendingEnv & LoggerEnv,
	ctx: EventContext,
	at: Date,
): Promise<void> => {
	// The stored `type` is a placeholder; the button verb (eat/sleep) in
	// handleCallback sets the real one. confidence:1 — the user picks explicitly.
	const intent: Intent = {
		type: "sleep",
		action: "start",
		at,
		source: "rules",
		confidence: 1,
	};
	const created = await env.pendingRepository.create({
		chatId: ctx.chatId,
		userId: ctx.userId,
		userName: ctx.userName,
		rawText: ctx.rawText,
		intent,
		warning: TYPE_PROMPT,
		messageId: ctx.messageId,
	});
	if (!created.success) {
		env.logger.error("create pending (type) failed", created.error);
		await env.bot.sendMessage(ctx.chatId, INTERNAL_ERROR);
		return;
	}
	await env.bot.sendTypePrompt(ctx.chatId, TYPE_PROMPT, created.data.id);
};
```

- [ ] **Step 5: Hook the type prompt into `handleMessage`**

In `src/domain/bot.ts`, insert right after `let source: EventSource = "rules";` (line 353) and before `if (confidence === 0) {`:

```ts
		// A start with no type ("inizio", "comincia 9.15"): ask poppata vs nanna
		// with buttons instead of guessing. Deterministic — skips the Gemini fallback.
		if (action === "start" && !type) {
			const at =
				hasTime && hour !== undefined
					? resolveClock(arrival, hour, minute).toJSDate()
					: arrival.toJSDate();
			const typeCtx: EventContext = {
				chatId: msg.chatId,
				userId: msg.userId,
				userName: msg.userName,
				messageId: msg.messageId,
				rawText: msg.text,
			};
			await promptType(env, typeCtx, at);
			return;
		}
```

- [ ] **Step 6: Run the handleMessage tests to verify they pass**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "typeless start"`
Expected: PASS — both `asks poppata vs nanna` and `preserves a given time` green.

- [ ] **Step 7: Write the failing handleCallback tests**

In `test/unit/domain/bot.test.ts`, add inside the `describe("[BOT] handleCallback", …)` block (after the `dx button …` test, before the block's closing `});` at line 502). First add a pending factory near `feedStartPending` (after line 455):

```ts
	const typePromptPending = (id: string): PendingConfirmation =>
		pending({
			id,
			rawText: "inizio",
			intent: {
				type: "sleep", // placeholder — the verb overwrites it
				action: "start",
				at: new Date("2026-07-02T09:15:00+02:00"),
				source: "rules",
				confidence: 1,
			},
			warning: "Poppata o nanna? 🍼",
		});
```

Then the two tests:

```ts
	it("nanna button saves a sleep start and confirms", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("sleep:pt1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.type).toBe("sleep");
		const text = mocks.bot.sendMessage.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("Nanna iniziata");
		expect(text).toContain("✅");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
		expect(mocks.bot.sendSidePrompt).not.toHaveBeenCalled();
	});

	it("poppata button chains into the side prompt", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "ps9", createdAt: new Date() }),
		);
		mocks.eventRepository.findLastFeed.mockResolvedValue(success(null));

		await handleCallback(cb("eat:pt1"))(env);

		expect(mocks.bot.sendSidePrompt).toHaveBeenCalledWith(
			1,
			expect.any(String),
			"ps9",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});
```

- [ ] **Step 8: Run the callback tests to verify they fail**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "button"`
Expected: FAIL — `sleep:`/`eat:` fall through to the `conf` path; no insert / no side prompt as asserted.

- [ ] **Step 9: Add the `eat`/`sleep` branch to `handleCallback`**

In `src/domain/bot.ts`, insert after the side-button branch's closing (after line 316, the `}` that ends the `if (verb === "dx" || verb === "sx")` block) and before the `// verb === "conf"` comment (line 318):

```ts
		// Type buttons: the verb is authoritative (the stored placeholder type is
		// ignored). eat → chain to the side prompt; sleep → save directly.
		if (verb === "eat" || verb === "sleep") {
			const intent: Intent = { ...p.intent, type: verb };
			if (needsSide(intent)) {
				await promptSide(env, ctx, intent, cb.at);
				await env.bot.clearKeyboard(cb.chatId, cb.messageId);
				await env.pendingRepository.delete(p.id);
				await env.bot.answerCallback(cb.id);
				return;
			}
			const applied = await applyIntent(intent, ctx)(env);
			if (!applied.success) {
				env.logger.error("applyIntent (type) failed", applied.error);
				await env.bot.answerCallback(cb.id, "Errore");
				return;
			}
			await env.bot.sendMessage(ctx.chatId, `${startedText(intent)} ✅`);
			await env.bot.clearKeyboard(cb.chatId, cb.messageId);
			await env.pendingRepository.delete(p.id);
			await env.bot.answerCallback(cb.id);
			return;
		}
```

- [ ] **Step 10: Run the callback tests to verify they pass**

Run: `npx vitest run test/unit/domain/bot.test.ts -t "button"`
Expected: PASS — both `nanna button …` and `poppata button …` green (existing `dx button` test still passes too).

- [ ] **Step 11: Run the full gate**

Run: `npm run check`
Expected: PASS — Biome clean, `tsc` clean, all suites green.

- [ ] **Step 12: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: ask poppata vs nanna for a typeless 'inizio'"
```

---

### Task 3: Dev harness + docs

Let `dev:local` simulate the type buttons, and document the new flow.

**Files:**
- Modify: `src/dev.ts` (the tap-intercept list line 111; the intro `console.log` lines 150-152)
- Modify: `README.md` (the dev command list, ~lines 66-78)
- Modify: `src/domain/commands.ts` (`HELP_TEXT`, ~lines 25-40)

**Interfaces:**
- Consumes: the `eat`/`sleep` callback verbs (Task 2) and the console `sendTypePrompt` (Task 1).
- Produces: none (harness + docs).

- [ ] **Step 1: Accept `eat`/`sleep` as button-sim inputs**

In `src/dev.ts`, change line 111:

```ts
	if (["conf", "ann", "dx", "sx"].includes(trimmed)) {
```

to:

```ts
	if (["conf", "ann", "dx", "sx", "eat", "sleep"].includes(trimmed)) {
```

- [ ] **Step 2: Mention the type buttons in the dev intro line**

In `src/dev.ts`, replace the intro `console.log` (lines 150-152):

```ts
console.log(
	'poppata-bot dev:local — scrivi messaggi (es. "inizio poppata dx 9.15"), /comandi, o conf/ann/sx/dx. Ctrl+D per uscire.',
);
```

with:

```ts
console.log(
	'poppata-bot dev:local — scrivi messaggi (es. "inizio poppata dx 9.15"), /comandi, o conf/ann/sx/dx/eat/sleep. Ctrl+D per uscire.',
);
```

- [ ] **Step 3: Verify the flow manually in the harness**

Run: `npm run dev:local`
Then type, one line at a time:

```
inizio
```
Expected: prints `🍼  [1] Poppata o nanna? 🍼` with `[Poppata] [Nanna]` and `→ scrivi "eat" o "sleep"`.

```
sleep
```
Expected: `💬 [1] Nanna iniziata alle HH:MM ✅` and `(tastiera rimossa …)`.

Then:

```
inizio
eat
```
Expected: after `eat`, prints the side prompt `🤱 … Per quale seno?` with `[Sinistro] [Destro]`. Then:

```
dx
```
Expected: `Poppata iniziata alle HH:MM — seno destro ✅`.

Press Ctrl+D to exit.

- [ ] **Step 4: Add the dev commands to the README**

In `README.md`, in the dev message list (the fenced block around lines 66-78), add after the `sx / dx` line (line 73):

```
eat / sleep                # → tap the [Poppata] / [Nanna] type button
```

- [ ] **Step 5: Add a `/help` line for the bare `inizio`**

In `src/domain/commands.ts`, in `HELP_TEXT`, add a bullet right after the `"nanna 10" / "fine 10.15"` line (line 29):

```ts
	'• "inizio" — se non dico cosa, mi chiedi se poppata o nanna',
```

- [ ] **Step 6: Run the full gate**

Run: `npm run check`
Expected: PASS — Biome clean, `tsc` clean, all suites green (no test changes, but the harness/docs edits must not break the build or any snapshot of `HELP_TEXT`; if a test asserts on `HELP_TEXT`, update it to include the new line).

- [ ] **Step 7: Commit**

```bash
git add src/dev.ts README.md src/domain/commands.ts
git commit -m "docs: dev harness + help copy for the inizio type prompt"
```

---

## Self-Review

**Spec coverage:**
- Trigger (any start, no type; time preserved) → Task 2 Steps 5-6 + the two handleMessage tests. ✓
- Skip Gemini → asserted (`parser.parse not called`) in Task 2 Step 1. ✓
- Nanna → save sleep; Poppata → chain to side prompt → Task 2 Steps 9-10 + callback tests. ✓
- Placeholder-type mechanism → `promptType` (Task 2 Step 4) + verb-authoritative branch (Step 9). ✓
- `sendTypePrompt` port + telegraf/console + mock → Task 1. ✓
- Copy `Poppata o nanna? 🍼` / `Poppata` / `Nanna` → Task 1 (telegraf) + Task 2 (`TYPE_PROMPT`). ✓
- Dev harness quirk + README + `/help` → Task 3. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps — every code step shows full code. ✓

**Type consistency:** `sendTypePrompt(chatId, text, pendingId): Promise<void>` identical across interface/telegraf/console/mock/tests. Verbs `eat`/`sleep` identical across telegraf render, dev list, callback branch, tests. `TYPE_PROMPT = "Poppata o nanna? 🍼"` identical in `promptType`, telegraf test, handleMessage test. `promptType(env, ctx, at)` signature matches its one call site. `{ ...p.intent, type: verb }` type-narrows `verb` to `"eat" | "sleep"` (⊂ `EventType`) inside the guard. ✓
