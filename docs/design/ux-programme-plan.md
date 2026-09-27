# Enbox UX programme: Discord-style profiles, chat themes & animations, Spaces (with LiveKit voice)

## Context

Enbox is a WhatsApp-style messenger (chats, groups, communities, broadcast channels, status, mesh calls) live since 2026-09-26 on enbox.enfinito.cloud / enbox.cloud / enbox.dev (one Ubuntu host, systemd, nginx, coturn, PostgreSQL 18). The user wants to combine WhatsApp/Messenger and Discord UX:

1. **Profiles like Discord**: banner/cover, animated avatar and banner, bio, pronouns, profile colours, availability (online / idle / do-not-disturb / invisible) with a custom status, and a profile-card popover wherever a user appears.
2. **Chat themes & animations**: theme presets and bubble styles, animated backgrounds, custom uploaded background image/GIF/video, selectable message animations, reduced-motion support.
3. **Spaces** (Discord servers): the current communities evolve into Spaces with categories, text channels, voice channels, roles/permissions, settings, invites, member list, moderation and notification levels.

This plan is the outcome of 16 read-only code maps (workflow `wf_6fa6e399-8ad`) and a design panel of 3 designs → 3 judges → synthesis → 28 code-verified claims (workflow `wf_53251b9e-ee9`). The full 115k-char design is the reviser's result at `~/.claude/projects/D--Projects-enbox/edef1036-…/subagents/workflows/wf_53251b9e-ee9/journal.jsonl` (line 29); execution step 0 copies it into the repo as `docs/design/ux-programme.md`. Nothing in the repo has been changed yet.

## Decisions taken with the user

| Topic                 | Decision                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Communities vs Spaces | Communities **evolve into Spaces**; existing ones are **migrated** (announcement group → admin-only `#announcements`, linked groups → text channels, community owner/admins → an `Admin` role). |
| Voice engine          | **Self-hosted LiveKit SFU** for voice channels; the mesh engine stays for 1:1/group calls.                                                                                                      |
| Order                 | **Profiles + chat themes first** (each deployed alone), then Spaces.                                                                                                                            |
| Name                  | **Spaces** (tab, rail, `/spaces`).                                                                                                                                                              |
| Chat themes           | **Shared theme + private override** (Messenger-style shared theme with a system message; personal wallpaper/animation override synced across my devices).                                       |
| Custom emoji          | **Yes, final phase** (P4): per-space emoji, picker category, multiple reactions per person.                                                                                                     |

### Assumptions taken in the design (change any on review)

- Canonical link domain `PUBLIC_URL = https://enbox.dev` (invite/profile links; the other two domains keep working).
- `about` (140 chars, WhatsApp one-liner, chat surfaces) and `bio` (190, profile card "About me") both exist.
- Space member lists are visible to every co-member (Discord rule; today community lists are admin-only — documented privacy change).
- Pins in space channels: 50, no replace-oldest. `@everyone`/`@here` off for `@everyone` role by default; `@here` counts like `@everyone` in v1.
- Migrated linked groups keep history private: community members who never joined a group see only new messages; members an admin removed stay excluded (deny-VIEW overwrite).
- Voice e2e stays local (`E2E_LIVEKIT=1`); CI gets a real-Postgres job and a built-SPA CSP check instead.
- Out of scope now: threads, E2EE, multi-instance scaling, Capacitor builds.

## Architecture (verified against the code)

- **Space channels are `chats` rows** with new `ChatType` `space_text` / `space_voice` + `space_id`, `category_id`, `position`, `topic`, `slowmode_seconds`, `nsfw`, `user_limit`. `chats_type_ck` (`schema.ts:313`) becomes a superset; new CHECKs tie `space_id` to the space types and force `invite_code` NULL (`findInvite` 404s any chats hit, `invites/routes.ts:54-56`). Never reuse `channel` (anonymised senders) or `group` (group pipelines). Compile-forced sites: `chatKindOf` (`utils.ts:73-76`), `chatKindOfRow` (`services/chats.ts:157-159`), `systemMessageAllowed` (`services/system.ts:35-49`); `computeChatPermissions` is NOT compile-forced (falls into the group block at `utils.ts:153-169`) → explicit first branch. The ~49 silent `type ===` sites are swept with shared predicates `isSpaceChatType` / `hasReceipts` / `showsSenders` / `inChatList` (explicit list in the design, D1).
- **Access is materialised**: one `chat_members` row per (space channel, member with VIEW_CHANNEL) — `getChatAccess` (`services/chats.ts:381-411`), visibility SQL and rooms keep working. Rows follow the broadcast-channel rule (`joined_seq 0`, marks = `last_seq`; `membership.ts:122-128` extended), removed by a new `revoke` membership kind. Space channels take the channel-like fast path in `insertMessage` (no delivered marks/ticks, named senders), are excluded from `GET /api/chats` (only the no-`chatIds` list; `GET /api/chats/:id` and `chatPreviews` still serve them — clients depend on it), the Chats tab, badges and `markDeliveredOnConnect`; new room `space:<id>` joined before `counted = true` in `io.ts`.
- **Permissions**: 31-flag int4 bitfield (bit 30 = ADMINISTRATOR), Discord's algorithm in pure `packages/shared/src/permissions.ts` (base = @everyone | roles; overwrites @everyone → roles → member; VIEW_CHANNEL gate; text/voice bit masks; timeout strips send/voice bits; hierarchy `canActOn`). `ChatSummary.spacePermissions` is server-computed and client-recomputable from viewer-neutral `Space.roles` + `overwrites` + `me.roleIds`, so a role edit is one room broadcast, not members × channels `chat:upsert`s. Bits map into the unchanged `ChatPermissions` via a new first branch of `computeChatPermissions`; other bits are checked with `requireSpaceBit` / `hasPerm`.
- **Voice**: LiveKit v1.13.7 as a native systemd service; nginx proxies `/livekit/` (prefix stripped) on all three domains so CSP `connect-src 'self'` covers it (plus explicit `wss://` self origins for older Safari); `rtc.udp_port: 7882-7892` (mux) + `rtc.tcp_port: 7881`, **no** `port_range_*` keys (they win over the mux); `rtc.turn_servers` → the existing coturn with `secret: ${TURN_SECRET}` (LiveKit mints HMAC creds itself). Server: `VoiceProvider` interface (LiveKit + Fake), token route, raw-body webhook mounted before the `/api` router (avoids `apiLimiter`), `voice_states` table (PK `user_id`) as truth, reconcile job (boot + 30 s). Mesh ↔ voice mutual exclusion via a new `services/busy.ts` advisory lock taken in `startCall`, `joinCall` and `voice:join` **after** every row lock (the existing `call_participants_one_joined_uq` cannot see `voice_states`).
- **Media**: pure shared `imageInfo.ts` (GIF/WebP/PNG-APNG/JPEG header parser + metadata stripper) used client-side for detection/poster and server-side in `POST /api/media` (verified dimensions, frame cap, decoded-pixel budget, EXIF/XMP stripped, `media.animated`). Animated avatars/banners require a poster; `avatarUrl`/`bannerUrl` stay static (poster) so every renderer and push icon stays static; `avatarAnimatedUrl`/`bannerAnimatedUrl` added; `Avatar` animates on hover/focus/profile card only, never under reduced motion or when the app is hidden. Every new media FK joins `jobs/mediaGc.ts:32-36` and `scrubDeletedUser`.
- **Presence**: `users.availability` (+`availability_until`) and `presence_note_*` columns; wire `Presence.state` ('online'|'idle'|'dnd'|'offline', never 'invisible') + `note`; invisible is byte-identical to offline (conditional `last_seen_at` write inside the existing `io.ts:102/104` gate AND the in-memory override ignored in `presence.ts:87-90`); auto-idle via `presence:activity`; DND gates push, in-app sounds and rings (`silentUserIds`). Never named "status" (that means stories).
- **Chat themes**: device-local prefs in `useUi` (theme preset, bubble style incl. `cozy`, message animation, reduce-motion, autoplay-animated); per-viewer `chat_members.theme` + `wallpaper_media_id` synced via `PATCH /chats/:id/prefs` → `chat:upsert`; shared per-chat theme as `chats.theme` + `ChatInfoChanges.theme` + `theme_changed` system message (gated by `canEditInfo`; direct chats withhold from a peer who blocked the actor). Rendering via CSS variables on the conversation root + a `ChatBackground` layer; enter animations keyed to live arrivals only (Virtuoso-safe).
- **Migration**: additive `0001…0005` files; communities → spaces conversion **awaited at boot** between `initDb` and `createApp` (jobs cannot gate readiness: `jobs/index.ts:39` is fire-and-forget), gated by `SPACES_MIGRATE=on|dry|off`, idempotent via `spaces.legacy_community_id`, `pg_dump` first, forward-fix-only after the first community converts; old tables dropped one release later behind a zero-row guard.

## Data model (per migration file)

- **0001_profiles** (P1): `users` + `banner_media_id`, `pronouns`, `bio`, `profile_color`, `accent_color` (hex CHECK), `availability` (CHECK), `availability_until`, `presence_note_text/emoji/expires_at` (+ partial indexes); `media` + `animated`, `frame_count`, `metadata_stripped`.
- **0002_chat_themes** (P2): `chat_members` + `theme jsonb`, `wallpaper_media_id`; `chats` + `theme jsonb` (shared theme).
- **0003_spaces** (P3a): `spaces`, `space_members` (nickname, timed_out_until, server_mute/deaf, notify_level, muted_until, suppress_everyone), `space_roles` (position, permissions int, hoist, mentionable, is_default; one default per space), `space_member_roles`, `space_categories`, `space_channel_overwrites` / `space_category_overwrites` (allow/deny, `(allow & deny) = 0`), `space_bans`, `space_invites` (code in the shared invite code space; max_uses/uses/expires_at), `space_audit_log`; `chats` space columns + CHECKs + `chats_space_idx`; `chat_members` + `notify_level`, `last_sent_at` (slowmode), partial `chat_members_joined_seq_idx`; `messages` + `mention_everyone`, `mention_role_ids`.
- **0004_voice** (P3c): `voice_states` (PK `user_id`; space_id, chat_id, session_id, participant_sid, self_mute/deaf, video, streaming, joined_at, connected_at).
- **0005_spaces_cleanup** (P3d, guarded): drop `communities`, `community_members`, `chats.community_id`, `is_announcement` and their CHECKs/indexes.
- **P4 reservations**: `space_emojis`, `message_reactions` PK → (message_id, user_id, emoji), threads as child chats.

Limits (in `packages/shared/src/constants.ts`): MAX_SPACE_MEMBERS 2 000, MAX_SPACE_CHANNELS 100, MAX_SPACE_ROLES 100, MAX_VOICE_CHANNEL_PARTICIPANTS 50, MAX_ANIMATED_AVATAR_BYTES 8 MiB, MAX_BANNER_BYTES 10 MiB, MAX_WALLPAPER_BYTES 15 MiB (video 25 MiB / 30 s), plus new `USER_RATE_LIMITS` (profileUpdate, spaceCreate, spaceJoin, mentionEveryone, voiceJoin…) and per-socket `SERVER_RATE_LIMITS` (voiceState, voiceSpeaking, presenceActivity).

## Contracts (shared package + normative docs, first in every phase)

- Routes (literal-before-param, mirrored in `api.ts:14-19` and `ARCHITECTURE.md:71-77`): `PUT /api/me/presence`, `PUT|DELETE /api/me/presence-note`; `GET|POST /api/spaces`, `GET /api/spaces/discover`, `GET|PATCH|DELETE /api/spaces/:spaceId`, `…/leave`, `…/transfer-ownership`, `…/channels` (+ `positions`, `/:chatId`, overwrites, `overwrites/sync`), `…/categories` (+ positions, overwrites), `…/roles` (+ positions), `…/members` (paged; `/me` before `/:userId`; `/:userId/roles/:roleId`), `…/bans`, `…/invites`, `…/audit-log`, `…/voice-states`; `POST /api/voice/token`; `GET /api/users/:userId/mutual-spaces`; invite preview/join gain kind `space`; `GET /api/config` gains `publicUrl`, `voice`, `limits`.
- Events: `presence:activity` (C→S); `space:upsert` / `space:removed` (user rooms), `space:updated` / `space:channels-changed` / `space:member-joined|left|updated` (space room); `voice:join|leave|state|speaking` (C→S), `voice:state` / `voice:speaking` (space room), `voice:disconnect` (user room); `rooms.space`; reconnect procedure gains "refetch spaces, open space channels, voice states".
- Models: `Presence.state/note`, `UserPublic` + animated/banner/bio/pronouns/colours/presence, `MediaAttachment.animated`, `ChatTheme`, `ChatSummary` + theme/wallpaper/space fields/`spacePermissions`/`notifyLevel`, `Space`, `SpaceRole`, `SpaceCategory`, `PermissionOverwrite`, `SpaceMember(Self)`, `SpaceInvite`, `SpaceBan`, `SpaceAuditEntry`, `VoiceState`, `VoiceJoinResult`; mention grammar `@{uuid}` | `@{everyone}` | `@{here}` | `@{role:uuid}`.
- Docs: `docs/ARCHITECTURE.md` (data model invariants, lock order with `spaces` at the communities level, fan-out rules incl. permission propagation, matrix rows, permissions matrix Space column, membership `revoke`, Spaces / Voice / Media / Presence sections, rate limits, jobs, reconnect), `apps/server/src/services/README.md` (spaces.ts, busy.ts, imageProbe rows), README env table.

## Phase plan (each phase: contracts + docs → parallel slices by file ownership → adversarial review → full checks → deploy)

### P1 — Profiles, animated media, availability, profile card (deploys alone)

- **S1 shared+docs**: `packages/shared/src/{constants,models,schemas,api,events,utils,imageInfo(+test),index}.ts`, ARCHITECTURE.md, services/README.md.
- **S2 server media**: `services/{uploads,imageProbe,media}.ts`, `modules/media/routes.ts` (probe → strip → verified dims), `jobs/mediaGc.ts`, `db/schema.ts` + `drizzle/0001_profiles.sql` (journal `when` > 1790328673116), `test/media.test.ts` (GIF/APNG/animated-WebP fixtures, frame cap, XMP absent, poster required, GC keeps banner).
- **S3 server profile+presence**: `services/users.ts` (banner join, gates, scrub), `modules/users/{routes,socket,presence}.ts` (presence routes register only `presenceEffect`+`meUpdatedEffect`), `realtime/{io,presence}.ts` (conditional last_seen write, `socketIdle`), `modules/push/notifications.ts` + `modules/calls/service.ts` (DND), `jobs/{presenceExpiry,register}.ts`, `modules/system/routes.ts`; tests in `test/accounts/{profile,presence}.test.ts` (43 `online:` assertions gain state/note; invisible ≡ offline; DND), `test/services/users.test.ts`, push/calls DND cases, `test/smoke.test.ts`.
- **S4 web media+avatar**: `lib/{media,api,serverConfig}.ts`, `components/ui/{Avatar,Popover}.tsx` (Popover promoted from `features/conversation/Popover.tsx`), `common/UserAvatar.tsx`, `hooks/useMediaQuery.ts` (`useReducedMotion`), `stores/ui.ts`, `features/settings/profile/{avatar,banner}.ts` + `BannerCropDialog`/`BannerEditor`; tests `Avatar.test.tsx`, `banner.test.ts`.
- **S5 web profile+presence**: `ProfilePage` + Bio/Colours/Presence-note pages, `SettingsSectionPage` registry, `features/profile/{ProfileCard,ProfilePopover,ProfileCardHost,AvailabilityPicker}` (host in `AppShell`, bus `profile:open`), `NavRail` self avatar, `MessageRow` sender name/avatar + `RichText` mention triggers, member-list triggers, `lib/activity.ts`, realtime DND gate, `test/factories.ts`; `e2e/profile.spec.ts` (+ `gifFixture()` helper).
- **Verify**: animated GIF avatar static in lists / animates on hover / static under reduced motion; stored GIF has no XMP (hexdump); invisible user shows frozen last-seen and emits no `presence:update` on reconnect; DND → no push/sound, silenced call card; `npm run lint/typecheck/test/build`, e2e; deploy with 0001.

### P2 — Chat themes & animations (deploys alone)

- **S1 shared+server**: constants/models/schemas (`ChatTheme`, `chatThemeSchema` strict enums+hex), `schema.ts` + `0002_chat_themes.sql`, `modules/chats/service.ts` (`updatePrefs` theme/wallpaper; `PUT /chats/:id/theme` shared theme modelled on `setDisappearing` with `theme_changed` system message), `services/{media,summaries,users,system}.ts`, `jobs/mediaGc.ts`, docs; tests: prefs validation (raw CSS → 400, foreign media 404, video > 30 s 400, poster required, `chat:upsert` to me only), shared theme → `chat:updated` + system message, GC keeps wallpaper, scrub nulls.
- **S2 web appearance**: `stores/ui.ts` (+ new `ui.test.ts`), `features/appearance/{presets,useChatAppearance,ChatBackground,ChatThemeSheet,pickers,appearance.css}`, `index.css` (reduce-motion attribute clamp, `--animate-msg-*`, bubble-style rules), `ChatsSettingsPage` groups + sub-pages.
- **S3 web conversation**: `ConversationPane` (vars on the root, `ChatBackground`), `ChannelPane`, `MessageInfoSheet`, `MessageList`/`MessageRow`/`CozyMessageRow`, `lib/arrivals.ts` (+test), `stores/messages.ts`, `realtime/messages.ts`, header/info-panel entry points; `e2e/chat-themes.spec.ts` (device pref persists; per-chat theme on a second session; reduced motion → poster).
- **Verify**: two accounts see a shared theme + system message; my devices sync a private wallpaper; hidden tab pauses video; 1 000-message chat with animated wallpaper stays smooth; no re-animation on scroll-back/reconnect; deploy with 0002.

### P3a — Spaces core (server; ships with P3b in one deploy)

- **S1 shared**: `permissions.ts` (+test), constants, models, schemas, api, events, utils predicates + mention grammar, full docs pass.
- **S2 schema + ripple**: `schema.ts` + `0003_spaces.sql`; the D1 sweep across `services/{chats,summaries,watermarks,messages,system,membership,effects,invites}.ts` (fast path, `revoke`, `activate` rule, `deriveMentions` at both call sites, `messageUpdatedPayloads` space branch); `realtime/{io,hooks,emit}.ts` (`registerRoomSource`, `emitToSpace`, `fx.toSpace`); `modules/{chats,messages}/service.ts` (slowmode, ATTACH_FILES/ADD_REACTIONS/SEND_POLLS gates, 403s for delete/clear/timer in space channels); `modules/chats/socket.ts` (typing access cache, space types only); push space branch; `modules/users/{fanout,account,routes}.ts` (space rooms in `user:changed` targets incl. account deletion, mutual-spaces); `modules/invites/routes.ts`; `jobs/mediaGc.ts`.
- **S3 spaces module**: `services/spaces.ts` (`spacesForPairs`, `spaceUpsert`, `lockSpaceScope`, `loadSpacePermissionInputs`, `syncChannelAccess`, member add/remove, delete, audit), `modules/spaces/{routes,service,channels,roles,members,invites,hooks,socket}.ts`, `modules/index.ts`, fixtures, `test/spaces/{spaces,channels,roles,members,invites,mentions,permissions,deletion}.test.ts` (404-vs-403, literal precedence, limits, event order, row sync on grant/revoke, countQueries, no ticks, typing, slowmode, @everyone gating, `GET /api/chats` excludes vs `/spaces/:id/channels` includes, lock order).
- **S4 conversion + rollout**: `services/spacesMigration.ts` awaited in `index.ts`, `config.ts` (`SPACES_MIGRATE`, `APP_VERSION`), `test/spaces/migration.test.ts` (idempotent, history windows, removed members excluded, announcements read-only, invites converted, live call ended), web "Enbox was updated — reload" banner, **new `deploy/deploy.sh`** (the host script vendored: build, `pg_dump`, migrate-on-boot, health wait per release, rollback) + README deployment section.
- **Verify**: boot against a copy of the prod dump on local PG18 with `dry` then `on`, second boot converts 0; old `/join/<code>` previews kind `space`.

### P3b — Spaces web (ships with P3a)

- **S1 nav+store**: `tabs.ts` (`spaces` replaces `communities`), `useTabBadges`, `SpacesIcon`, `router.tsx` (+ `/communities/:id` redirect), `stores/spaces.ts` (+test), `realtime/spaces.ts` (+test), `stores/chats.ts` exclusions, `features/chats/links.ts` (`/spaces/<spaceId>/<chatId>`), `lib/bus.ts`, `lib/storage.ts`, factories.
- **S2 layout+channel**: `components/layout/SpacesView.tsx` (NavRail | SpaceRail 72 | ChannelSidebar 240 | main | Members aside ≥ 1280 px; phone rail+sidebar list, channel as detail, members in a Sheet; one `<main>`), `features/spaces/{routes,SpaceRail,ChannelSidebar,SpaceHome,ChannelPane,SpaceChannelHeader,PinsPopover,QuickSwitcher}`, `ConversationPane` (`export Conversation`, `variant='space'`, cozy forced), `Composer` + mention suggestions (members/roles/@everyone/@here), `RichText` pills, `MessageRow` (`showsSenders`), `realtime/messages.ts` (notify level, `/spaces` URLs).
- **S3 members+flows**: `MemberList` (virtualised, hoisted roles, presence for rendered rows), `MemberContextMenu`, `CreateSpaceModal` (template: `#general` + `General` voice), `DiscoverPage`, `InviteDialog`, `JoinInvitePage` kind `space`, profile card space context.
- **S4 removal + e2e**: delete `features/communities/*`, `stores/communities*`, `realtime/communities.ts`; `e2e/spaces.spec.ts` replaces `communities.spec.ts`; screenshots script, manifest shortcut.
- **Verify**: e2e; manual at 390/1024/1280 px; keyboard-only navigation; reload restores last channel; converted community shows `#announcements` read-only.

### P3c — Voice channels (deploys after P3a/P3b)

- **S1 contracts+config+infra docs**: shared voice models/schemas/events, `config.ts` `voice` block (explicit nested merge like `ice`/`vapid`), `/api/config.voice`, `docs/ops/livekit.md`, `.env.example`, README.
- **S2 server**: `0004_voice.sql`, `modules/voice/{provider,livekit,fake,service,state,socket,routes,webhook}.ts`, `app.ts` (raw webhook before `/api`), `services/busy.ts`, `modules/calls/service.ts` (busy lock after row locks; `mapDbErrors` kept), `modules/spaces/members.ts` (server mute/deafen/move/disconnect → `RoomServiceClient`), `jobs/voice.ts`, `lib/userLimit.ts`, `livekit-server-sdk` 2.19.1; `test/spaces/voice.test.ts` with the Fake provider (grants, CONNECT 403, user_limit, busy both ways incl. real-PG race, move, takeover, webhook 401/dedupe/stale session, forced leaves, reconcile), calls busy cases.
- **S3 web**: `livekit-client` 2.22.3 (`vendor-livekit` chunk, Vite `/livekit` ws proxy, sw bypass), `features/voice/{engine/LiveKitEngine,controller,VoiceChannelRow,VoiceDock,VoiceStage,VoiceSettingsMenu}`, `stores/voice.ts`, `realtime/voice.ts`, calls controller busy check, streams reuse, sidebar/member menu hooks, `AppShell`/`SpacesView` dock; unit tests with a fake Room; `e2e/voice-channels.spec.ts` gated by `E2E_LIVEKIT=1`.
- **S4 infra**: `deploy/livekit/livekit.yaml.tmpl` (guard: no `port_range_*`), `deploy/systemd/livekit.service`, `deploy/nginx/enbox-app.conf.snippet` (`location /livekit/`), `deploy/nft/enbox-livekit.nft`, `deploy/deploy.sh` LiveKit steps, CI job (real Postgres) + built-SPA CSP Playwright project.
- **Router (user action)**: forward **TCP 7881** and **UDP 7882–7892** to 192.168.20.237 (no overlap with coturn 3478/50000–50999 or Asterisk 10000–20000). TURN-relay hairpin verified on staging before enabling; fallback = LiveKit embedded TURN/TLS on 5349.
- **Verify**: `livekit-server --dev` + two browsers locally; server mute silences within 1 s; reload rejoins; kill enbox → media continues, occupancy restored by the reconciler; prod: `wss://enbox.dev/livekit/rtc/validate` 200 with a token, TURN-forced client connects, no CSP violations.

### P3d — Moderation, settings, notifications, invites, cleanup

- **S1 server**: kick/ban (bounded message purge)/unban/timeout/nickname/role assign-edit-reorder with hierarchy/overwrite put-delete-sync/invites/audit log/discover/transfer/delete; timeout in `getChatAccess`; pins cap 50 for space types; push level chain (`chat_members.notify_level ?? space_members.notify_level ?? spaces.default_notify_level`, `PUSH_SPACE_ALL_CAP`); audit retention job; tests.
- **S2 web settings**: `features/spaces/settings/*` (full-screen layout: Overview, Roles with tri-state permission editor, Members, Bans, Invites, Audit log, Delete; channel Overview/Permissions/Delete), `Reorder` (keyboard-first), `NotificationSettingsModal`, tri-state `Choice`.
- **S3 moderation UX + e2e**: timeout banner, NSFW gate, kicked/banned toasts; `e2e/spaces-settings.spec.ts`, `e2e/spaces-notifications.spec.ts`.
- **S4 cleanup**: `0005_spaces_cleanup.sql` (guarded), delete `modules/communities/*`, `services/communities.ts`, community tests/fixtures/contracts, final docs pass; deploy pre-check `count(*) from communities = 0`.

### P4 — Later (hooks reserved): custom space emoji (`<:name:uuid>` tokens, picker `customEmojis`), multi-reactions (PK change, `myReactions[]`), threads, per-space avatars.

## Infrastructure & deployment

- New tracked `deploy/` directory (today only `Dockerfile`/`docker-compose.yml` exist; the live host uses systemd + `/opt/enbox/deploy.sh`): `deploy.sh`, `livekit/livekit.yaml.tmpl`, `systemd/livekit.service`, `nginx/enbox-app.conf.snippet`, `nft/enbox-livekit.nft`, `docs/ops/livekit.md`.
- Env additions (`/etc/enbox/enbox.env`, `.env.example`, README): `PUBLIC_URL`, `SPACES_MIGRATE`, `LIVEKIT_URL=/livekit`, `LIVEKIT_HOST_URL=http://127.0.0.1:7880`, `LIVEKIT_API_KEY/SECRET`, `VOICE_TOKEN_TTL_SEC`, `APP_VERSION`, `VITE_WS_ORIGINS`.
- Each phase deploys with the existing script (P1, P2) or the vendored one (P3+); every deploy is preceded by `pg_dump` and verified with the external smoke test used so far plus the phase checks above.

## Execution approach

- Ultracode: each phase runs as a Workflow — S1 contracts/docs first, then implementation slices in **git worktrees** with explicit file ownership (the slices above), integration merge, then an adversarial review pass (finders by lens → 3-vote refutation → fixes) and the full `lint / typecheck / test / build / e2e` gate before deploy.
- Step 0 (before P1): commit the design as `docs/design/ux-programme.md` and the ARCHITECTURE.md/README updates for P1.
- Existing tests that change are enumerated in the design per slice (e.g. presence assertions, single-reaction tests in P4, communities tests deleted in P3d).

## Verification (end to end)

Per phase as listed; overall: `npm run lint && npm run typecheck && npm test && npm run build && npm run e2e` on every slice; real-Postgres CI job for lock-order/race/conversion cases; built-SPA CSP check in Playwright; production checks after each deploy: `/api/health`, the two-account realtime smoke test, and the phase-specific manual checks (animated avatar behaviour, invisible presence, shared theme, converted community, voice join through nginx + TURN).

## Main risks and mitigations

- Community → Space conversion is one-way: `pg_dump` immediately before, `dry` run against a prod dump copy first, boot-time conversion so a failed run never serves traffic, forward-fix policy documented.
- Silent chat-type branches: explicit sweep list + shared predicates + tests asserting `GET /api/chats` excludes and receipts are absent for space channels.
- Media GC data loss: every new FK in the GC list with a test per column.
- LiveKit behind NAT/TURN hairpin: staged verification with a TURN-forced client; embedded TURN fallback.
- Fan-out cost at 2 000 × 100: client-side permission recompute, VIEW-delta-only row sync, no per-member work on send, budgets checked with `countQueries` and a real-PG case.
