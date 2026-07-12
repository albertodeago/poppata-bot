# Context

Domain glossary for poppata-bot. Terms meaningful to how the bot behaves — not
implementation detail. Keep entries short; link decisions to ADRs where relevant.

## Glossary

### Chat

A Telegram conversation where the bot lives — either a private DM or a group.
Identified by its Telegram `chatId`. One `chat_configs` row per chat.

### Admin

The single bot owner. Identified by `ADMIN_CHAT_ID` — the Telegram chat where the
bot sends access-request notifications and where the owner approves/bans. Approval
is one-tap inline buttons on each request, with `/approva <chatId>` and
`/banna <chatId>` as a durable fallback.

Authorization is by **chat location**: approve/ban is honoured from `ADMIN_CHAT_ID`
and nowhere else. It does not check *who* clicked, so **everyone in the admin chat
can approve/ban** — keep that chat private to people you trust with that power (if
it's a group, treat every member as a co-admin).

### Access request

The act of a chat asking for access. Implicit — there is no dedicated command. It
is created when a chat first hits an entry point (`/start`, or the bot being added
via `my_chat_member`), which creates a `pending` row and notifies the admin.
Re-hitting `/start` while already `pending` re-notifies the admin — this self-heals
a notification that failed to send the first time.

Repeat-offender detection is by eye: every request notification carries the
`chatId`, `@handle` (when the user has one — usernames are optional), and chat
title. A banned person returning under a new chat surfaces as a fresh `pending`
request with the same handle. Banning is per-`chatId`; a DM's chatId is stable
(= the user's id), so a DM ban sticks. The requester's `@username` is persisted on
the row (nullable) so bans can be eyeballed later. See [ADR 0001](docs/adr/0001-chat-access-approval.md).

### Access status

The lifecycle state of a chat's access to the bot. Stored as `status` on the
chat's config row. One of:

- **pending** — the chat has requested access and is waiting for the admin. The
  bot stays silent (drops all input except the entry/request path).
- **approved** — the admin has granted access; the bot works fully. This is what
  "the bot is active in this chat" means.
- **banned** — the admin rejected the chat. Input is dropped, and a re-request is
  recognised as a banned chat rather than a fresh one.

The serving gate is: **row exists AND status = approved**. Everything else is
dropped.

> Note: distinct from **reports enabled** (`reportsEnabled`), which only toggles
> the scheduled cron report and has nothing to do with access. "Enabled" always
> refers to reports; access uses "approved".
