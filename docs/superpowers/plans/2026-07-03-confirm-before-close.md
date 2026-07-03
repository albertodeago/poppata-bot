# Confirm Before Close (All Paths) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a start never silently close an open session — every entry path (button `inizio` flow, side taps, low-confidence Gemini confirms) asks before closing, matching the existing high-confidence text path.

**Architecture:** Reuse the existing `decide()` + pending-confirmation machinery. Gate the button type-tap through `decide` so a start over an open session produces a `[Conferma]/[Annulla]` prompt instead of a silent `applyIntent` close; augment the low-confidence confirm message with the close notice; and make `feedbackFor` reply with a text line for confirmed starts. `applyIntent` (the single writer) and `decide` are unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Biome. All production changes are in `src/domain/bot.ts`; all test changes in `test/unit/domain/bot.test.ts`.

## Global Constraints

- All production code changes live in `src/domain/bot.ts`. No changes to `session.ts` (`decide`), `applyIntent`'s body, adapters, dev harness, schema, or `parse.ts`.
- Callback verbs are unchanged: `eat` / `sleep` / `dx` / `sx` / `conf` / `ann`.
- Copy is Italian and exact. Confirm reply for a start: `` `${startedText(intent)} ✅` `` (e.g. `Nanna iniziata alle 9:15 ✅`). `hhmm` renders no leading zero on the hour (`9:15`, not `09:15`).
- `feedbackFor` outcome by action: `end` → duration reply; `start` → `startedText ✅` text line; `instant` → 👍 reaction.
- `decide` returns `confirm` for any start over an open session (regardless of type match) and `save` when nothing is open; it returns `error` only for `end` intents (unreachable from the type-tap branch).
- Commands after each task: `npm run test` (Vitest). Final gate: `npm run check` (Biome fix + `tsc --noEmit` + Vitest).

---

### Task 1: `feedbackFor` — text line for a confirmed start

Confirmed starts currently fall through to a 👍 reaction. Reply with the same `startedText ✅` line the non-collision button flow uses. This is the reply for every confirmed close, so it lands first (Task 2's end-to-end test depends on it).

**Files:**
- Modify: `src/domain/bot.ts` (`feedbackFor`, currently `:289-303`)
- Test: `test/unit/domain/bot.test.ts` (inside the `describe("[BOT] handleCallback")` block)

**Interfaces:**
- Consumes: `startedText(intent: Intent): string` (`bot.ts:254`), `env.bot.sendMessage(chatId, text)`.
- Produces: no new exports. Behavior change only.

- [ ] **Step 1: Write the failing test**

Insert inside the `describe("[BOT] handleCallback", ...)` block (e.g. after the `"confirm applies the intent…"` test at `:398-417`):

```ts
	it("confirming a sleep start replies with the started-text line", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(
				pending({
					rawText: "nanna",
					intent: {
						type: "sleep",
						action: "start",
						at: new Date("2026-07-02T09:15:00+02:00"),
						source: "gemini",
						confidence: 0.4,
					},
					warning: "Ho capito: nanna inizio 9:15. Confermi?",
				}),
			),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.type).toBe("sleep");
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nanna iniziata alle 9:15 ✅",
		);
		expect(mocks.bot.react).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- bot.test.ts -t "confirming a sleep start replies"`
Expected: FAIL — `sendMessage` not called with that text; `react` was called with `(1, 100, "👍")` instead.

- [ ] **Step 3: Add the `start` branch to `feedbackFor`**

Replace `feedbackFor` (`bot.ts:289-303`):

```ts
const feedbackFor = async (
	env: BotEnv,
	p: PendingConfirmation,
	closed: BabyEvent | undefined,
): Promise<void> => {
	if (p.intent.action === "end" && closed?.endedAt) {
		await sendDurationReply(env, p.chatId, {
			...closed,
			endedAt: closed.endedAt,
		});
		return;
	}
	if (p.intent.action === "start") {
		await env.bot.sendMessage(p.chatId, `${startedText(p.intent)} ✅`);
		return;
	}
	// react on the ORIGINAL user message (instant events)
	await env.bot.react(p.chatId, p.messageId, "👍");
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- bot.test.ts`
Expected: PASS — the new test passes and every existing `handleCallback` test still passes (the `conf` of a poop *instant* at `:398` still reacts 👍; the `end` confirm at `:419` still replies with the duration; the sideless-feed `conf` at `:542` still diverts to the side prompt before reaching `feedbackFor`).

- [ ] **Step 5: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: reply with started-text line on a confirmed start"
```

---

### Task 2: Gate the button type-tap through `decide`

The `eat`/`sleep` type branch commits via `applyIntent`, which silently closes any open session. Read the open session and run `decide` first: a start over an open session creates a `[Conferma]/[Annulla]` pending; over nothing it behaves exactly as today (eat → side prompt, sleep → save).

**Files:**
- Modify: `src/domain/bot.ts` (`handleCallback` `eat`/`sleep` branch, currently `:368-390`)
- Test: `test/unit/domain/bot.test.ts` (inside `describe("[BOT] handleCallback")`; also update the existing `"poppata button chains into the side prompt"` test at `:588-609`)

**Interfaces:**
- Consumes: `decide(intent: Intent, open: BabyEvent | null): Decision` (`session.ts:14`, already imported at `bot.ts:16`); `createPending(env, ctx, intent, warning)` (`bot.ts:151`); `promptSide`, `applyIntent`, `needsSide`, `startedText` (all in `bot.ts`); `env.eventRepository.findOpenSession(chatId)`.
- Produces: no new exports. `Decision.kind` is `"save" | "confirm" | "error"`.

- [ ] **Step 1: Write the failing tests**

Insert these three tests inside `describe("[BOT] handleCallback", ...)`, after the existing `"poppata button chains into the side prompt"` test:

```ts
	it("nanna button asks to confirm when a session is already open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pc1", createdAt: new Date() }),
		);
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));

		await handleCallback(cb("sleep:pt1"))(env);

		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("aperta"),
			"pc1",
		);
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
		expect(mocks.bot.clearKeyboard).toHaveBeenCalledWith(1, 200);
	});

	it("poppata button asks to confirm when a session is already open", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(typePromptPending("pt1")),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "pc2", createdAt: new Date() }),
		);
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));

		await handleCallback(cb("eat:pt1"))(env);

		expect(mocks.bot.sendConfirmation).toHaveBeenCalledWith(
			1,
			expect.stringContaining("aperta"),
			"pc2",
		);
		expect(mocks.bot.sendSidePrompt).not.toHaveBeenCalled();
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
		expect(mocks.pendingRepository.delete).toHaveBeenCalledWith("pt1");
	});

	it("confirming the close ends the open session and starts the new one", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.pendingRepository.get.mockResolvedValue(
			success(
				pending({
					rawText: "inizio",
					intent: {
						type: "sleep",
						action: "start",
						at: new Date("2026-07-02T09:15:00+02:00"),
						source: "rules",
						confidence: 1,
					},
					warning:
						"C'è già una poppata aperta dalle 9:00. Chiuderla alle 9:15 e iniziare nanna?",
				}),
			),
		);
		mocks.pendingRepository.delete.mockResolvedValue(success(undefined));
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.eventRepository.closeSession.mockImplementation(async (_id, endedAt) =>
			success({ ...openEat, endedAt }),
		);
		mocks.eventRepository.insert.mockImplementation(async (e) =>
			success({ ...e, id: "e1", createdAt: new Date() }),
		);

		await handleCallback(cb("conf:p1"))(env);

		expect(mocks.eventRepository.closeSession).toHaveBeenCalledWith(
			"s1",
			new Date("2026-07-02T09:15:00+02:00"),
		);
		expect(mocks.eventRepository.insert).toHaveBeenCalledTimes(1);
		expect(mocks.eventRepository.insert.mock.calls[0]?.[0]?.type).toBe("sleep");
		expect(mocks.bot.sendMessage).toHaveBeenCalledWith(
			1,
			"Nanna iniziata alle 9:15 ✅",
		);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- bot.test.ts -t "already open"`
Expected: FAIL — the current branch calls `applyIntent`/`promptSide` instead of `sendConfirmation`, so `sendConfirmation` was not called and (for `sleep`) `insert` was called.

- [ ] **Step 3: Rewrite the `eat`/`sleep` branch to gate through `decide`**

Replace the block at `bot.ts:368-390`:

```ts
		// Type buttons: the verb is authoritative (the stored placeholder type is
		// ignored). Gate through decide so a start over an open session asks before
		// closing it (consistent with the text path); otherwise eat → side prompt,
		// sleep → save directly.
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
			// decision.kind === "save" (decide returns "error" only for end intents).
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

- [ ] **Step 4: Update the existing regression test that now reads `findOpenSession`**

The `"poppata button chains into the side prompt"` test (`:588`) does not mock `findOpenSession`; the branch now reads it. Add this line to that test, alongside the other `mocks.*` setup (e.g. right after the `mocks.pendingRepository.get...` line):

```ts
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(null));
```

(The `"nanna button saves a sleep start and confirms"` test at `:565` already mocks `findOpenSession` → `success(null)`, so it needs no change and serves as the sleep-over-nothing regression guard.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- bot.test.ts`
Expected: PASS — the three new tests pass; the updated `poppata button chains` test passes; all other `handleCallback` tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: confirm before the inizio button flow closes an open session"
```

---

### Task 3: Low-confidence confirm states the close

A low-confidence Gemini start confirms the *interpretation* (`Ho capito X. Confermi?`) then silently closes any open session on `conf`. Append the close notice to that message when a start would close an open session, so the single `Confermi?` covers both.

**Files:**
- Modify: `src/domain/bot.ts` (`handleMessage` low-confidence branch, currently `:518-526`)
- Test: `test/unit/domain/bot.test.ts` (inside `describe("[BOT] handleMessage")`)

**Interfaces:**
- Consumes: `open` (the `BabyEvent | null` fetched at `bot.ts:471-477`), `LABEL` (imported `:2`), `hhmm` (imported `:17`), `describeIntent` (`bot.ts:96`), `createPending`.
- Produces: no new exports. Message-content change only.

- [ ] **Step 1: Write the failing test**

Insert inside `describe("[BOT] handleMessage", ...)` (e.g. after the `"confirms-to-save a low-confidence Gemini parse"` test at `:176-195`):

```ts
	it("warns about closing an open session in a low-confidence confirm", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.eventRepository.findOpenSession.mockResolvedValue(success(openEat));
		mocks.parser.parse.mockResolvedValue(
			success({ type: "sleep", action: "start", confidence: 0.4 }),
		);
		mocks.pendingRepository.create.mockImplementation(async (p) =>
			success({ ...p, id: "p3", createdAt: new Date() }),
		);

		await handleMessage(msg("boh vediamo"))(env);

		const text = mocks.bot.sendConfirmation.mock.calls[0]?.[1] ?? "";
		expect(text).toContain("la chiudo");
		expect(mocks.eventRepository.insert).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- bot.test.ts -t "low-confidence confirm"`
Expected: FAIL — the message is `Ho capito: nanna inizio 9:30. Confermi?` with no `la chiudo`.

- [ ] **Step 3: Append the close notice**

Replace the low-confidence branch at `bot.ts:518-526`:

```ts
		if (confidence < CONFIDENCE_MIN) {
			const closeNote =
				intent.action === "start" && open
					? ` C'è già una ${LABEL[open.type]} aperta dalle ${hhmm(
							open.startedAt,
						)}, la chiudo alle ${hhmm(intent.at)}.`
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- bot.test.ts`
Expected: PASS — the new test passes; the existing `"confirms-to-save a low-confidence Gemini parse"` (instant, no open session) and `"shows the side as destro/sinistro in confirm copy"` (no open session) tests are unaffected, because `closeNote` is empty when there is no open session or the action is not a start.

- [ ] **Step 5: Commit**

```bash
git add src/domain/bot.ts test/unit/domain/bot.test.ts
git commit -m "feat: state the session close in a low-confidence confirm"
```

---

### Task 4: Full verification gate

**Files:**
- Verify only: `README.md` (no edit — line 44 already states *"starting while a session is open … asks for [Conferma] / [Annulla] before saving"*, which is now accurate for every path).

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: Biome reports no issues (or only auto-fixes formatting, which you then include in a commit), `tsc --noEmit` passes with no errors, and the full Vitest suite passes.

- [ ] **Step 2: Confirm the README needs no change**

Read `README.md:44`. Confirm it already documents "starting while a session is open … asks for [Conferma] / [Annulla]". No edit required. If Biome auto-formatted any file in Step 1, commit it:

```bash
git add -A
git commit -m "chore: biome formatting" || echo "nothing to format"
```

- [ ] **Step 3: Manual sanity check (optional, dev harness)**

Run: `npm run dev:local`, then in the console REPL:
```
inizio        # → [Poppata][Nanna]
nanna         # tap Nanna → "Nanna iniziata alle HH:MM ✅"
inizio        # → [Poppata][Nanna]
pappa         # tap Poppata → "C'è già una nanna aperta … e iniziare poppata? [Conferma][Annulla]"
conf          # → [Sinistro][Destro]
sx            # → "Poppata iniziata alle HH:MM — seno sinistro ✅" (the nanna is now closed)
```
Note: in `dev:local`, `sleep` is a tap token, so type the nap as `nanna` (as above).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-03-confirm-before-close-design.md`):
- Mechanism §1 (gate button type branch through `decide`) → Task 2. ✅
- Mechanism §2 (low-confidence close notice) → Task 3. ✅
- Mechanism §3 (`feedbackFor` text line) → Task 1. ✅
- Guarantee table (every close path confirmed): text path unchanged (existing); button sleep/eat over open → Task 2; low-confidence over open → Task 3; `dx`/`sx` inherit an already-confirmed close (no code change), guarded by the Task 2 end-to-end `conf` test. ✅
- Non-goals (no `decide`/`applyIntent`/adapter/schema/`parse.ts` changes) → honored; all edits are in `bot.ts`. ✅
- Docs → README line 44 already accurate (Task 4 Step 2). ✅

**Placeholder scan:** none — every code step shows full code and exact commands.

**Type consistency:** `decide` → `Decision` (`kind: "save" | "confirm" | "error"`); `decision.intent` used only in the `confirm` branch (defined on `save`/`confirm` variants). `startedText(intent)`, `needsSide(intent)`, `createPending(env, ctx, intent, warning)`, `applyIntent(intent, ctx)(env)` match their definitions in `bot.ts`. Test helpers `pending()`, `typePromptPending()`, `openEat`, `cb()`, `msg()` are used within the scopes where they are defined.
