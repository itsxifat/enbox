# Spaces at scale

Status: approved direction (2026-10-22). This document supersedes the P3 parts (Spaces, voice
channels, the communities migration) of `docs/design/ux-programme.md`. Everything else in that
document (P1 profiles, P2 chat themes, P4 emoji) stays valid. Normative rules still end up in
`docs/ARCHITECTURE.md` as each phase lands.

## Goal

Communities are replaced by **Spaces**, which work like Discord servers: categories, text and
voice channels, roles with a permission bitfield, per-channel permission overwrites, invites,
member list, nicknames, moderation (kick, ban, timeout), audit log and notification levels.

The product goal is **huge traffic**: Spaces with hundreds of thousands of members, and an
Enbox that runs as several processes and later several machines. Two parts of the earlier
design do not survive that and are replaced here:

1. The earlier design gave every member a `chat_members` row for every channel they can see.
   A 250k-member Space with 200 channels would need 50M rows, and one role edit would rewrite
   millions of them. Here access is **computed** from membership, roles and overwrites, and a
   per-channel row exists only as **lazy read state** (created when someone reads a channel,
   changes its notification setting or mutes it).
2. Presence, background jobs, call coordination and the event bus lived inside one process.
   Here they are **cluster-safe**: any number of identical Enbox processes behind nginx, sharing
   PostgreSQL and Valkey (Redis-compatible).

### Targets

| What                              | Limit (constant)                        |
| --------------------------------- | --------------------------------------- |
| Members per Space                 | 250 000 (`MAX_SPACE_MEMBERS`)           |
| Channels per Space (text + voice) | 500 (`MAX_SPACE_CHANNELS`)              |
| Categories per Space              | 50 (`MAX_SPACE_CATEGORIES`)             |
| Roles per Space (incl. @everyone) | 250 (`MAX_SPACE_ROLES`)                 |
| Spaces per user                   | 200 (`MAX_SPACES_PER_USER`)             |
| Overwrites per channel            | 100 (`MAX_OVERWRITES_PER_CHANNEL`)      |
| "Large Space" behaviour above     | 1 000 members (`LARGE_SPACE_THRESHOLD`) |
| Voice channel participants        | 99 (`MAX_VOICE_CHANNEL_PARTICIPANTS`)   |

Nothing in the hot paths (send, read, connect, role edit) does work proportional to a Space's
member count. Work proportional to _online sockets on one node_ is allowed for fan-out (that is
what delivering a message is).

## Phases and deploys

| Phase | Content                                                                                                                                         | Deploy                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| S0    | Cluster foundation: bus, node registry, presence, jobs, calls, deploy tooling                                                                   | alone; production moves to Valkey + 2 processes |
| S1    | Spaces server: schema, permissions, channels, roles, members, invites, moderation, audit log, fan-out, read state, push, communities conversion | with S2                                         |
| S2    | Spaces web: Discord-style layout, channel view, member list, settings, role editor, invites, moderation UI                                      | with S1                                         |
| S3    | Voice channels on a self-hosted LiveKit SFU                                                                                                     | alone (needs router ports)                      |
| S4    | Android app Spaces (until then its Communities tab says "Open Spaces on the web")                                                               | APK                                             |

## S0 — Cluster foundation

Every process is identical and stateless with respect to truth. Truth lives in PostgreSQL;
Valkey carries messages between processes and the Socket.IO adapter. Without `REDIS_URL` the
same code runs as a cluster of one (dev, tests).

- **Node identity**: `NODE_ID` = random id per process start. Each node upserts a heartbeat row
  in `cluster_nodes` every 5 s (`CLUSTER_HEARTBEAT_MS`); a node is dead when its heartbeat is
  older than 20 s (`CLUSTER_NODE_TTL_MS`). Graceful shutdown deletes the row at once.
- **Cluster bus** (`apps/server/src/cluster/bus.ts`): `publish(topic, data)` delivers to local
  handlers synchronously and to every other node through Valkey pub/sub (`enbox:bus`). Topics
  are typed. Delivery is at-most-once and unordered relative to Socket.IO broadcasts; every
  consumer tolerates that (idempotent, versioned, or re-checks the DB).
- **Presence registry** (`realtime/presence.ts` keeps its synchronous API): each node counts its
  own sockets and publishes per-user deltas `{node, userId, sockets, idle}`; every node keeps a
  replica of the other nodes' counts. Online = any node has a socket. A node that joins asks for
  snapshots; a node silent for `CLUSTER_NODE_TTL_MS` is dropped from every replica (its users go
  offline unless they are on another node). Global transitions fire `presenceEvents` on EVERY
  node, so each node re-evaluates its own subscribers. `reevaluatePresence` is published to all
  nodes. `last_seen_at` is written by the node whose last local socket of the user closed, with
  `greatest()`, so the final disconnect wins.
- **Jobs**: each job declares `scope: 'cluster' | 'node'`. Cluster jobs run only on the leader,
  the node holding a PostgreSQL session advisory lock on a dedicated connection (PGlite: always
  the leader). Node jobs run everywhere (e.g. the per-node half of the calls sweep).
- **Calls**: the call socket binding moves from memory into `call_participants.socket_id` and
  `node_id`. Ops compare bindings from the locked rows. A node only sweeps its own participants;
  the leader treats participants bound to a dead node as disconnected (reconnect grace, then
  leave). Boot no longer ends every live call: after a restart clients `call:rejoin` within the
  grace window, so calls survive deploys.
- **Sessions**: `invalidateSessions` is published, so a revoked token stops working on every
  node at once (it used to linger for up to 30 s on other instances).
- **Migrations**: `initDb` takes a PostgreSQL advisory lock around the migrator (and, in S1,
  around the communities conversion), so N processes booting together migrate exactly once.
- **Rate limits** stay per process. nginx routes by client IP (`hash $remote_addr consistent`),
  which Socket.IO's long-polling fallback needs anyway, so one client's requests and sockets
  land on one node and per-process limits stay accurate. A Redis-backed store is the upgrade
  path once clients spread across machines.
- **Uploads** stay on the local disk (all processes run on one host). Several machines need an
  object store (S3-compatible); the storage interface is already one module
  (`services/uploads.ts`).

Production after S0: `valkey-server` bound to 127.0.0.1 (no persistence, pub/sub only),
systemd template `enbox@.service` with instances `enbox@4000` and `enbox@4001`, the nginx
upstream `enbox_app` listing both with `hash $remote_addr consistent`, and a deploy script that
restarts instances one at a time (zero downtime) unless a release asks for a full stop (the
communities conversion does). The deploy tooling is vendored into `deploy/`.

## S1 — Data model

Space channels are `chats` rows with the new types `space_text` and `space_voice`, so messages,
reactions, pins, polls, media, search by chat, edit and delete keep one code path. `channel`
and `group` are never reused (they carry anonymised senders and group pipelines).

New tables (migration `0004_spaces`, numbered after the link-previews migration):

- `spaces`: id, name, description, icon/banner media (SET NULL + GC), owner_id, system /
  rules / afk channel ids, afk_timeout_sec, default_notify_level ('all' | 'mentions'),
  is_discoverable, vanity_code, member_count (maintained in the join/leave transactions),
  perm_version (bumped by every change that can alter permissions), legacy_community_id
  (conversion idempotency), created_at, updated_at.
- `space_members`: (space_id, user_id) PK, nickname, sort_name (lower(nickname or display
  name), maintained), joined_at, timed_out_until, server_mute, server_deaf, notify_level,
  muted_until, suppress_everyone. Indexes: (user_id), (space_id, sort_name, user_id) for the
  member list, (space_id, joined_at, user_id).
- `space_roles`: id, space_id, name, color, position (0 = @everyone), permissions int4, hoist,
  mentionable, is_default (one per space).
- `space_member_roles`: (space_id, user_id, role_id). @everyone is implicit.
- `space_categories`: id, space_id, name, position.
- `space_channel_overwrites` / `space_category_overwrites`: (target id, target_type 'role' |
  'member', target_id) PK, allow, deny, CHECK `(allow & deny) = 0`. Category overwrites are
  templates copied to channels on create and on "sync"; only channel overwrites are evaluated.
- `space_bans`: (space_id, user_id) PK, banned_by, reason, created_at.
- `space_invites`: code PK (shared code space with chats), space_id, channel_id, created_by,
  max_uses, uses, expires_at.
- `space_audit_log`: id, space_id, actor_id, action, target_type, target_id, changes jsonb,
  reason, created_at; index (space_id, created_at desc); retention 90 days.

Changes to existing tables:

- `chats`: `space_id` (CASCADE), `category_id` (SET NULL), `position`, `topic`,
  `slowmode_seconds`, `nsfw`, `user_limit`, `permissions_synced`; CHECKs tie `space_id` to the
  space types and keep `invite_code`, `direct_key`, `group_settings`, `channel_settings`,
  `community_id` NULL for space rows.
- `chat_members` for space channels = lazy read state only: role 'member', joined_seq 0 (except
  rows written by the conversion to keep converted history private), never `left_at`, never
  `hidden`. New columns `notify_level`, `last_sent_at` (slowmode).
- `messages`: `mention_everyone bool`, `mention_role_ids uuid[]`, and a partial index
  `(chat_id, seq) where mention_everyone or mentions <> '{}' or mention_role_ids <> '{}'` for
  cheap unread-mention counts.

## S1 — Permissions

`packages/shared/src/permissions.ts`, pure, used by server and clients. 31 flags in an int4
(bit 30 = ADMINISTRATOR, bit 31 unused): VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS, ATTACH_FILES,
ADD_REACTIONS, USE_EXTERNAL_EMOJI, MENTION_EVERYONE, MANAGE_MESSAGES, READ_MESSAGE_HISTORY,
SEND_POLLS, CREATE_INVITE, CHANGE_NICKNAME, MANAGE_NICKNAMES, KICK_MEMBERS, BAN_MEMBERS,
MODERATE_MEMBERS, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_SPACE, VIEW_AUDIT_LOG, MANAGE_WEBHOOKS,
MANAGE_EMOJI, CONNECT, SPEAK, VIDEO, STREAM, MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS,
PRIORITY_SPEAKER, ADMINISTRATOR.

Discord's algorithm: owner → all; base = @everyone | member roles; ADMINISTRATOR → all; channel
overwrites applied @everyone → roles (OR of deny, then OR of allow) → member; no VIEW_CHANNEL →
0; text channels drop voice bits, voice channels drop text-only bits; a timed-out member loses
send, react, voice and mention bits. Hierarchy: an actor may act on a member only when their
highest role is above the target's (owner above everyone); role editors cannot grant bits they
lack. `ChatSummary.spacePermissions` carries the viewer's bits; clients recompute them from the
viewer-neutral `Space.roles`, `ChatSummary.overwrites` and `Space.me.roleIds`, so a role edit is
ONE broadcast to the Space room, never per-member work.

## S1 — Access, read state, unread

- `getChatAccess` for a space channel: lock/load the chat, load the viewer's `space_members`
  row with role ids and the channel's overwrites, compute the bits; no VIEW_CHANNEL (or not a
  member) → 404. The `chat_members` row is used when it exists, otherwise a synthetic one
  (joined_seq 0). Every existing guard (`assertCanSend`, `requirePermission`, edit/delete
  rules) keeps working on the mapped `ChatPermissions`; bits without a boolean (attach, react,
  polls, mention everyone) are checked with `requireSpaceBit`.
- Writes that need a row (mark read, notification level, mute, slowmode) upsert it.
- Unread for a channel without a row: activity after the member's `joined_at`. Unread counts
  and mention counts are capped (100) and use the `(chat_id, seq)` indexes, so they never scan
  history.
- `GET /api/chats` excludes space channels; `GET /api/chats/:id` and message/pin/search-by-chat
  routes serve them (clients depend on it for unknown-chat events).

## S1 — Realtime fan-out

- Rooms per socket: `user`, `session`, direct/group/broadcast chats as today, plus one
  `space:<id>` per Space. There are **no per-channel rooms for space channels** (a member of 200
  Spaces with 50 channels each would otherwise hold 10 000 rooms per socket).
- Every node keeps a **Space registry** for the Spaces its local sockets belong to: roles,
  channels with their overwrites, owner, and each local member's role ids, versioned by
  `spaces.perm_version`. It is loaded when the first local socket of a Space connects and
  dropped when the last leaves; changes publish `space:invalidate` on the cluster bus and every
  node reloads.
- The Socket.IO adapter is extended so `chat:<id>` of a space channel is a **virtual room**: on
  each node it resolves to the local sockets in `space:<spaceId>` whose member can view the
  channel. All existing `emitToChat` / `fx.toChat` / `fx.messageNew` call sites therefore work
  for space channels unchanged, across nodes.
- Typing in space channels goes only to sockets that have the channel open (`space:focus`
  joins one real room `chat-focus:<id>`), not to the whole Space.
- Member join/leave/update events go to sockets that have the member list open
  (`space-members:<id>` room) in large Spaces, and to the Space room in small ones.
- Presence is never broadcast to Spaces: clients subscribe presence for the member rows they
  render (existing `presence:subscribe`, privacy rules unchanged).

## S1 — Push and mentions

Mention grammar: `@{<userId>}`, `@{everyone}`, `@{here}`, `@{role:<roleId>}`. `@everyone`,
`@here` and non-mentionable roles need MENTION_EVERYONE. Notification level chain: channel
row → member → Space default ('mentions' by default). Push targets are computed after commit in
batches: mentioned users, members of mentioned roles, everyone for `@everyone` (streamed in
pages of 1 000, capped at `PUSH_SPACE_ALL_CAP`), members whose level is 'all'; each target is
checked for VIEW_CHANNEL, mute and DND.

## S1 — API (all under `/api`)

`GET|POST /spaces`; `GET|PATCH|DELETE /spaces/:spaceId`; `POST /spaces/:spaceId/leave`;
`POST /spaces/:spaceId/transfer-ownership`; `GET /spaces/:spaceId/channels`;
`POST /spaces/:spaceId/channels`; `PATCH /spaces/:spaceId/channels/positions`;
`PATCH|DELETE /spaces/:spaceId/channels/:chatId`;
`PUT|DELETE /spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId`;
`POST /spaces/:spaceId/channels/:chatId/sync`; categories (CRUD, positions, overwrites);
roles (CRUD, positions); `GET /spaces/:spaceId/members` (keyset paged, `q` search);
`POST /spaces/:spaceId/members/batch`; `GET|PATCH /spaces/:spaceId/members/me`;
`PATCH|DELETE /spaces/:spaceId/members/:userId` (nickname, roles, timeout, kick);
`PUT|DELETE /spaces/:spaceId/members/:userId/roles/:roleId`; bans (list, ban, unban); invites
(list, create, revoke); `GET /spaces/:spaceId/audit-log`; invite preview/join gain kind
`space`. Literal paths are registered before parameter paths.

## S1 — Events

Server → client: `space:upsert {space}` and `space:removed {spaceId, reason}` (user rooms,
viewer-specific); `space:updated {spaceId, changes}`, `space:channels-changed {spaceId}`
(client refetches channels with jitter), `space:member-joined|left|updated` (Space room or
member-list room, see fan-out). Client → server: `space:focus {chatId | null}`,
`space:members-subscribe {spaceId | null}`. Reconnect procedure gains "refetch `GET /spaces`
and the open Space's channels".

## S1 — Communities conversion

At boot, under the migration lock, behind `SPACES_MIGRATE=on|dry|off`, idempotent through
`spaces.legacy_community_id`, one transaction per community: Space with @everyone and an
`Admin` role (owner/admins), members, categories "Text channels" / "Voice channels", the
announcement group → `#announcements` (members cannot send), linked groups → text channels
(history kept for their members; community members who never joined get future-only read rows;
members an admin removed get a member overwrite denying VIEW_CHANNEL), a `General` voice
channel, invite codes moved to `space_invites`, then the community rows are deleted. Existing
`community_*` system messages keep rendering. `pg_dump` runs right before; the release stops
all instances, converts, then starts them (no mixed old/new processes).

## S2 — Web

Discord layout built from the existing card panes: Space rail (icons, unread dot, mention badge,
create/join) | channel sidebar (Space header menu, collapsible categories, text rows bold when
unread with mention badges, voice rows with occupants) | channel view (the existing
`Conversation` in cozy mode with a channel header, topic, pins, slowmode, read-only footer) |
member list (virtualised, grouped by hoisted roles in small Spaces, alphabetical with search in
large ones). Settings overlay: Overview, Roles (permission editor), Channels, Members, Invites,
Bans, Audit log, Delete; channel settings: Overview, Permissions (tri-state overwrites).
Profile card shows nickname, roles and "member since". Phone layout: rail + sidebar as the list,
channel as the detail, member list in a sheet. The Communities tab, stores and realtime handlers
are removed; `/communities/*` redirects to `/spaces`.

## S3 — Voice

Self-hosted LiveKit as its own systemd service, signalling proxied same-origin under `/livekit/`
on all three domains, media on UDP 7882-7892 (mux) + TCP 7881, TURN through the existing coturn.
`voice_states` (PK user_id) is truth, kept by a signed webhook plus a reconcile job (leader).
Joining is `voice:join` → short-lived token with grants derived from the permission bits
(CONNECT, SPEAK, VIDEO, STREAM, server mute/deaf). Server mute, deafen, move and disconnect use
the LiveKit server API. LiveKit itself scales out with Redis when one SFU is not enough. The
router must forward TCP 7881 and UDP 7882-7892 to the host (user action).

## Open items

- Discovery of public Spaces (`is_discoverable`) and vanity invite codes: schema now, UI later.
- Custom emoji, multiple reactions, threads: P4 as before (permission bits reserved).
- Above ~10 nodes the replicated presence registry and the single bus channel should be sharded
  by user id / Space id (Valkey sharded pub/sub); the interfaces are built so that is local.
