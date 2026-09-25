# Enbox architecture

Enbox is a WhatsApp/WeChat-style messenger: 1:1 and group chats, communities, channels,
status updates (stories) and voice/video calls (1:1 and group).

This document is **normative**: server and client implementers follow it. The contracts in
`packages/shared` (models, schemas, route catalogue, event maps, helpers) are the typed
counterpart; where a shared helper encodes a rule (`computeChatPermissions`, `callOutcome`,
`extractMentionIds`, `canEditMessage`, …) both sides MUST use it.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | npm workspaces: `packages/shared`, `apps/server`, `apps/web` |
| Language | TypeScript (strict, ESM) everywhere |
| Contracts | `@enbox/shared`: wire models, zod request schemas, REST route catalogue, Socket.IO event maps, pure helpers |
| Server | Node 22, Express 5, Socket.IO 4, Drizzle ORM |
| Database | PostgreSQL (production, `DATABASE_URL`) or embedded **PGlite** (zero-config dev when `DATABASE_URL` is unset; in-memory for tests) |
| Realtime scale-out | Optional Redis adapter for Socket.IO (`REDIS_URL`); presence counts, presence subscriptions and rate limits are per process in v1 |
| Media | Local disk (`UPLOAD_DIR`), served at `/uploads/<key>` with unguessable keys |
| Calls | WebRTC, full-mesh (≤ 8 participants), signaling over Socket.IO, STUN/TURN from env |
| Push | Web Push (VAPID) when keys are configured |
| Web client | React 19, Vite, Tailwind CSS 4, React Router 7, Zustand, socket.io-client; installable PWA |
| Mobile | The web client is mobile-first and PWA-installable; Capacitor can wrap it for store builds |
| Tests | Vitest (+ supertest/socket.io-client) for the server, Playwright for end-to-end |

## Repository layout

```
packages/shared/src/
  constants.ts   limits, tunables, defaults (DEFAULT_*_SETTINGS), rate limits, MIME allowlists
  models.ts      wire models (JSON shapes returned by REST / emitted by sockets), PushPayload
  schemas.ts     zod schemas for every request body/query/param and inbound socket payload
  api.ts         error codes, response types, ApiRoutes catalogue (ALL endpoints)
  events.ts      ServerToClientEvents / ClientToServerEvents / rooms helper
  utils.ts       pure helpers (permissions, mentions, previews, call outcome, ticks, names…)
apps/server/
  drizzle/       generated SQL migrations (npm run db:generate)
  src/
    index.ts     process entry: config, db, http server, socket server, jobs
    app.ts       express app factory (used by tests too)
    config.ts    env parsing
    db/          schema.ts, types.ts (metadata types, toIso), client (pg | pglite) + migrate
    lib/         errors, validation, crypto, logger, rateLimit (per IP), userLimit (per user/socket)
    realtime/    socket server (io.ts), connect hooks (hooks.ts), emit helpers, presence registry
    services/    cross-module domain primitives (serializers, membership, message creation, locks)
    modules/<domain>/  routes.ts (+ service.ts, socket.ts) per domain
    jobs/        periodic jobs (disappearing purge, status expiry, calls, media GC, sessions)
  test/          vitest integration tests
apps/web/src/
  lib/ api client, socket client, helpers     stores/ zustand stores
  realtime/ socket event -> store wiring      features/<domain>/ UI per domain
  components/ shared UI kit                   routes & app shell
```

## Server conventions

- **Modules** live in `src/modules/<domain>/` and export an Express `Router` from `routes.ts`
  (mounted under `/api` in `app.ts`) and optionally a socket registrar from `socket.ts`
  (attaches listeners synchronously for every authenticated socket). Connect-time work
  registers `onBeforeReady` / `onAfterReady` hooks (`realtime/hooks.ts`).
- **Validation**: every body, query, **path param** and socket payload is parsed with the
  zod schemas from `@enbox/shared` (`idParamSchema('chatId', …)`, `inviteParamsSchema`,
  `usernameParamsSchema`). Invalid input → `400 validation_error` (never a 500 from Postgres).
  Ids are lowercase UUIDs (`idSchema` lowercases; z.uuid is RFC-strict, so tests use
  `crypto.randomUUID()`). Routers with merged params use `Router({ mergeParams: true })`.
- **Routes**: register literal segments before param routes (`/users/search`,
  `/users/by-username/:username`, `/users/batch`, `/users/presence` before `/users/:userId`;
  `/messages/starred`, `/messages/forward` before `/messages/:messageId`; `/channels/discover`
  before `/channels/:chatId`; `/calls/active`, `/calls/ice-servers` before `/calls/:callId`).
  `ApiRoutes` lists every endpoint in that order.
- **Route type guards**: `/groups/:chatId/*` accept only `type='group'`; announcement groups
  → `403 forbidden` ("Manage it from the community"). `/channels/:chatId/*` accept only
  channels. Any other type mismatch → `404`.
- **Errors**: throw `HttpError(status, code, message, details?)` or the helpers in
  `lib/errors.ts`. Something the caller may not see → `404 not_found` (never reveal
  existence); visible but not allowed → `403 forbidden` / `not_member` / `blocked`. Socket
  handlers (`socketHandler`) turn thrown errors into `{ ok: false, error: { code, message, details } }` acks.
- **Serialization**: DB rows are never returned directly. Serializers in `src/services/` are
  viewer-aware and batch-oriented, all taking `dbx` first:
  `toUserPublics(dbx, viewerId, userIds)`, `toChatSummaries(dbx, viewerId, chatIds?)` (a fixed
  number of queries per call, not per chat), `toMessages(dbx, viewerId, rows)`,
  `toCommunity(dbx, viewerId, communityId)`, `toCall(dbx, viewerId, callId)`.
- **Transactions** (normative):
  - Every function in `src/services/**` takes `dbx: DbOrTx` as its first parameter. Inside
    `db.transaction(async (tx) => …)` only `tx` may be used: never the global `db`, never a
    nested `db.transaction` (PGlite has one connection and deadlocks forever; pg can
    self-deadlock on row locks).
  - Lock order: `communities` row (community-level ops) → `chats` rows via
    `lockChats(tx, chatIds)` (`SELECT … FOR UPDATE` in **sorted id order**) → `calls` row →
    everything else. Any tx that writes messages, chat_members or chat_pins of a chat locks
    that chat first. Limit checks (MAX_GROUP_MEMBERS, MAX_PINNED_MESSAGES,
    MAX_COMMUNITY_GROUPS, MAX_PINNED_CHATS) run after the lock. Poll votes lock the message
    row (`SELECT … FOR UPDATE`).
  - Ownership changes demote the old owner in one statement, then promote the new one (the
    one-owner partial unique indexes are checked per row).
  - No network/file I/O (uploads, web-push, `fetchSockets`) inside a transaction. Emit
    socket events and send pushes only after commit, in the order of the event matrix.
  - Numbers: int8 is parsed as a JS number on both drivers (`pg.types.setTypeParser(20, Number)`
    in db/index.ts; PGlite already does). In typed selects prefer drizzle `count()` or
    `sql<number>…mapWith(Number)`. Timestamps from raw rows go through `toIso()` (db/types.ts).
- **Auth**: opaque random session tokens (`Authorization: Bearer`), stored as sha256 in
  `sessions`. Each session is a "linked device". Sockets authenticate with the same token.
  Passwords: `crypto.scrypt` with per-user salt (no native deps).
- **Rate limits**: per IP (`lib/rateLimit.ts`: auth, invites, uploads, general API) and per
  user/socket (`lib/userLimit.ts`: `limitUser(subjectId, key, limit, windowMs)` /
  `assertUserLimit(subjectId, key, USER_RATE_LIMITS.x)` → `429 rate_limited`). See "Rate limits".

## Data model essentials

- Ids: lowercase UUIDs. Timestamps: `timestamptz(3)` (ms precision) so ISO cursors round-trip.
- Users are **soft-deleted** (`users.deleted_at`) and never hard-deleted.
- `chats.last_seq`: each message gets `seq = ++last_seq` under the chat row lock. Seqs are
  strictly increasing per chat; gaps are possible (purges), so never derive counts from seq
  arithmetic.
- `chat_members` keeps rows after a group member leaves (`left_at`, `left_seq`,
  `left_reason`, role reset to `member`); channel follower rows are deleted on unfollow.
- DB-enforced invariants: one active owner per chat (`chat_members_owner_uq`), one owner per
  community, one announcement group per community, one live call per chat
  (`calls_chat_live_uq`), a user joined to at most one call (`call_participants_one_joined_uq`),
  type/column consistency CHECKs on `chats` (direct ⇔ direct_key, group ⇔ group_settings,
  channel ⇔ channel_settings, community_id only on groups, announcement ⇒ community & no
  invite code), `messages`: system ⇔ sender_id is null, `chat_members`: left ⇒ role member.
- `messages.metadata` holds type-specific content (`location`, `contact`, `poll` definition,
  `system`, `call`, `statusReply` reference). Reply quotes are computed at read time.
- `users.settings` stores partial overrides; read through `resolveUserSettings()`.
  Groups/channels always store complete settings (defaults merged at creation).

## Visibility, receipts and counts

### Message visibility
Message m (seq s) is **visible** to member M when all hold:
`s > M.joined_seq`, `s > M.cleared_seq`, `M.left_seq is null or s <= M.left_seq`,
no `message_hidden` row for (M, m), and `expires_at is null or expires_at > now()`.
Channel followers have `joined_seq = 0` (full history). One SQL fragment
(`visibleTo(member)` in services) is used by every listing: history paging, search,
`/chats/:id/media`, pins, starred, `ChatSummary.lastMessage`, unread counts, and by
`loadVisibleMessage(dbx, viewerId, messageId, { chatId? })` for every endpoint addressed by
message id (edit, delete, react, star, vote, info, forward sources, reply targets, pins) —
404 unless visible (and in `chatId` when given). Mutations additionally require an active
membership (react, vote, reply, pin) or sender/admin rights (edit, delete for everyone).

`message_hidden` holds "delete for me" rows and messages withheld from a recipient who
blocked the sender (see Blocking).

### Former members
For `membership !== 'active'` the viewer's window ends at `left_seq`: `lastSeq = left_seq`,
`lastMessage` = last visible message, `lastActivityAt` = its time (else `left_at`), unread
counts only inside the window, `inviteCode = null`, all permissions false. Members, pins,
invite, calls and message mutations → `403 not_member`; `/calls/active` excludes those chats.

### Watermarks (read/delivered)
- `last_read_seq` / `last_delivered_seq` are **monotonic** (`GREATEST`) and **clamped** to
  the member's highest visible seq (so withheld/expired/pre-join messages never count as
  delivered/read). Reading also raises delivered to the same value.
- New and rejoined members start with `last_read_seq = last_delivered_seq = joined_seq`, so
  nobody's ticks regress. Channel followers start at the chat's `last_seq`.
- Sending a message advances the sender's own read and delivered watermarks to its seq
  (and clears `marked_unread`); the sender's devices get `chat:read`.
- Tick watermarks for viewer V = min over the **other active** members; if there are none
  (self chat, last member) = the chat's `lastSeq`. Direct chats: `readWatermark = 0` when
  either side has `readReceipts` off (delivered still works). Channels: both 0, no ticks,
  never recomputed. Compute per chat with one query (the two smallest watermarks) and emit
  `chat:watermarks` only to members whose value changed.
- **Delivered is server-driven** (clients never send delivered receipts):
  (a) when a message is created, every recipient with ≥ 1 connected socket
  (`isOnline`) gets `last_delivered_seq` advanced in the same transaction;
  (b) on socket connect, before `ready`, the chats module (`onBeforeReady` hook) advances
  the user's `last_delivered_seq` to the latest visible seq of every active chat (one
  lateral query using the `(chat_id, seq)` index), then emits `chat:watermarks` to senders
  whose ticks changed.
- **Read**: `chat:read { chatId, seq }` (socket) or `POST /api/chats/:chatId/read { seq }`
  (REST) — identical semantics: clamp, `GREATEST`, set `last_read_at`, clear
  `marked_unread`, then emit `chat:read { chatId, lastReadSeq, unreadCount,
  unreadMentionCount, markedUnread }` to `user:<me>`, `chat:watermarks` to affected members,
  and a `dismiss` push (tag `chat:<chatId>`) to my push subscriptions if unread messages
  were cleared. `PATCH prefs { markedUnread: true }` never moves `last_read_seq`.
- `MessageInfo` (`GET /messages/:id/info`, sender only, 404 in channels): other members for
  whom the message is visible, split by watermarks; `at` is approximate (time the member's
  watermark last advanced, nullable).
- Known v1 limitation: after unblocking, messages withheld during the block may show as
  read once a later message is read (watermarks are positions, not per-message receipts).

### Unread and mentions
`unreadCount` = visible messages with `seq > last_read_seq`, `sender_id IS DISTINCT FROM
viewer`, `type <> 'system'` (call messages count for everyone but the initiator).
`unreadMentionCount` = those whose `mentions` contain the viewer. `markedUnread` forces a badge.

## Realtime

### Rooms and connection
- Rooms (`rooms` helper): `user:<id>` (all devices), `session:<id>` (one device),
  `chat:<id>` (active, non-hidden members/followers), `call:<id>` and `call:<id>:<userId>`
  (call sockets of joined participants). **Presence is not room-based.**
- Connect sequence (io.ts): authenticate → join `user:` + `session:` rooms **first** → load
  active non-hidden memberships and join their chat rooms → `onBeforeReady` hooks
  (delivered advance) → emit `ready { userId, sessionId, serverTime }` → `onAfterReady`
  hooks (calls: re-emit `call:incoming` for live calls where I'm `invited`/`ringing`).
- Room membership mirrors active visibility. Joins/leaves always use
  `io.in(rooms.user(u)).socketsJoin/socketsLeave(...)` (`joinUserToChat`,
  `removeUserFromChat`), which reach sockets on every node.

### Fan-out rules
1. Emit only after commit. Viewer-specific payloads (`ChatSummary`, `UserPublic`,
   `Community`, `Call` with hidden participants) go to `user:<id>`; rooms get only
   viewer-neutral payloads (`Message`, `chat:updated`, `chat:pins`, ids).
2. **Chat becomes visible to user u** (direct chat first message, added, joined via link or
   community page, rejoined, channel followed, unhidden by a new visible message):
   `joinUserToChat(u, c)` → `chat:upsert` → `user:u` → then the triggering `message:new` →
   `chat:c`. Clients receiving `message:new` for an unknown chat fetch `GET /api/chats/:id`.
3. **User u leaves chat c** (left/removed): the system message's `message:new` → `chat:c`
   while u is still in the room → `chat:upsert` (membership left/removed) → `user:u` →
   `removeUserFromChat(u, c)` → forced call leave if u is in c's live call.
4. `message:new` is emitted **once** to `chat:c`, excluding users who cannot see it
   (`exceptUserIds`: a recipient who blocked the sender). `message:updated` goes to
   `chat:c` excluding active members for whom the message is invisible (`joined_seq >= seq`,
   `cleared_seq >= seq`, or a `message_hidden` row); channels: whole room.
5. Viewer-neutral chat metadata (`name`, `description`, `avatarUrl`, `groupSettings`,
   `channelSettings`, `disappearingSeconds`, `memberCount`, `communityId`, `isAnnouncement`)
   → `chat:updated { chatId, changes }` → `chat:c`; clients merge and recompute
   `permissions` with `computeChatPermissions`. Changes to one user's role/membership/prefs
   → `chat:upsert` → that user.
6. `chat:members-changed` → `chat:c` for direct/group chats; only to admins (`emitToUsers`)
   for channels and announcement groups.
7. Never for channels: `chat:typing`, `chat:watermarks`, join/leave system messages.

### Mutation → event matrix
Notation: `→ R` = room `chat:<c>`, `→ U(x)` = `user:<x>`, `→ S(x)` = `session:<x>`,
`JOIN(u)` = rule 2 prefix (socketsJoin + `chat:upsert` → U(u)), `LEAVE(u)` = rule 3 suffix,
`sys` = `message:new` of the system message(s) created, in creation order. Unless noted, the
acting device also receives the events (clients dedupe).

| Mutation | Events after commit (in order) |
| --- | --- |
| `POST /auth/logout` | `disconnectSession(me.session)` (push subscriptions cascade) |
| `DELETE /auth/sessions[/:id]`, `POST /auth/change-password` | per revoked session s: `invalidateSessions` → `session:revoked {sessionId:s}` → S(s) → `disconnectSession(s)` |
| `PATCH /me` | `me:updated` → U(me); `user:changed` → R of my active direct/group chats (not channels) and → U(x) for users who saved me as a contact |
| `PATCH /me/settings` | `me:updated` → U(me); presence-visibility change → re-evaluate my presence subscribers (per-socket `presence:update`); `readReceipts` change → recompute read watermarks of my direct chats → `chat:watermarks` → U(me), U(peer) where changed |
| `DELETE /me` | see "Account deletion" |
| `POST/PATCH/DELETE /contacts…` | `contacts:changed` → U(me); `user:changed {userId: me}` → U(contact) (their view of me changed); re-evaluate my presence subscribers |
| `PUT/DELETE /blocks/:u` | `blocks:changed` → U(me); `chat:upsert` (direct chat with u, if any) → U(me); `user:changed {me}` → U(u); presence re-evaluated both ways; a live call between us → forced leave |
| `POST /chats/direct` (new) | JOIN(me) only (peer row is hidden until the first message; nothing to the peer) |
| `PATCH /chats/:c/prefs` | `chat:upsert` → U(me) |
| `POST /chats/:c/read`, `chat:read` | `chat:read {…}` → U(me); `chat:watermarks` → U(x) changed; `dismiss` push → me |
| `POST /chats/:c/clear` | `chat:cleared {clearedSeq}` → U(me) (my stars in range are removed) |
| `DELETE /chats/:c` | `removeUserFromChat(me, c)` → `chat:removed` → U(me) |
| `PUT /chats/:c/disappearing` | sys `disappearing_changed` (not channels) → R; `chat:updated {disappearingSeconds}` → R |
| `POST /chats/:c/pins` | sys `message_pinned` (not channels) → R; `chat:pins` → R |
| `DELETE /chats/:c/pins/:m` | `chat:pins` → R |
| `POST /chats/:c/messages` | for each member u unhidden by it: JOIN(u); `message:new` → R (except withheld recipients); `chat:read` → U(sender); `chat:watermarks` → U(sender) if delivered advanced; pushes. Idempotent retry (same `clientId`): 200 with the existing message, no events |
| `POST /messages/forward` | per created copy: as a send in its target chat |
| `PATCH /messages/:m` (edit) | `message:updated` → R (visible members) |
| `DELETE /messages/:m?for=me` | `message:removed {chatId, [m]}` → U(me) |
| `DELETE /messages/:m?for=everyone` | `message:updated` (tombstone) → R (visible); `chat:pins` → R if it was pinned |
| `PUT/DELETE /messages/:m/reaction`, `PUT …/vote` | `message:updated` → R (visible) |
| `PUT/DELETE /messages/:m/star` | none (stars are private; the Starred screen fetches on open) |
| `POST /groups` | JOIN(creator), JOIN(each added); sys `group_created`, `members_added` → R |
| `PATCH /groups/:c` | per changed field: sys `name_changed`/`description_changed`/`avatar_changed` → R; then `chat:updated {changed fields}` → R |
| `PATCH /groups/:c/settings` | per changed key: sys `settings_changed` → R; then `chat:updated {groupSettings}` → R |
| `POST /groups/:c/members` | JOIN(each added); sys `members_added` → R; `chat:updated {memberCount}` → R; `chat:members-changed` → R; community cascade (see Communities) |
| `DELETE /groups/:c/members/:u` | sys `member_removed` → R; LEAVE(u); `chat:updated {memberCount}` → R; `chat:members-changed` → R |
| `PUT /groups/:c/members/:u/role` | sys `admin_promoted`/`admin_demoted` → R; `chat:upsert` → U(u); `chat:members-changed` → R |
| `POST /groups/:c/transfer-ownership` | sys `owner_transferred` → R; `chat:upsert` → U(old owner), U(new owner); `chat:members-changed` → R |
| `POST /groups/:c/leave` | sys `member_left` (+ `owner_changed` if succession) → R; LEAVE(me); `chat:upsert` → U(new owner); `chat:updated {memberCount}` → R; `chat:members-changed` → R |
| `POST /groups/:c/invite/reset` | sys `invite_link_reset` → R; `chat:upsert` → U(x) for each active member with `canInvite` |
| `POST /invites/:code/join` | group: JOIN(me); sys `member_joined_via_link` → R; `chat:updated {memberCount}`; `chat:members-changed`; community cascade. Channel: as follow. Community: as community join |
| `POST /communities` | JOIN(creator) into the announcement group; sys `community_created` → R(ann); `community:upsert` → U(creator); per linked group: as link |
| `PATCH /communities/:id` | announcement group: per changed field sys (`name_changed`… in community wording) → R(ann), `chat:updated` → R(ann); `community:upsert` → U(each member) |
| `DELETE /communities/:id` | per linked group: sys `removed_from_community` → R(g), `chat:updated {communityId: null}` → R(g); `chat:removed` → R(ann), `clearChatRoom(ann)`; `community:removed` → U(each former member) |
| `POST /communities/:id/groups` | as `POST /groups` (group created linked) + community cascade for its members; `community:upsert` → U(each community member) |
| `POST /communities/:id/groups/link` | per group: sys `added_to_community` → R(g); `chat:updated {communityId}` → R(g); community cascade for its members; `community:upsert` → U(each community member) |
| `DELETE /communities/:id/groups/:c` (unlink) | sys `removed_from_community` → R(g); `chat:updated {communityId: null}` → R(g); `community:upsert` → U(each community member) |
| `POST /communities/:id/groups/:c/join` | JOIN(me) into c; sys `member_joined` → R(c); `chat:updated {memberCount}`; `chat:members-changed`; `community:upsert` → U(me) |
| `POST /communities/:id/members` | per added u: JOIN(u) into ann (no sys message); `community:upsert` → U(u); then `chat:updated {memberCount}` → R(ann); `chat:members-changed` → ann admins |
| `DELETE /communities/:id/members/:u`, `POST …/leave` | per linked group where u is active: sys `member_removed`/`member_left` → R(g), LEAVE(u), `chat:updated {memberCount}`, `chat:members-changed`; ann: hide u's row, `removeUserFromChat(u, ann)` → `chat:removed` → U(u); `chat:updated {memberCount}` → R(ann); `community:removed` → U(u); succession: `community:upsert` + `chat:upsert(ann)` → U(new owner) |
| `PUT /communities/:id/members/:u/role`, `POST …/transfer-ownership` | `community:upsert` + `chat:upsert(ann)` → U(each changed user); `chat:members-changed` → ann admins |
| `POST /communities/:id/invite/reset` | `community:upsert` → U(each owner/admin) |
| `POST /channels` | JOIN(owner); sys `channel_created` → R |
| `PATCH /channels/:c` | name/description/avatar: sys per field → R; then `chat:updated {changed fields incl. channelSettings}` → R |
| `DELETE /channels/:c` | `chat:removed` → R; `clearChatRoom(c)`; then delete (cascade) |
| `PUT /channels/:c/follow` | JOIN(me); `chat:updated {memberCount}` → R; `chat:members-changed` → admins |
| `DELETE /channels/:c/follow` | row deleted; `removeUserFromChat(me, c)`; `chat:removed` → U(me); `chat:updated {memberCount}` → R; `chat:members-changed` → admins |
| `PUT/DELETE /channels/:c/admins/:u`, `POST …/transfer-ownership` | `chat:upsert` → U(each changed user); `chat:members-changed` → admins |
| `POST /channels/:c/invite/reset` | `chat:upsert` → U(each admin) |
| `POST /status` | `status:new` → U(each audience member), U(me) |
| `DELETE /status/:s` | `status:deleted` → U(audience), U(me) |
| `POST /status/:s/view`, `PUT …/reaction` | `status:viewed` → U(author) (not when the viewer has read receipts off) |
| `chat:typing` | `chat:typing` → R except my sockets (see Typing) |
| `presence:subscribe` | ack with per-viewer presence; later `presence:update` per socket (see Presence) |
| call events | see "Calls" |

### Reconnect procedure (clients)
The socket never replays. On every `ready` (not `connect`): (1) refetch `GET /api/chats`
and replace the list; (2) discard all cached message pages, refetch the open chat's latest
page (no cursor) and `GET /api/chats/:id/pins` — never catch up with `after=<seq>` (misses
edits, deletes, reactions, votes, call-status changes); other chats reload when opened;
(3) re-send `presence:subscribe` (subscriptions are per socket); (4) refetch
`GET /api/calls/active` (a call I'm still `joined` to → `call:rejoin`) and clear typing
indicators. Delivered receipts need no client action (server-driven on connect).

### Typing
`chat:typing` is relayed with `emitToChat(c, …, { exceptUserIds: [me] })` only if: the chat
is not a channel, I am an active member with `canSend`, and in direct chats no block exists
in either direction. Server throttle: `limitUser(socket.id, 'typing:'+chatId,
USER_RATE_LIMITS.typing…)`, excess dropped silently. Clients send `typing`/`recording`
every `TYPING_REFRESH_MS` while active and `idle` on send/blur; indicators expire after
`TYPING_TIMEOUT_MS`.

## Membership transitions (normative)

All membership writes go through one helper, `upsertMembership(tx, …)` in
`services/membership.ts`, called while holding the chat lock:

- **Add / join / rejoin (groups)**: create the system message S first (`members_added`,
  `member_joined_via_link`, `member_joined`), then upsert the member with
  `joined_seq = S.seq − 1`, `joined_at = now()`, `last_read_seq = last_delivered_seq =
  joined_seq`, `role = 'member'`, `added_by`, `left_at/left_seq/left_reason = null`,
  `hidden = false`, `marked_unread = false` (pin/archive/mute prefs are kept). The member
  sees "X added you". Rejoining starts a new window: history from the previous membership
  is not visible (documented v1 behaviour).
  - Group creation: every initial member gets `joined_seq = 0` (they see `group_created`).
  - Announcement groups have no join/leave/add/remove system messages:
    `joined_seq = chats.last_seq`.
  - Channels: `joined_seq = 0`, `last_read_seq = last_delivered_seq = chats.last_seq`.
- **Remove / leave (groups)**: system message S first (`member_removed` / `member_left`);
  then `left_at = now()`, `left_seq = S.seq` (they see their own removal),
  `left_reason = 'removed' | 'left'`, `role = 'member'`. Then ownership succession if needed.
- **Unfollow (channels)**: delete the row (no former state).
- **Removed members cannot rejoin themselves**: invite join and community-page join →
  `403 forbidden` ("You were removed by an admin") when their row has
  `left_reason = 'removed'`; for a community or any of its linked groups, also when their
  announcement-group row has `left_reason = 'removed'`. Only an admin add (which
  reactivates the row) lifts it.
- **Ownership succession** (owner leaves or deletes the account): groups and communities —
  the oldest admin (by `joined_at`), else the oldest active member becomes owner. Groups get
  an `owner_changed { userId }` system message (after the `member_left`); communities mirror
  the new owner into the announcement chat's roles without a message. A group with no active
  members stays (empty). A community
  with no members left is deleted (deactivation procedure). Channels — the owner must
  transfer ownership or delete the channel before unfollowing (`409 conflict`); on account
  deletion the oldest admin becomes owner, else the channel is deleted.
- Explicit transfers (`transfer-ownership`): target must be an active member/follower
  (channels: an admin or follower); the old owner becomes `admin`.

## Permissions matrix

`ChatSummary.permissions` is computed by `computeChatPermissions(chat, viewerId)` from the
summary's own fields; server route guards must agree with it. Former members: all false.
"admin" = owner or admin.

| Permission | Direct | Group | Announcement group | Channel |
| --- | --- | --- | --- | --- |
| canSend | I haven't blocked the peer, peer not deleted | `!onlyAdminsCanSend` or admin | admin | admin |
| canEditInfo (name/desc/avatar/timer) | = canSend (timer only) | `!onlyAdminsCanEditInfo` or admin | no (edit the community) | admin |
| canAddMembers | no | `!onlyAdminsCanAddMembers` or admin | no (community add) | no |
| canRemoveMembers | no | admin (never the owner) | no (community) | no |
| canManageAdmins | no | admin (owner can't be demoted) | no (community roles) | owner |
| canPin | yes | = canEditInfo | admin | admin |
| canCall | = canSend, not self chat | = canSend | = canSend (admins) | no |
| canInvite (see/share link) | no | = canAddMembers | no (community link) | admin |
| canDeleteForEveryoneAsAdmin | no | admin | admin | admin |
| canLeave | no (delete chat instead) | yes | no (leave the community) | not the owner |
| canViewMembers | yes | yes | admin | admin |

Also: only the owner transfers ownership, deletes a channel or deactivates a community.
Community owner/admins create/link/unlink groups, add/remove community members, manage
community roles (not the owner) and see the community invite link; community member lists
are owner/admin-only. Reactions in channels follow `channelSettings.reactions`
(`none` → 403, `quick` → QUICK_REACTIONS only). Message edit/delete rules:
`canEditMessage` / `canDeleteForEveryone` (utils).

## Chats

### Direct chats
- One per user pair (`direct_key = directChatKey(a, b)`, lowercase). `POST /chats/direct` is
  idempotent (`insert … on conflict (direct_key) do nothing`, then select): it creates the
  chat with the caller's row visible and the **peer's row `hidden = true`** (no system
  message, nothing emitted to the peer); an existing chat hidden for the caller is unhidden
  (history stays cleared). The first visible message unhides the peer's row (rule 2).
- **Message yourself**: `userId = me` creates a self chat with ONE member row; `peer` = me;
  watermarks = lastSeq (no other members); no calls.
- Deleted peers: `peer.isDeleted`; sending/calling → `403 forbidden`.

### Delete / clear / prefs
- Clear chat: `cleared_seq = chats.last_seq`; my starred rows in that range are removed.
- Delete chat (for me; groups only after leaving — `409 conflict` otherwise; channels are
  unfollowed instead): clear + `hidden = true`,
  `is_pinned = false`, `marked_unread = false`; leave the room; `chat:removed`. History does
  not come back: a new visible message unhides the chat with only newer messages.
- Prefs: at most MAX_PINNED_CHATS pinned (`409 limit_reached`); mute until a time
  (MUTE_FOREVER_ISO = always); archive; mark unread.

### Blocking
- I blocked the peer: my sends → `403 blocked` ("Unblock to send"); `canSend`/`canCall` false.
- The peer blocked me: my sends **succeed** but are inserted into `message_hidden` for the
  peer, never emitted or pushed to them and never unhide their chat; clamping keeps my
  ticks single. Calls: see Calls. The blocked party never learns about the block.
- Either direction: no typing relay, presence hidden, status audience excluded; group adds
  of such users land in `needsInvite`. The blocked party sees the blocker's avatar, about,
  phone and presence as null. Group messages are unaffected.

### Pins and disappearing messages
- Pins: ≤ MAX_PINNED_MESSAGES per chat; pinning another replaces the oldest pin. The message
  must belong to the chat, be visible to the actor, not deleted, not system/call.
- Disappearing: `expires_at = created_at + chats.disappearing_seconds` at send time (system
  and call messages never expire). Clients hide expired messages at `expiresAt`; the purge
  job deletes them (see Jobs). New direct chats and groups start with the creator's
  `defaultDisappearingSeconds`.

## Messages

### Send
- Body `sendMessageSchema`: discriminated by `type`, strict (foreign fields → 400).
  Media: `mediaId` uploaded by the caller with `media.kind === type`.
- Idempotent send (`createMessage(tx, …)`): (1) `lockChats(tx, [chatId])`; (2) if a row with
  (chat_id, sender_id, client_id) exists → return it (HTTP 200, no events, no new seq);
  (3) `UPDATE chats SET last_seq = last_seq + 1, last_message_at = now() … RETURNING`;
  (4) insert (HTTP 201). The unique index is only a safety net. Server-generated messages
  (system, call) have `client_id = null`.
- Permission: active member with `permissions.canSend` (direct: see Blocking).
- Rate limit: `USER_RATE_LIMITS.sendMessage` per user (forward copies count).
- **Mentions**: `@{<lowercase uuid>}` tokens inside `text`/captions. On send **and edit** the
  server sets `mentions = extractMentionIds(text)` ∩ active members (≤ MAX_MENTIONS distinct,
  sender excluded); tokens of non-members stay plain text. Clients render tokens with
  `renderMentions` / `parseMentions`; `messagePreviewText` renders them.
- **Contact cards** with `userId`: the server fills name/username and the phone the sender
  may see (UserPublic.phone), rejecting unknown/deleted users (400). Without `userId`:
  plain data, never linked to an account.
- **Status reply** (`statusReplyToId`): the status must be live and visible to the sender
  (in audience, no block), the chat must be the direct chat with its author, and the sender
  is not the author. Stored as `{ statusId, authorId, type }`; the rest of
  `StatusReplyPayload` is resolved at read time, `available: false` once the status is
  deleted or expired ("Status unavailable").

### Replies
- `replyToId` must reference a message visible to the sender in the same chat — except
  **reply privately**: in a direct chat with P, the target may be P's message in a group
  both are active members of.
- `replyTo` (MessagePreview) is computed at read time from the live row: `chatId`/`seq` for
  jump-to (`around=seq`); text truncated to ~200 chars (tokens kept); deleted for everyone →
  `deleted: true` with null text/media; expired or purged → `replyTo = null`. The quote is
  shown to every reader of the reply regardless of their own window (like WhatsApp).

### Forward
- Sources: visible to the forwarder, not deleted, not system/call (else 404/400). Targets:
  `canSend`. One transaction locking all target chats (sorted); each copy is created with
  `client_id = <clientId>:<sourceIndex>` (retries idempotent).
- Copies ONLY `type`, `text` (verbatim; mentions re-derived for the target chat), `media_id`
  (server-side reuse is allowed), and location/contact/poll definition (fresh, no votes).
  Never reply links, status replies, reactions or expiry (the target's timer applies).
  `forward_count = source + 1`; ≥ FORWARDED_MANY_TIMES_THRESHOLD shows "Forwarded many times".

### Edit
Sender only (channel posts: any channel admin), within EDIT_WINDOW_MS, not deleted, only
text and media captions (`canEditMessage`). Text messages need non-empty text
(≤ MAX_MESSAGE_LENGTH); captions may be emptied (stored null) and are ≤ MAX_CAPTION_LENGTH.
Mentions are re-derived; `edited_at` set; `message:updated`.

### Delete
- For me: `message_hidden` row; `message:removed` → my devices.
- For everyone (`canDeleteForEveryone`): the sender within DELETE_FOR_EVERYONE_WINDOW_MS;
  group admins and channel admins at any time (never in direct chats); never system/call
  messages. In one tx: `text = null`, `media_id = null`, `metadata = '{}'` (type kept),
  `mentions = '{}'`, `deleted_at = now()`; delete its reactions, pins, stars and poll votes.
  Quotes of it become `deleted: true` at read time; clients also mark loaded quotes.

### Reactions, polls, stars
- One reaction per user per message (`emojiSchema`: one emoji grapheme); replace/remove. Not
  on system or deleted messages. Channels: `reactions[].userIds = []` for everyone.
- Polls: option ids are stable; votes replace the user's previous votes (single-choice → at
  most one id; empty = retract) under a message row lock. `voteCount` per option;
  channels: `voterIds = []`. `Poll.myOptionIds` in REST responses.
- `Message.myReaction` and `Poll.myOptionIds` are present in viewer-specific REST responses
  (history, reaction/vote responses); broadcasts omit them and clients keep cached values
  (models.ts header). Stars: private, no events.

### History paging
`GET /chats/:c/messages` → `MessagePage { messages (ascending), hasMoreBefore, hasMoreAfter,
users }`. At most one cursor (exclusive seqs): none = latest page; `before`; `after`;
`around=N` = ⌈limit/2⌉ at or below N plus the rest above. `users` side-loads every user
referenced by the page (`referencedUserIds`). Search, starred and media lists return full
messages; clients resolve users with `POST /api/users/batch`.

## Groups

- Roles: exactly one `owner`, `admin`s, `member`s. Owner can't be removed or demoted.
- **Adding** (create with `memberIds`, `POST …/members`, community adds): per target —
  deleted/unknown → `failed: not_found`; already active → `failed: already_member`; over
  capacity → `failed: limit_reached`; block in either direction or `groupsAddPermission`
  not satisfied (`nobody`, or `contacts` and the target hasn't saved the adder) →
  `needsInvite` (indistinguishable). Rate limit `USER_RATE_LIMITS.addMembers` per added user.
- Every change produces system messages (one per changed field/setting) as in the matrix;
  omitted/unchanged PATCH fields produce nothing.
- Invite links: `chats.invite_code` (INVITE_CODE_LENGTH chars from INVITE_CODE_ALPHABET),
  unique across chats and communities (regenerate on collision in either table). Visible to
  `canInvite`; reset by admins. `GET /invites/:code` checks chats, then communities;
  `InvitePreview` shows community context and `canJoin`/`reason`.

## Communities

- A community owns an **announcement group** (`type = 'group'`, `is_announcement`,
  `community_id` set, ANNOUNCEMENT_GROUP_SETTINGS, no invite code, name/description/avatar
  copied from the community on create and PATCH), created in the same transaction as the
  community; `announcementChatId` is never null while the community exists.
- `community_members` is authoritative; the announcement chat's `chat_members` mirrors it
  (membership and role) in the same transaction.
- **Invariant**: active announcement members = community members ⊇ active members of every
  linked group. Therefore:
  - becoming active in a linked group (admin add, creation with members, invite join,
    community-page join, linking the group) also adds the user to the community and its
    announcement group (no system message there; `community:upsert` → user);
  - leaving/being removed from one linked group, or unlinking a group, removes nobody
    from the community;
  - leaving/being removed from the community removes the user from the announcement group
    and every linked group (system messages in the linked groups);
  - any mutation pushing the community past MAX_GROUP_MEMBERS fails with `409 limit_reached`.
- Groups: created inside (`POST /communities/:id/groups`) or linked (caller admins both; the
  group is a regular group not linked elsewhere; ≤ MAX_COMMUNITY_GROUPS). Community members
  can join any linked group from the community page (unless removed from it by an admin).
- Generic `/groups` routes reject announcement groups (membership, roles, invite, leave,
  settings, info → `403`). Announcement groups get no join/leave/add/remove messages.
- Community member list, announcement member list: owner/admins only. `GET /communities/:id`
  → 404 for non-members (previews via invites).
- `POST …/members` returns `CommunityAddMembersResult` with the same add rules as groups.
- **Deactivation** (owner, `DELETE /communities/:id`), one transaction: for each linked
  group insert `removed_from_community` and set `community_id = null`; delete the
  announcement chat (cascade); delete the community. Then the events in the matrix.

## Channels

- Owner/admins post; followers read and react. Channel posts show the channel identity:
  `senderId` is serialized as null, `reactions[].userIds` and poll `voterIds` are always
  `[]` (counts only). Member lists and `chat:members-changed` are admin-only; no typing,
  receipts/ticks, message info or join/leave/admin system messages (only `channel_created`,
  `name_changed`, `description_changed`, `avatar_changed`).
- Followers see all history (`joined_seq = 0`) without an unread backlog.
- Public channels (`isPublic`): listed in `GET /channels/discover`, previewable by anyone
  with `GET /channels/:id` (`ChannelPreview`: entry + latest page) and followable by id.
  Private channels: 404 to non-followers; joinable only via invite link.
- Unfollow deletes the row and removes the chat from the follower's list. The owner cannot
  unfollow (transfer or delete). Only the owner manages admins; targets must follow.
- Delete (owner): `chat:removed` to the room, clear the room, delete the chat (cascade).
- `GET /users/:id/common-groups` never includes channels.

## Users, privacy and presence

- Settings: `DEFAULT_USER_SETTINGS`; `PATCH /me/settings` merges atomically
  (`settings = settings || $patch`); status lists drop ids that are not my contacts.
- "contacts" in privacy rules = people the **subject** saved as contacts. v1 applies only
  the subject's settings (no reciprocity).
- `UserPublic` (viewer-specific, always complete): `avatarUrl` per `profilePhotoVisibility`,
  `about` per `aboutVisibility`, `phone` only if the subject saved the viewer, presence per
  last-seen/online visibility; all null if the subject blocked the viewer or the account is
  deleted (`isDeleted: true`, name "Deleted account").
- **Presence**: online = ≥ 1 connected socket; `last_seen_at` set on the last disconnect.
  For viewer V and subject S: `canSeeLastSeen` = no block either way and
  (`lastSeenVisibility = everyone` or (`contacts` and S saved V)); `canSeeOnline` = no block
  and (`onlineVisibility = everyone` or `canSeeLastSeen`). Hidden values are `null`, never
  omitted. Subscriptions are **per socket** (`realtime/presence.ts` registry, ≤
  MAX_PRESENCE_SUBSCRIPTIONS per socket, `presence:subscribe` rate-limited): privacy is
  evaluated at subscribe time (ack) and at every emit, per viewer, with `emitToSocket`.
  Re-evaluate and emit to S's subscribers when S goes online/offline, changes
  lastSeen/online visibility, blocks/unblocks, or adds/removes contacts.
  `POST /users/presence` uses the same function.
- **User search** (`GET /users/search?q=`, leading `@` ignored, rate-limited): exact
  username; username prefix when `q.length ≥ USER_SEARCH_MIN_PREFIX`; exact canonical phone
  when q parses as a phone (never substring phone matching); display-name substring only
  among my contacts and users sharing an active chat with me. ≤ USER_SEARCH_LIMIT results;
  excludes deleted users and users who blocked me.
- `POST /users/batch` (≤ MAX_USERS_BATCH): privacy-filtered like `GET /users/:id`, deleted
  users included (`isDeleted`), unknown ids omitted.

## Accounts, sessions and deletion

- Usernames: lowercase, 3–32 chars, at least one letter, `deleted_` prefix reserved.
  Phones: canonical E.164 with '+' (`phoneSchema`). Login identifier (`parseLoginIdentifier`):
  starts with '+' or only digits/separators → phone, else username. Deleted users cannot
  log in (same error as a wrong password).
- Password change and "log out other devices" revoke all other sessions in one tx; then
  `invalidateSessions(ids)`, `session:revoked` → `session:<id>`, `disconnectSession(id)`.
  `DELETE /auth/sessions/:id` affects only the caller's sessions (else 404); deleting the
  current session = logout. Other instances may honour a revoked token ≤ 30 s (cache).
  Push subscriptions cascade with their session.
- **Account deletion** (`DELETE /me`, password required), one transaction: (1) forced leave
  of any live call; (2) leave every active group (normal pipeline + succession) and
  community (community pipeline); delete follower rows of channels; owned channels pass to
  the oldest admin or are deleted; (3) delete sessions, push subscriptions, contacts and
  blocks (both directions) and statuses; (4) scrub the row: `username =
  'deleted_' || <first 12 hex chars of the id without dashes>`, `display_name = 'Deleted account'`, `phone = null`,
  `about = ''`, `avatar_media_id = null`, `password_hash = '!'`, `settings = '{}'`,
  `deleted_at = now()`. Direct-chat memberships and messages stay (sender shown as Deleted
  account). After commit: membership events as in the matrix, `user:changed` → rooms of the
  remaining direct chats, `disconnectUser`. Deleted users can't be found, added, messaged
  or called.

## Status updates

- Expire after STATUS_TTL_MS. Audience resolved at post time and stored on the row:
  `contacts` = my contacts; `contacts_except` = contacts − `statusExcludeUserIds`;
  `only_share_with` = `statusOnlyShareWithUserIds` ∩ contacts; always minus blocks (either
  direction) and deleted users.
- `requireVisibleStatus`: live and (author, or in audience with no block) else 404 — used by
  view, reaction and status replies. Viewers list: author only.
- Viewers with `readReceipts` off: the view is recorded (`viewed: true` for them) but they
  are excluded from `viewCount`/viewers and trigger no `status:viewed`.
- Status media must be the author's upload of the matching kind. Deleting/expiring a status
  nulls its media reference for GC; replies then resolve to `available: false`.

## Calls

- **Eligibility**: direct chats (`canCall`: not blocked by me, peer not deleted, not self)
  and groups (`canCall` = `canSend`); never channels. Invitees = `userIds` (or all other
  active members) ∩ active members, ≤ MAX_CALL_PARTICIPANTS − 1; if `userIds` is omitted
  and the chat has more than MAX_CALL_PARTICIPANTS − 1 other members → `400
  validation_error`. `call:invite`: group calls only, by joined participants, same limits;
  re-inviting a declined/missed/busy/left participant resets `invited_at`. The joined count
  is checked at accept/join/rejoin (`limit_reached`). Rate limit: `USER_RATE_LIMITS.callStart`.
- **One live call per chat** (`calls_chat_live_uq`): `call:start` while one exists → ack
  `conflict` with `details: { callId }` (the client accepts/joins it; this also resolves 1:1
  cross-calls). A user joined elsewhere → `conflict` (busy); invitees joined elsewhere get
  status `busy` and are not rung.
- **Blocked callee** (callee blocked the caller): the participant row is created (`invited`,
  `hidden_at` set) but never rung or notified; the call ends `missed` at the timeout. In
  group calls, users with a block either way with the caller are skipped.
- **State machine**: see `CallStatus`/`CallParticipantStatus` docs. `ringing → ongoing` when
  the first invitee joins (`answered_at`). A ringing call ends when no invitee is
  invited/ringing/joined: `declined` if all declined, else `missed`; initiator leaves (or its
  call socket's grace expires) while ringing → `cancelled`. Ongoing 1:1 → `ended` when
  either side leaves; group → `ended` when fewer than 2 are joined and nobody is ringing.
  On end: invited/ringing → missed, joined → left; `call:ended` → every visible participant;
  sockets leave the call rooms.
- **Serialization**: every mutation of a call (start, ringing, accept, decline, join,
  rejoin, leave, invite, timeout, disconnect grace) runs in one transaction starting with
  `SELECT … FROM calls WHERE id = $1 FOR UPDATE`; acks and broadcasts come from that
  transaction's committed state.
- **Ringing**: `call:incoming` → `user:<u>` of each rung invitee (not busy, not hidden;
  `silent` when the callee silences unknown callers and the caller isn't their contact) +
  a `call` push. A non-silent device emits `call:ringing` (participant → `ringing`,
  `call:updated`). **Ring stop**: whenever a user's ringing ends — answered or declined on
  another device, ring timeout (CALL_RING_TIMEOUT_MS from `invited_at`), caller cancelled,
  call ended — `call:ring-stop { callId, reason }` → `user:<u>` and a `call_cancel` push.
  Clients ring iff their status ∈ {invited, ringing} and the call is live.
- **Accept/join**: the socket becomes the **call socket**: `session_id` stored, joins
  `rooms.call(id)` and `rooms.callMember(id, me)`. Peers get `call:participant-joined`;
  `call:updated` → all visible participants; the call message → `message:updated`.
  `call:leave`, `call:signal`, `call:media` are honoured only from the call socket;
  `call:decline` from any of my sockets. Signals are relayed only between call sockets of
  joined participants via `rooms.callMember(callId, toUserId)`.
- **Negotiation**: both audio and video transceivers on every connection (replaceTrack for
  camera/screen, no renegotiation); the newcomer offers to every joined participant in its
  ack; later renegotiation/ICE restarts use perfect negotiation (the lexicographically
  smaller userId is polite). See events.ts.
- **Media state**: `audioMuted`/`videoOff` initial values from start/accept/join/rejoin
  (default: unmuted, video off for audio calls); `call:media` persists flags on the
  participant row and broadcasts to the call room.
- **Reconnect**: when the call socket disconnects, set `disconnected_at` (emit nothing).
  `call:rejoin` within CALL_RECONNECT_GRACE_MS (or from the same session) clears it,
  re-binds the new socket and acts as a newcomer (`call:participant-joined`; peers close
  the old connection and wait for the offer). After the grace the calls job marks the
  participant `left` (`call:participant-left`) and applies the end rules.
- **Late devices**: after `ready` the server re-emits `call:incoming` for live calls where
  the user is still invited/ringing. `GET /calls/active` = live calls in my active chats,
  including calls ringing me (hidden participant rows excluded).
- **Crash recovery**: on boot (calls job `runOnStart`), every `ongoing` call → `ended`
  (`ended_at = now()`), every `ringing` call → `missed`; participants closed; call messages
  updated. (v1 assumes a single server instance; with several instances this must be
  limited to calls whose call sockets lived on the restarted node.)
- **Forced leave**: leaving/removal from the chat, a block between direct-call peers,
  revocation of the session holding the call socket, account deletion.
- **Call messages**: created at `call:start` (`type: 'call'`, `senderId` = initiator,
  `metadata.call` = `CallMessagePayload`), updated with `message:updated` at every status
  transition (`durationSec` once ended). They count as unread for everyone but the
  initiator, never trigger a message push, can't be edited, forwarded or deleted for
  everyone. Clients derive per-viewer text with `callOutcome()` / `messagePreviewText`.
- Call log (`GET /calls`): calls I participate in (not `hidden_at`), newest first, with
  `callOutcome(call, me, myStatus)`. `GET /calls/ice-servers` returns STUN/TURN; with
  `TURN_SECRET` it mints coturn REST credentials (HMAC-SHA1, time-limited).

## Media

- `POST /api/media` (multipart `file` + optional `thumbnail` + `uploadMediaMetaSchema`
  fields; ≤ MAX_UPLOAD_BYTES). The MIME type is sniffed from the bytes and must be in
  `MEDIA_MIME_ALLOWLIST[kind]` (`file`: anything; SVG is never an image). The stored
  extension comes from the sniffed type (unknown → `.bin`), never from the client name.
  `fileName` = sanitised basename (control/bidi chars removed, NFC, ≤ MAX_FILE_NAME_LENGTH),
  never used in headers. Key `UPLOAD_DIR/<yyyy>/<mm>/<uuid>.<ext>`; thumbnail (JPEG/WebP ≤
  MAX_THUMBNAIL_BYTES) → `media.thumbnail_key`, `MediaAttachment.thumbnailUrl`.
- Files are served immutable with `nosniff`, a sandbox CSP and `Content-Disposition:
  attachment` unless the extension is inline-safe.
- Ownership: every client-supplied `mediaId` (messages, statuses, avatars) must be uploaded
  by the caller, else 404; `message.type`/status type must equal `media.kind`. Avatars
  (user, group, community, channel): kind `image`, AVATAR_MIME_TYPES, ≤ MAX_AVATAR_BYTES.
  Forwarding reuses media ids server-side.
- **Client-side processing** (web): photos are re-encoded through a canvas (strips EXIF/GPS,
  longest side ≤ IMAGE_MAX_DIMENSION, avatars ≤ AVATAR_MAX_DIMENSION) and get a thumbnail;
  videos get a poster thumbnail; "send as document" uploads the original unchanged. The
  server does not strip metadata (video metadata is a known v1 limitation).
- Media rows are shared and immutable. Deleting a message for everyone, purging expired
  messages, deleting/expiring statuses and replacing avatars only null references; the GC
  job deletes media rows and files (incl. thumbnails) unreferenced by any message, status,
  user, chat or community for more than ORPHAN_MEDIA_TTL_MS.

## Push

- Subscriptions: `session_id` NOT NULL (logout/revocation removes them), endpoint must be
  https on an allow-listed push service host (`pushEndpointSchema`), upsert by endpoint
  (reassigned to the current user/session), unsubscribe only my own; 404/410 from the push
  service deletes the row. Sender: timeout, no redirects.
- Payload: `PushPayload` (models.ts). Sent to every subscription of each recipient (never
  the sender) regardless of socket state; the service worker skips showing it when a
  focused window exists.
- Messages: not for channels, system or call messages, withheld messages, or muted chats;
  gated by `messageNotifications` (direct) / `groupNotifications` (groups incl.
  announcement). Title: direct → sender as the recipient knows them; group → group name
  with body `Sender: preview`. Preview = `truncate(messagePreviewText(…, { viewerId }), 120)`
  (mentions rendered) or "New message" when `notificationPreviews` is off. `tag =
  chat:<chatId>`, `url = /chats/<chatId>`, TTL PUSH_MESSAGE_TTL_SEC.
- `dismiss` (tag `chat:<chatId>`) when a read clears the chat's unread messages.
- Calls: `call` push (urgency high, TTL = CALL_RING_TIMEOUT_MS / 1000, tag `call:<callId>`)
  unless silent or `callNotifications` is off; `call_cancel` when the ring stops (body
  "Missed call" if the final status is missed, else empty).
- Note: browsers require `userVisibleOnly`; `dismiss`/`call_cancel` pushes that show nothing
  may be counted against the site's silent-push budget — acceptable for v1.

## Rate limits

| Scope | Limit |
| --- | --- |
| Per IP (lib/rateLimit.ts) | auth 20/10 min, invite lookups/joins 60/10 min, uploads 120/10 min, API 1200/min |
| Per user (`USER_RATE_LIMITS`) | sendMessage 60/10 s (forwards count per copy), addMembers 200/h (per added user), callStart 10/min, userSearch 60/min (search + add contact) |
| Per socket | typing 1/s per chat (dropped silently), presenceSubscribe 30/min |

## Jobs

Registered in `jobs/register.ts`; idempotent, safe on every instance.
- **Disappearing purge** (every minute): `DELETE FROM messages WHERE id IN (SELECT id … WHERE
  expires_at <= now() ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED) RETURNING id,
  chat_id`, looping while full; `message:removed` → room per chat.
- **Status expiry**: delete expired statuses (clients drop them at `expiresAt`).
- **Calls** (every ~5 s, `runOnStart` for crash recovery): ring timeouts, reconnect-grace
  expiry, end rules.
- **Media GC** (hourly) and **session cleanup** (expired sessions).

## Web client conventions
- Mobile-first responsive layout: phone = single pane with bottom tabs
  (Chats, Updates, Communities, Calls, Settings); desktop ≥ 1024px = WhatsApp-Web-like
  nav rail + list pane + conversation pane.
- Server state lives in Zustand stores (`auth`, `chats`, `messages`, `users`, `calls`,
  `status`, `communities`, `ui`). `src/realtime/` wires socket events into stores and runs
  the reconnect procedure. Components never talk to the socket directly except through
  `lib/socket.ts` helpers.
- UI gating uses `chat.permissions`; unknown user ids are batch-fetched
  (`useUsers().fetchUsers`); message pages' `users` are upserted into the users store.
- Optimistic sends: message gets a `clientId` and `pending: true`; replaced when the REST
  response or `message:new` with the same `clientId` arrives.
- Missed-calls badge: computed client-side from the call log since the last visit of the
  Calls tab (stored locally).
- Theme: light/dark/system via `class="dark"` on `<html>`; brand color `#6D5DFC`.
