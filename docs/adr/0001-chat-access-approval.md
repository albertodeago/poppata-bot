# 0001 — Chat access by admin approval

Status: Accepted (2026-07-11)

## Context

Access was granted by self-registration up to a hardcoded cap (`MAX_CHATS`, default
5): adding the bot or `/start` auto-activated a chat until the count was reached,
after which the user got a prefilled **GitHub issue link** to request more. Two
problems:

1. Requesting access required a GitHub account — a wall for non-technical users
   (the bot's audience is parents/family).
2. The cap and the GitHub round-trip were clumsy; there was no in-band way for the
   owner to grant access, and no notion of a rejected/banned chat.

## Decision

Replace the count-cap + GitHub flow with **admin approval, entirely inside Telegram**.

- **Access status** on `chat_configs`: `pending | approved | banned` (see
  [CONTEXT.md](../../CONTEXT.md)). The serving gate becomes *row exists AND status =
  approved*; `pending`/`banned` input is dropped.
- **Requesting is implicit.** The existing entry points (`/start`, bot added via
  `my_chat_member`) create a `pending` row and notify the admin — no new command.
- **The admin is a single Telegram chat** (`ADMIN_CHAT_ID`, required config). It
  always bypasses the gate. Requests arrive there with `chatId`, `@username`
  (persisted, nullable), and chat title.
- **Approve/ban = one tap** via inline buttons on the request, with
  `/approva <chatId>` / `/banna <chatId>` as a durable fallback.
- **Ban is silent** to the banned chat and does not re-notify the admin on repeat
  `/start`. Repeat offenders returning under a new chat are spotted by eye from the
  `@username` on the fresh `pending` request.
- **A pending chat's repeat `/start` re-notifies the admin**, so a notification that
  failed to send the first time self-heals on the next attempt.
- The report cron serves only `approved` chats.

### Authorization

Approve/ban is authorized by **chat location** (`chatId === ADMIN_CHAT_ID`), not by
*who* clicked. If `ADMIN_CHAT_ID` is a group, **every member can approve/ban** — the
admin chat is the trust boundary. This was a deliberate choice to avoid a second env
var (`ADMIN_USER_ID`); the requirement is that the admin chat stays private to people
trusted with that power.

## Consequences

- Removed: `MAX_CHATS`, `count()`, `repoIssuesUrl` / `describeIssueLink` / the
  "bot is full" message, and the GitHub round-trip.
- Added: `ADMIN_CHAT_ID` (required — a fresh deploy can't start without it),
  `status` + `username` columns, admin-notification send, and approve/ban handlers.
- Existing rows migrate to `approved` — no current chat is disrupted.
- Every new chat now waits for a manual tap, including the owner's own new groups
  (deliberately not auto-approved — see Alternatives).

## Alternatives considered

- **Email notifications** instead of a Telegram admin chat — rejected: adds an
  SMTP/API dependency and a new failure mode, and can't do one-tap approval. The
  bot already speaks Telegram.
- **Separate `access_requests` table** instead of a `status` column — rejected:
  more moving parts, nothing gained for a single-admin bot.
- **Dedicated `/richiedi` command** — rejected: it's a synonym for `/start`; more
  to document, and users already reach for `/start`.
- **Auto-approve chats the admin adds** (`ADMIN_USER_ID`) — rejected: costs an
  extra env var and branching to save a handful of taps; owner approves manually.
- **Auto-flag new requests whose `@username` matches a banned row** — deferred:
  useless when the user has no username; add only if repeat offenders appear.
