# Enbox architecture

Enbox is a WhatsApp/WeChat-style messenger: 1:1 and group chats, communities, channels,
status updates (stories) and voice/video calls (1:1 and group).

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | npm workspaces: `packages/shared`, `apps/server`, `apps/web` |
| Language | TypeScript (strict, ESM) everywhere |
| Contracts | `@enbox/shared`: wire models, zod request schemas, REST route catalogue, Socket.IO event maps, pure helpers |
| Server | Node 22, Express 5, Socket.IO 4, Drizzle ORM |
| Database | PostgreSQL (production, `DATABASE_URL`) or embedded **PGlite** (zero-config dev when `DATABASE_URL` is unset; in-memory for tests) |
| Realtime scale-out | Optional Redis adapter for Socket.IO (`REDIS_URL`) |
| Media | Local disk (`UPLOAD_DIR`), served at `/uploads/<key>` with unguessable keys |
| Calls | WebRTC, full-mesh (≤ 8 participants), signaling over Socket.IO, STUN/TURN from env |
| Push | Web Push (VAPID) when keys are configured |
| Web client | React 19, Vite, Tailwind CSS 4, React Router 7, Zustand, socket.io-client; installable PWA |
| Mobile | The web client is mobile-first and PWA-installable; Capacitor can wrap it for store builds |
| Tests | Vitest (+ supertest/socket.io-client) for the server, Playwright for end-to-end |

## Repository layout

```
packages/shared/src/
  constants.ts   limits & tunables
  models.ts      wire models (JSON shapes returned by REST / emitted by sockets)
  schemas.ts     zod schemas for every request body/query and inbound socket payload
  api.ts         error envelope, response types, ApiRoutes catalogue (all endpoints)
  events.ts      ServerToClientEvents / ClientToServerEvents / rooms helper
  utils.ts       pure helpers (previews, tick status, names, durations...)
apps/server/
  drizzle/       generated SQL migrations (npm run db:generate)
  src/
    index.ts     process entry: config, db, http server, socket server, jobs
    app.ts       express app factory (used by tests too)
    config.ts    env parsing
    db/          schema.ts, types.ts, client (pg | pglite), migrate
    lib/         errors, validation, auth helpers, ids, logger
    realtime/    socket server, auth, room management, emit helpers, presence
    services/    cross-module domain primitives (serializers, membership, message creation)
    modules/<domain>/  routes.ts (+ service.ts, socket.ts) per domain
    jobs/        periodic jobs (disappearing messages, status expiry, call timeouts)
  test/          vitest integration tests
apps/web/src/
  lib/ api client, socket client, helpers     stores/ zustand stores
  realtime/ socket event -> store wiring      features/<domain>/ UI per domain
  components/ shared UI kit                   routes & app shell
```

## Server conventions

- **Modules** live in `src/modules/<domain>/` and export an Express `Router` from `routes.ts`
  (mounted under `/api` in `app.ts`) and optionally `registerSocketHandlers(io, socket)` from
  `socket.ts` (called for every authenticated socket).
- **Validation**: every body/query/params and socket payload is parsed with the zod schemas
  from `@enbox/shared`. Invalid input → `400 validation_error`.
- **Errors**: throw `HttpError(status, code, message)` (or helpers `notFound()`,
  `forbidden()`...). A central error handler renders `ApiErrorBody`. Socket handlers
  convert thrown errors into `{ ok: false, error }` acks.
- **Serialization**: DB rows are never returned directly. Use the serializers in
  `src/services/` (`toUserPublic(viewerId, ...)`, `toChatSummary(viewerId, chatId)`,
  `toMessages(viewerId, rows)`, ...). Serializers are viewer-aware (privacy, per-user prefs).
- **Realtime fan-out**: use the emit helpers in `src/realtime/emit.ts`
  (`emitToUser`, `emitToChat`, `joinUserToChat`, `removeUserFromChat`...). Never emit
  viewer-specific payloads (ChatSummary, UserPublic) to a chat room — emit per user.
- **Transactions**: multi-row mutations use `db.transaction`. Emit socket events only after
  the transaction commits.
- **Auth**: opaque random session tokens (`Authorization: Bearer`), stored as sha256 in
  `sessions`. Each session is a "linked device". Sockets authenticate with the same token.
- **Passwords**: `crypto.scrypt` with per-user salt (no native deps).

## Domain semantics

### Sequence numbers, receipts and unread counts
- Each message gets `seq = ++chats.last_seq` inside the sending transaction.
- `chat_members.last_delivered_seq` / `last_read_seq` are monotonic watermarks
  (`GREATEST(old, new)`, clamped to the chat's `last_seq`). Sending a message advances the
  sender's own read/delivered watermarks to that seq.
- Tick watermarks for a viewer = `min(last_read_seq)` / `min(last_delivered_seq)` over the
  *other* active members. Direct chats: read watermark is 0 when either side disabled read
  receipts (delivered still works). Channels: always 0.
- When a watermark changes, recompute per affected member and emit `chat:watermarks` to
  the senders whose ticks changed (in practice: all active members of the chat).
- `unreadCount` = visible messages with `seq > last_read_seq` not sent by the viewer
  (exclude system messages); `markedUnread` forces an unread badge.
- Message info (`GET /messages/:id/info`) is derived from watermarks and their timestamps.

### Visibility of messages for a member
A message is visible to member M when all hold:
`seq > M.joined_seq`, `seq > M.cleared_seq`, `M.left_seq is null or seq <= M.left_seq`,
not in `message_hidden` for M, and `expires_at is null or expires_at > now()`.

### Direct chats
- One per user pair (`chats.direct_key = directChatKey(a, b)`), created lazily by
  `POST /chats/direct`; both members are `member` role.
- Blocking: if either side blocks the other, sending fails with `403 blocked`; the blocked
  user doesn't see the blocker's presence, profile photo or about, and can't call.
- "Delete chat" sets `hidden = true` for the viewer; a new message unhides it.

### Groups
- Roles: `owner` (creator, exactly one), `admin`, `member`. Owner can do everything and
  transfer ownership; admins manage members/admins (can't remove the owner); members per settings.
- Adding members respects each target's `groupsAddPermission` (and blocks): disallowed
  users are returned in `needsInvite`.
- Leaving/removal keeps the membership row (`left_at`, `left_seq`, `left_reason`); the chat
  stays in the former member's list read-only (`membership: 'left' | 'removed'`). Rejoining
  reactivates the row with a new `joined_seq`. If the owner leaves, the oldest admin (else
  oldest member) becomes owner.
- Every change produces a `system` message (see `SystemEvent`).
- Invite links: `chats.invite_code` (random, URL-safe); reset generates a new one.

### Communities
- A community owns an **announcement group** (`chats.is_announcement = true`,
  `community_id` set, `onlyAdminsCanSend = true`). Every community member is an active
  member of it; community admins/owner are its admins/owner.
- Groups link to at most one community (`chats.community_id`). Community admins can create
  groups in it or link groups they administer; unlinking keeps the group alive.
- Joining any linked group (or the community via invite) adds the user to the community
  and its announcement group. Leaving the community removes the user from the
  announcement group and all its groups. Community members can join any linked group
  from the community page.
- Deleting (deactivating) a community unlinks all groups and removes the announcement group.

### Channels
- `chats.type = 'channel'`. Owner/admins post; followers (role `member`) read and react.
  Member lists are hidden from followers; channel messages render with the channel identity.
- Public channels appear in `GET /channels/discover`. Following = joining the chat room.
- No read receipts, typing or replies for followers.

### Messages
- Types: text, image, video, audio, voice, file, location, contact, poll, system, call.
- Media is uploaded first (`POST /api/media`), then referenced by `mediaId`.
- Replies store a snapshot (`metadata.replyPreview`) and `reply_to_id`.
- Forwarding copies content into target chats with `forward_count = source + 1`.
- Edit within `EDIT_WINDOW_MS` (text & captions only, sender only).
- Delete for everyone within `DELETE_FOR_EVERYONE_WINDOW_MS` by the sender, or anytime
  by group admins; content is nulled, `deleted_at` set, reactions/pins/stars removed.
- One reaction per user per message (replace/remove).
- Disappearing: `expires_at = created_at + chats.disappearing_seconds` at send time; a job
  purges expired messages every minute and emits `message:removed`.
- Pins: ≤ `MAX_PINNED_MESSAGES` per chat (admins only when `onlyAdminsCanEditInfo`).
- Polls: options get stable ids; votes in `poll_votes`; `allowMultiple` controls voting.

### Presence & privacy
- Online = at least one connected socket. `users.last_seen_at` updates on last disconnect.
- Presence is delivered only to subscribers allowed by the subject's `lastSeenVisibility`
  / `onlineVisibility` and not blocked. Privacy applies symmetrically like WhatsApp:
  if you hide your last seen you cannot see others' (keep it simple: apply the subject's
  setting; symmetric rule optional).
- `UserPublic` nulls `avatarUrl`/`about` per `profilePhotoVisibility`/`aboutVisibility`;
  `phone` is shown only if the subject saved the viewer as a contact.
- "contacts" means: the subject has the viewer in the subject's contacts.

### Status updates
- Expire after 24h. Audience is resolved at post time from `statusPrivacy`
  (`contacts`, `contacts_except` list, `only_share_with` list) and stored on the row.
- Viewers see statuses where they are in `audience` and not blocked. Views and reactions
  are recorded in `status_views`; the author gets `status:viewed`.
- Replying to a status sends a direct message with `statusReply` metadata.

### Calls
- `call:start` creates `calls` + `call_participants` rows, a `call` chat message, and
  rings invited users (`call:incoming` to all their devices). The ringing device emits
  `call:ringing`; the first device to `call:accept` becomes that user's call socket
  (others get `call:handled-elsewhere`).
- Mesh signaling: a newcomer (accepting or joining) receives the call in the ack and
  sends an `offer` to every `joined` participant; existing participants answer. Signals
  are relayed only between call sockets of joined participants.
- A user already in a call is reported `busy`. Ringing times out after
  `CALL_RING_TIMEOUT_MS` → participant `missed` (call `missed` if nobody answered).
- 1:1: either side leaving ends the call. Group: call ends when fewer than 2 remain
  joined and nobody is ringing. Disconnecting the call socket counts as leaving (after a
  short grace period for reconnects).
- The call's chat message (`type: 'call'`) is updated with final status and duration
  (`message:updated`).
- `GET /calls/ice-servers` returns STUN/TURN; with `TURN_SECRET` it mints coturn REST
  credentials (HMAC-SHA1, time-limited).

### Media
- `POST /api/media` (multipart `file` + meta fields) stores the file under
  `UPLOAD_DIR/<yyyy>/<mm>/<uuid>.<ext>` and returns `MediaAttachment`. MIME type is
  sniffed from the upload and checked against the declared kind. Max `MAX_UPLOAD_BYTES`.
- Files are served with long cache headers and `Content-Disposition` for non-media kinds.

## Web client conventions
- Mobile-first responsive layout: phone = single pane with bottom tabs
  (Chats, Updates, Communities, Calls, Settings); desktop ≥ 1024px = WhatsApp-Web-like
  nav rail + list pane + conversation pane.
- Server state lives in Zustand stores (`auth`, `chats`, `messages`, `users`, `calls`,
  `status`, `communities`, `ui`). `src/realtime/` wires socket events into stores.
  Components never talk to the socket directly except through `lib/socket.ts` helpers.
- Optimistic sends: message gets a `clientId` and `pending: true`; replaced when the REST
  response or `message:new` with the same `clientId` arrives.
- Theme: light/dark/system via `class="dark"` on `<html>`; brand color `#6D5DFC`.
