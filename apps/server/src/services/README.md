# Server services (domain primitives)

Cross-module building blocks the feature modules (`src/modules/*`) are built on. They encode
the normative rules of `docs/ARCHITECTURE.md` — **use them instead of re-implementing
visibility, watermarks, membership transitions, serialization or fan-out in a module.**

| File | What it owns |
| --- | --- |
| `effects.ts` | `Effects` post-commit collector + `transact()` |
| `events.ts` | typed in-process domain event bus (`domainEvents`) |
| `chats.ts` | chat locks, membership lookups, the visibility SQL, permissions, access guards |
| `summaries.ts` | `ChatSummary` batch serializer, `publishChatUpsert` |
| `messages.ts` | send transaction, `toMessages`, paging, `loadVisibleMessage`, replies, deletes |
| `system.ts` | system messages (`postSystemMessage`) + which kinds each chat may get |
| `membership.ts` | `upsertMembership` (all membership writes), succession, roles, add rules |
| `watermarks.ts` | read/delivered marks, unread counts, tick watermarks, delivered-on-connect |
| `users.ts` | user rows, relationships, `UserPublic`/`Presence`/`UserSelf`, account scrub |
| `media.ts` | `MediaAttachment`, media ownership checks |
| `uploads.ts` | MIME sniffing, allowlists, file-name sanitising, storage keys/files |
| `statuses.ts` | status visibility + status-reply resolution |
| `invites.ts` | invite codes unique across chats and communities |
| `sessions.ts` | session tokens (pre-existing) |
| `hooks.ts` | cross-module hook registries (account deletion, chat deletion) |
| `sql.ts` | raw-SQL helpers (`uuidArray`, `rawRows`, `num`, `pairKey`) |

## The post-commit pattern: `transact` + `Effects`

Rule (docs "Fan-out rules"): socket events, room joins/leaves and pushes happen **only after
commit**, **in the order of the mutation → event matrix**.

```ts
import { transact } from '../../services/effects.js';

const message = await transact(async (tx, fx) => {
  const access = await requireActiveMember(tx, me, chatId, { lock: true }); // checks under the chat lock
  assertCanSend(access);
  const { message } = await createMessage(tx, fx, { chatId, senderId: me, type: 'text', text, clientId });
  return message;
});
// ← committed; every step registered in `fx` has been emitted, in registration order
```

`transact(fn)` runs `fn(tx, fx)` in `db.transaction`, then:

1. **register** — inside the tx, services and handlers call `fx.*` in matrix order.
   Nothing is emitted yet. Services that mutate take `(tx, fx, …)` and register their own
   part of the fan-out (e.g. `createMessage` registers JOIN(u) → `message:new` →
   `chat:read` → `chat:watermarks` → `message.created`).
2. **prepare** — as the last statement of the tx, `fx.prepare(tx)` serializes every payload
   that needs the DB (per-user `ChatSummary`, `Message`, unread counts, watermark diffs,
   admin lists, pins, member counts) in a fixed number of **batched** queries through `tx`.
   Payloads therefore reflect exactly the committed state, and no global `db` is touched
   inside the transaction (PGlite would deadlock).
3. **flush** — right after COMMIT, all steps run **synchronously** in registration order
   (no `await` between emits, so a later transaction on the same chat — which had to wait
   for our chat lock — can never overtake our events), then domain events fire.

A throwing transaction emits nothing. A failing step is logged and skipped.
Managing the transaction yourself: `await fx.prepare(tx)` as the last line of the callback,
`fx.flush()` after `db.transaction` resolved. No transaction at all: `await fx.commit()`.

### `Effects` API (all return `this`)

| Method | Emits (after commit) |
| --- | --- |
| `join(u, c)` | rule 2 prefix: `joinUserToChat(u,c)` then `chat:upsert` → user:u |
| `leave(u, c)` | rule 3 suffix: `chat:upsert` → user:u then `removeUserFromChat(u,c)` |
| `removeChat(u, c)` | `removeUserFromChat(u,c)` then `chat:removed` → user:u |
| `joinRoom(u,c)` / `leaveRoom(u,c)` / `clearRoom(c)` | room membership only |
| `chatUpsert(u \| u[], c)` | `chat:upsert` → each user with their own summary (batched) |
| `chatUpdated(c, changes, { exceptUserIds? })` | `chat:updated` → room (except e.g. a direct-chat peer who blocked the actor) |
| `memberCountChanged(c)` | `chat:updated { memberCount }` → room (count at end of tx) |
| `membersChanged(chat)` | `chat:members-changed` → room; admins only for channels/announcement groups |
| `chatPins(c, { exceptUserIds? })` | `chat:pins { messageIds }` → room (pins at end of tx); members with a `message_hidden` row on a pin get their own filtered list → user |
| `messageNew(row, { exceptUserIds })` | `message:new` → room once (normally registered by `createMessage`) |
| `messageUpdated(messageId, { exceptUserIds? })` | `message:updated` → room except members who can't see it (channels: whole room) and `exceptUserIds` |
| `messagesRemoved(c, ids, { userId? })` | `message:removed` → user (delete for me) or room (purge) |
| `chatRead(u, c)` | `chat:read { lastReadSeq, unreadCount, unreadMentionCount, markedUnread }` → user:u |
| `watermarks(delta)` | `chat:watermarks` → active, non-hidden members whose ticks changed, minus `delta.skipUserIds` (see watermarks.ts) |
| `toUser` / `toUsers` / `toChat` | raw emit of a ready payload |
| `add(run, prepare?)` | custom step; `prepare(dbx)` runs inside the tx (e.g. build a `Community` per user) |
| `domain(event, payload)` | domain event, fired after all socket steps |

Standalone post-commit publishers (use only outside transactions; they read with the global
`db`): `publishChatUpsert(userIds, chatId)`, `publishChatUpdated(chatId, changes)`,
`publishMessageUpdated(messageId)`, `publishMessagesRemoved(chatId, ids, { userId? })`,
`publishWatermarks(chatId, userIds?)`, `publishReadState(userId, chatId)`.

## Transactions and locks (normative, docs "Transactions")

- Every service that queries takes `dbx: DbOrTx` (or `tx: Tx` when it must run in a
  transaction) as its **first** parameter; pass `tx` down, never the global `db`, never a
  nested `db.transaction`. Exceptions by design: `transact`, `markDeliveredOnConnect` (open
  their own transaction) and the `publish*` helpers (post-commit only).
- Lock order: `communities` row → `lockChats(tx, ids)` (sorted `FOR UPDATE`) → `calls` row →
  everything else. Any tx writing messages, chat_members or chat_pins of a chat locks the chat
  first (`createMessage`, `upsertMembership`, `advanceRead`, `deleteForEveryoneTx` do it
  themselves; re-locking in the same tx is a no-op). Limit checks run after the lock.
  Poll votes: `loadVisibleMessage(tx, …, { lock: true })` locks the message row.
- No network/file I/O inside a transaction.
- Raw SQL: `rawRows(dbx, sql…)` returns snake_case rows; cast counts `::int`, coerce with
  `num()`, timestamps are strings (`toIso()`/`toDate()`); bind id lists with `uuidArray(ids)`.

## Primitives by file

### chats.ts
- `lockChats(tx, chatIds): ChatRow[]` / `lockChat(tx, chatId): ChatRow` (404) — sorted row locks; return fresh rows.
- `getChat(dbx, id)`, `requireChat(dbx, id)` (404), `getMembership(dbx, chatId, userId)`.
- `activeMemberIds / activeMemberRows / activeMemberCount / adminIds / ownerId (dbx, chatId)`.
- `membershipOf(member)`, `isActive(member)`, `isAdminRole(role)`, `chatKindOfRow(chat)`.
- **Visibility**: `VisibilityWindow { userId, joinedSeq, clearedSeq, leftSeq }`,
  `windowOf(member)`, `PUBLIC_WINDOW` (public channel previews), `windowEnd(chat, member)`,
  `visibleTo(window): SQL` — THE condition for every listing on `messages` (history, search,
  media, pins, starred…), `memberVisibleSql('m','cm')` — the same for raw SQL joining
  `messages m` with the member row `chat_members cm`, `maxVisibleSeq(dbx, chatId, window, upTo?)`.
- **Permissions**: `computePermissions(chat, member, peer, viewerId)` (wraps shared
  `computeChatPermissions`, so guards and clients agree).
- `hiddenPinsByMember(dbx, chatId, messageIds)` — `chat:pins` per-member filtering.
- `peersWhoBlockedMe(dbx, access)` — direct chats: `[peer]` when the peer blocked the viewer;
  pass as `exceptUserIds` of the room events of the viewer's mutations (docs "Blocking").
- **Guards**: `getChatAccess(dbx, viewerId, chatId, { allowHidden?, lock?, chat? }): ChatAccess`
  `{ chat, member, membership, permissions, peer, window }` — 404 without a (non-hidden) row;
  in mutations pass `lock: true` so the checks hold under the chat lock;
  `requireActiveMember(...)` adds `403 not_member` for former members;
  `assertCanSend(access)` (`403 blocked` "Unblock…", `403 forbidden` deleted peer / not allowed);
  `requirePermission(access, 'canPin', msg?)`; `loadPeerInfo(dbx, chatId, viewerId)`.

### summaries.ts
- `toChatSummaries(dbx, viewerId, chatIds?, { includeHidden? }): ChatSummary[]` — chat list
  (no ids: every non-hidden row incl. archived/left, newest activity first; ids: input order).
  Fixed ≈ 11–15 queries regardless of the number of chats.
- `toChatSummary(dbx, viewerId, chatId)` → summary or null (no/hidden row).
- `chatSummariesForPairs(dbx, [{ chatId, userId }])` → `Map<pairKey(chatId,userId), ChatSummary>`
  (one chat for many viewers — used by `Effects.chatUpsert`).
- Semantics: lastMessage = last VISIBLE message (viewer-neutral serialization); unread/mention
  counts; watermarks = min over other active members (none → lastSeq; direct + receipts off
  → read 0; channels 0/0); former members clamped to `left_seq`, `inviteCode` only with
  `canInvite`, `lastActivityAt` = last message time, else joined_at (former: left_at),
  `createdBy` = chats.created_by (viewer-neutral; null for direct chats).

### messages.ts
- `createMessage(tx, fx, input): { message, created, chat }` — THE send transaction (lock,
  idempotent clientId → `created: false` with no seq burned and no events, seq, expires_at,
  mentions ∩ active members, withheld rows for direct recipients who blocked the sender,
  unhide, sender marks + `marked_unread` cleared, delivered for online recipients) and its
  fan-out. Checks (canSend, media ownership, reply target, rate limit) are the caller's.
  `input`: `{ chatId, senderId, type, clientId?, text?, mediaId?, metadata?, replyToId?, forwardCount?, exceptUserIds?, actorId? }`
  (`actorId`: the acting user of a system message — direct chats withhold it from peers who
  blocked them, like a send; `postSystemMessage` fills it from the event). Withheld
  recipients get no `chat:watermarks` for it either.
- `insertMessage(tx, input): { …, publish(fx) }` — same, fan-out registered later by you
  (e.g. after JOINs). Used by membership/system code.
- `deriveMentions(dbx, chatId, senderId, text, activeIds?)` — for send AND edit.
- `buildPollDefinition({ question, options, allowMultiple })` (fresh stable option ids),
  `buildContactCard(dbx, senderId, cardInput)` (fills name/username/phone-as-sender-sees; 400 unknown).
- `resolveReplyTarget(dbx, senderId, chat, replyToId)` — same chat or reply-privately; 400
  system/call/deleted; else 404.
- `loadVisibleMessage(dbx, viewerId, messageId, { chatId?, lock? }): { message, chat, member, window }`
  — every endpoint addressed by message id (404 unless visible). Mutations then check active
  membership/rights (`getChatAccess` + shared `canEditMessage` / `canDeleteForEveryone`).
- `toMessages(dbx, viewerId | null, rows, { chatTypes?, fresh? }): Message[]` — batch
  serializer (input order). `viewerId` null = broadcast shape (no `starred`/`myReaction`/
  `myOptionIds`). Channels: `senderId` null, reaction `userIds`/poll `voterIds` []. Direct
  chats with a viewer: reactions/votes of users the viewer blocked are left out. Tombstones,
  read-time `replyTo` (chatId+seq; `deleted`; null when expired/purged; ~200 chars without
  splitting tokens), read-time `statusReply` (`available: false` once gone).
- `loadMessages(dbx, viewerId, ids)` — load + serialize (e.g. REST responses after reactions/votes).
- `loadMessagePage(dbx, viewerId, chatId, { before?|after?|around?, limit }, { window?, chatType? }): MessagePage`.
- `pinnedMessageIds(dbx, chatId)`.
- `messageUpdatedPayloads(dbx, ids)`, `publishMessageUpdated(id)`, `publishMessagesRemoved(...)`.
- `deleteForEveryoneTx(tx, fx, messageId)` — tombstone + delete reactions/pins/stars/votes;
  registers `message:updated` (+ `chat:pins` if it was pinned).
- `deleteForMeTx(tx, fx, userId, message)` — hidden row, my star removed, `message:removed` → me.

### system.ts
- `postSystemMessage(tx, fx, chat, event, { exceptUserIds? })` → MessageRow (registered fan-out;
  the event's `actorId` is passed as `CreateMessageInput.actorId`).
- `insertSystemMessage(tx, chat, event)` → `InsertedMessage` (publish later).
- `systemMessageAllowed(chat, kind)` — direct: timer/pin; channel: created/name/description/
  avatar; announcement: no join/leave/add/remove/role messages. Posting a disallowed kind throws.

### membership.ts
- `upsertMembership(tx, fx, change): { chat, userIds, systemMessage, newOwnerId }` — **all**
  membership writes:
  - `{ kind: 'activate', chatId, userIds, role?, roles?, addedBy?, systemEvent?, initial? }` —
    add/join/rejoin/follow/creation. `lockLiveUsers` first: accounts deleted meanwhile are
    dropped (result `userIds`; `members_added` lists only the others). S first → `joined_seq = S.seq − 1`; `initial` (group
    creation) → 0, post `group_created`/`members_added` AFTER the call; no S (announcement
    groups) → `last_seq`; channels → 0 with marks = `last_seq`. Rejoin resets the window,
    keeps pin/archive/mute. Registers JOIN(u) per user, then S's `message:new`. Already-active
    users → 409 (filter first).
  - `{ kind: 'deactivate', chatId, userId, reason, systemEvent?, hide?, succession? }` — S
    first, `left_seq = S.seq`, role reset, succession (`owner_changed` after S, leaver
    excluded), then LEAVE(u) (or `hide` → `chat:removed`), domain `member.left`,
    `chat:upsert` → new owner, watermark diffs.
  - `{ kind: 'unfollow', chatId, userId }` — channels: delete row, `chat:removed`; owner → 409.
  - The caller adds `fx.memberCountChanged(c)`, `fx.membersChanged(chat)` and community work.
- `ensureOwner(tx, fx, chatId, { exceptUserIds?, systemMessage? })` → promoted id | null
  (oldest admin, else oldest member; channels: admins only — null ⇒ delete the channel).
- `changeRole(tx, fx, { chatId, userId, role, systemEvent? })` → changed?; never the owner (403).
- `transferOwnership(tx, fx, { chatId, fromUserId, toUserId, systemEvent? })` — demote, then promote.
- `evaluateAddTargets(dbx, { adderId, userIds, activeIds })` → `{ eligible, needsInvite, failed }`
  (`not_found` / `already_member`; blocks either way or `groupsAddPermission` → needsInvite);
  `evaluateGroupAdd(dbx, { adderId, chatId, userIds })`. Capacity (`limit_reached`) is yours.
- `wasRemovedByAdmin(dbx, chat, userId)`, `wasRemovedFromCommunity(dbx, communityId, userId)`.

### watermarks.ts
- `advanceRead(tx, fx, { chatId, userId, seq })` → `{ seq, advanced }` — socket `chat:read`
  and `POST /chats/:id/read`: clamp to the highest visible seq ≤ seq, GREATEST read+delivered,
  `last_read_at`, clear `marked_unread`; registers `chat:read`, `chat:watermarks`, domain
  `chat.read { clearedUnread }` (push dismiss). 404 without a visible row; former members OK.
- `advanceDelivered(tx, fx, { chatId, userId, seq })`.
- `markDeliveredForOnlineRecipients(tx, { chatId, seq, recipientIds })` (used by createMessage).
- `markDeliveredOnConnect(userId)` — registered as an `onBeforeReady` hook in
  `modules/chats/socket.ts`: `FOR SHARE` on the user's chats (sorted), then one statement.
- `readReceiptsChanged(dbx, fx, userId, previousValue)` — PATCH /me/settings.
- `computeWatermarks(dbx, chatId, forUserIds?)`, `unreadCounts(dbx, pairs)`,
  `readStates(dbx, pairs)` / `readState(dbx, userId, chatId)`, `bumpMarks(tx, chatId, userIds, …)`.
- Pure: `aggregateMarks(marks)`, `viewerWatermarks(agg, …)`; `WatermarkDelta` for `fx.watermarks`
  (`skipUserIds`: members who must not learn about this change, e.g. withheld recipients).

### users.ts
- Rows: `getUserRows(dbx, ids)` (Map, deleted included, with `avatarKey`), `getUserRow`,
  `requireUser(dbx, id, { allowDeleted? })` (404), `settingsOf(row)` / `resolveSettings`.
- `lockLiveUsers(tx, ids)` — `FOR SHARE` the non-deleted users (membership writes); waits for a
  concurrent account deletion, whose committed `deleted_at` then excludes the user.
- Relationships: `loadRelationships(dbx, pairs)` (2 queries, both directions),
  `loadRelationship(dbx, viewerId, subjectId)`, `isBlocked(dbx, blocker, blocked)`,
  `blockedEitherWay(dbx, a, b)`, `blockedEitherWayIds(dbx, userId, others)`,
  `blockersOf(dbx, userId, ids)`, `isContactOf(dbx, ownerId, userId)` (owner saved user),
  `ownersWhoSaved(dbx, userId, ownerIds)`, `usersWhoSaved(dbx, userId)`.
- Serialization (all privacy rules): `toUserPublics(dbx, viewerId, ids)` (docs name; input
  order, unknown omitted), `toUserPublicMap`, `toUserPublic`, `toUserPublicsForPairs(dbx, pairs, rows?)`,
  pure `buildUserPublic(viewerId, row, rel)`.
- Presence: `canSeePresence(viewerId, subject, rel)`, `buildPresence(...)`,
  `loadPresences(dbx, viewerId, ids)` (POST /users/presence, `presence:subscribe`).
- Self: `toUserSelf(row)`, `loadUserSelf(dbx, userId)`.
- Deletion: `scrubDeletedUser(tx, userId)` → `{ sessionIds }` (steps 3–4), `deletedUsername(id)`.

### media.ts / uploads.ts / statuses.ts / invites.ts / events.ts
- `mediaUrl(key)`, `toMediaAttachment(row)`, `loadMediaMap(dbx, ids)`,
  `requireOwnedMedia(dbx, mediaId, userId, { kinds?, mimeTypes?, maxBytes? })` (404 not mine,
  400 mismatch; `FOR KEY SHARE` so the GC can't race), `requireAvatarMedia(dbx, mediaId, userId)`.
- `sniffFile(path)`, `isAllowedMime(kind, mime)`, `sanitizeFileName(name)`,
  `newStorageKey(ext)`, `storagePath(key)`, `moveIntoStore`, `removeFiles`, `removeStoredFiles`.
  Sniffing uses the `file-type` package; MIME names are normalised to MEDIA_MIME_ALLOWLIST's.
- `requireVisibleStatus(dbx, viewerId, statusId, { lock? })` (404; `lock` = `FOR KEY SHARE` for writes referencing it), `resolveStatusReply(dbx, { senderId, chat, statusId })`,
  `loadStatusesForReplies`, `toStatusReplyPayload`.
- `generateUniqueInviteCode(dbx)`.
- `domainEvents.on(name, listener)` / `.emit` — `message.created`, `chat.read`, `member.left`,
  `call.ringing`, `call.ring-stopped`, `call.ended` (calls module emits the call ones via `fx.domain`).

## Recipes

```ts
// POST /chats/:chatId/messages (201 created / 200 idempotent retry)
const { message, created } = await transact(async (tx, fx) => {
  const access = await requireActiveMember(tx, me, chatId, { lock: true });
  assertCanSend(access);
  if (body.mediaId) await requireOwnedMedia(tx, body.mediaId, me, { kinds: [body.type] });
  if (body.replyToId) await resolveReplyTarget(tx, me, access.chat, body.replyToId);
  return createMessage(tx, fx, { chatId, senderId: me, type: body.type, text: body.text, clientId: body.clientId, … });
});
const [out] = await toMessages(db, me, [message]);
res.status(created ? 201 : 200).json(out);

// POST /groups/:c/members (after permission + capacity checks under the lock)
await transact(async (tx, fx) => {
  const chat = await lockChat(tx, chatId);
  const targets = await evaluateGroupAdd(tx, { adderId: me, chatId, userIds });
  await upsertMembership(tx, fx, { kind: 'activate', chatId, userIds: targets.eligible, addedBy: me,
    systemEvent: { kind: 'members_added', actorId: me, userIds: targets.eligible } });
  fx.memberCountChanged(chatId).membersChanged(chat);
});

// chat:read socket handler
socket.on('chat:read', socketHandler(socket, receiptPayloadSchema, ({ chatId, seq }, { userId }) =>
  transact((tx, fx) => advanceRead(tx, fx, { chatId, userId, seq })).then(() => undefined)));
```

## Conventions for module authors

- **Routers**: `export const router = Router()` in `modules/<domain>/routes.ts` (already
  mounted; don't touch `modules/index.ts`). Handlers are `async`; Express 5 forwards thrown
  errors. Register literal paths before param paths. `authUserId(req)` for the caller.
  See `modules/media/routes.ts` for a complete reference module.
- **Validation**: parse EVERY input with the shared schema: `parse(schema, req.body)`,
  `parse(idParamSchema('chatId'), req.params)`, `parse(listMessagesQuerySchema, req.query)`,
  socket payloads via `socketHandler(socket, schema, fn)`. Invalid → `400 validation_error`.
- **Errors**: throw `notFound()`, `forbidden()`, `notMember()`, `blocked()`, `conflict()`,
  `limitReached()`, `expired()`, `badRequest()`, `rateLimited()` (lib/errors.ts). Invisible →
  404, visible-but-not-allowed → 403.
- **Rate limits**: `assertUserLimit(userId, 'sendMessage', USER_RATE_LIMITS.sendMessage)`.
- **Serialization**: never return DB rows; use the serializers above (REST: viewer-specific;
  rooms: viewer-neutral only).
- **Socket connect work**: `onBeforeReady` / `onAfterReady` (realtime/hooks.ts), registered at
  import time from your `socket.ts`.
- **Single instance (v1)**: presence, rate limits, the domain event bus and call state are
  per process; don't build cross-instance coordination.
- **Tests**: `test/<module>.test.ts` (routes) or `test/services/*.test.ts` (primitives). Boot
  with `startTestServer()` (fresh in-memory PGlite per file), `t.createUser()`,
  `t.api(user)`, `t.connect(user)`, `waitForEvent`, `expectNoEvent`, `emitAck`
  (test/helpers.ts). `test/services/fixtures.ts` builds groups/directs/channels/communities
  through the services and offers `send`, `block`, `saveContact`, `setSettings`,
  `recordEvents(socket)` (exact event order), `goOffline(user, ...sockets)` (wait until the
  server counts the user offline — needed before asserting delivered receipts) and
  `countQueries(fn)` (N+1 guard).

## Decisions worth knowing

- Names follow docs/ARCHITECTURE.md: `toUserPublics` (brief: loadUsersPublic),
  `loadVisibleMessage` (brief: requireVisibleMessage), `visibleTo` (brief:
  visibleMessagesWhere), `upsertMembership` (brief: activate/deactivateMembership).
- Serializers used for fan-out run inside the transaction (prepare phase) through `tx`; this
  keeps emissions synchronous after commit (ordering) and consistent with the committed state.
- `ChatSummary.lastMessage` is serialized viewer-neutral (no `starred`/`myReaction`).
- `markDeliveredOnConnect` takes `FOR SHARE` locks on the user's chats (sorted) before its one
  statement on the user's own rows: chat-first like every other writer (no deadlock with
  multi-chat transactions), and a send in flight that saw the user offline commits before the
  statement's snapshot.
- Hooks (`services/hooks.ts`): `registerAccountDeletionHook` (DELETE /me) and
  `registerChatDeletionHook` / `runChatDeletionHooks(tx, fx, chatIds)` — run before a chat row
  is deleted (community deactivation, channel deletion); the calls module ends live calls there.
- Delivered receipts are not tracked for channels (no ticks; a post doesn't touch follower rows).
- Clamping: marks move to the highest visible seq ≤ the requested seq (not just `min(seq, max)`),
  so a withheld message never reads as delivered/read while the block lasts.
- Membership changes (leave/remove) also emit `chat:watermarks` to members whose ticks changed
  because a slower member left.
