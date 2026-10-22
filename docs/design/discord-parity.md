# Discord parity plan

Status: approved plan, written 2026-10-22 on branch `claude/discord`. Supersedes the open parts of `ux-programme-plan.md`. Builds on `spaces-at-scale.md`.

## Goal

The user's words: "our ui is more like whatsapp, make it like discord. we need every single feature from discord no matter what. even the profiles, theme, profile and banner decoration, profile page decoration, everything."

This plan takes every item in the Discord gap matrix and puts it in exactly one workstream of one wave, unless it is genuinely impossible (see Exclusions). The order is chosen so that:

- the first deploy already looks like Discord: one guild rail, Home/DM sidebar, user panel, settings overlay, Discord themes;
- the second makes Space channels read like Discord (rows, markdown, composer, menus);
- the third ships the profiles and decorations the user named (popout, full profile, editor, decorations, effects, nameplates, frames, name styles, banners, per-server profiles, server tags);
- scale blockers (64-bit permissions, Valkey limits, paged chat sync) are cleared before the heavy features that need them;
- every wave deploys on its own, pushed and redeployed straight after its full test run.

### How the plan was chosen

Three candidate plans were scored 0-10 on: completeness against the gap matrix, dependency order, disjoint file ownership per wave, realism for parallel AI agents, early visible progress, and scale safety.

| Candidate | Score | Why |
| --- | --- | --- |
| UI-first (16 waves, shell first) | 8.6 | Covers every gap id. Wave 1 swaps the shell, wave 2 the message look, wave 3 the profile and decoration work the user named. Contracts step per wave and mostly disjoint ownership. Weak spots: 64-bit permissions and Valkey limits wait until wave 4, `modules/applications/**` is owned by two different features (member applications in W12 and OAuth apps in W14), and ChatBar/MessageList collect many touchesShared edits. |
| Risk/scale-first (18 waves) | 7.6 | Strongest scale story (perms64, Valkey truth, bounded sync in W1; CONCURRENTLY index builds; z-index table; rolling-deploy-safe migrations). But W1 mixes the permission rewrite with the whole shell, voice comes before Discord message rows, the phone tab rework waits until W6/W17, and it excludes the overlay items the user asked for. |
| Dependency-first (16 waves) | 7.0 | Clean producer-before-consumer order, LiveKit started early so port problems surface early, useful seams (UserAvatar/UserName, MARKDOWN message flag). But W1 ships nothing the user can see, Discord rows only arrive in W4 and profiles in W9, and several workstreams carry 20+ features. |

The UI-first plan is the spine. Grafted from the others:

- From risk/scale-first: `lib/clusterLimit.ts` (Valkey buckets) lands in W1 contracts so W1-W3 features never add per-process limits; reconnect resync gets 0-3 s jitter in W1; a z-index token table in W1 contracts; every migration is additive and safe for the two-process rolling restart; big index builds (trigram, reaction PK swap) run CONCURRENTLY from post-deploy scripts; a lint rule bans raw bitwise operators on permission values once they are BigInt; `uuidv7()` defaults for new tables where PGlite supports it; voice modes named `direct`, `relay`, `mesh`, `off`.
- From dependency-first: `UserAvatar` / `UserName` seams created in W1 so W3 decorations reach every row without touching row files; a `MARKDOWN` message flag next to the chat-type rule, so DMs can switch to the Discord dialect when they move to ChatBar in W7; LiveKit installed and smoke-tested in W4 (behind `VOICE_MODE=off`) so port and TURN problems surface four waves before voice ships.
- Fix: membership applications move to `modules/spaceApplications/**` and `features/spaceApplications/**`, so W14 owns `modules/applications/**` alone.

## Decisions

1. **Navigation.** The desktop NavRail tabs (Chats/Updates/Spaces/Calls/Settings) and the separate SpaceRail merge into one guild rail: Home, unread DM bubbles, separator, Spaces and folders, then Add / Discover / Download. Phones get Servers / Messages / You in W1 and Notifications in W5. Old URLs (`/chats`, `/updates`, `/calls`, `/settings/:section`, `/communities/*`) keep working and redirect where needed, so push and service-worker links never break.
2. **Home = DMs.** `/chats` and `/chats/:chatId` stay Home's URLs; `/channels/@me` redirects to them. With no DM open, Home shows the Friends page (a placeholder until W7). `/` opens the last location.
3. **Status stories stay** behind a "Stories" row in the Home sidebar and as the avatar story ring in profile popouts. Server routes stay for the APK. Discord's own "status" is the existing custom status (presence note).
4. **WhatsApp broadcast Channels stay** behind a "Broadcasts" row in the Home sidebar (`/updates/channels/:id` kept). After W10 an opt-in owner tool converts one into a Space announcement channel, posting under a channel webhook identity so authors are not revealed. Nothing is auto-converted.
5. **Communities.** Dead web code (`features/communities/**`, `stores/communities.ts`, `realtime/communities.ts`) is deleted in W1. The server `/communities` router and `spacesMigration` stay until an APK with Spaces ships.
6. **Bubbles.** Space channels always use Discord rows (Cozy or Compact). DMs and groups move to Discord rows in W7 with ChatBar. "Classic bubbles" stays an Appearance option for DMs and groups only. Spaces never show ticks or message info: the server returns 404 for message info and skips watermark work there.
7. **Calls tab** leaves navigation. DM calls become inline panels in the chat (W9). The call log stays at `/calls` from a Home "Call history" row.
8. **Settings tab** becomes a full-screen User Settings overlay over the background location, opened from the user-panel gear, Ctrl+, or the You tab.
9. **Friends build on contacts.** An accepted friend implies a contact row, so the existing "contacts" privacy levels also cover friends. Phone contacts live on as "Saved contacts".
10. **Groups.** New groups from the DM flow are Discord group DMs (10 members max, no admins). Existing big WhatsApp groups keep their admin UI and get an opt-in "Convert to Space".
11. **Message semantics in Spaces follow Discord:** no edit window, single-confirm removal with `message:removed`, no star/info/select/delete-for-me/reply-privately/location/contact. DMs keep tombstones for the APK. Starred messages become Bookmarks.
12. **Markdown.** Discord dialect for `space_*` chats and for any message with the `MARKDOWN` flag (set by ChatBar). Old messages keep their WhatsApp rendering. One parser in `packages/shared` for web, push previews and search.
13. **Permissions move to 64 bits in W4:** BigInt in shared, int8 columns, decimal strings on the wire next to the legacy 31-bit ints for the APK. All new Discord bits are added at once.
14. **Reactions move to Discord's model in W6** (many per user, per-emoji chips, `emoji_id`, `burst`), with denormalised counts and delta events. The old replace route and `myReaction` stay for the APK.
15. **Everything Discord sells is free.** No Nitro, Basic, boosts or server subscriptions as paid products. Their perks ship free; `perksOf(space)` always returns the top tier; limits come from operator config through `/api/config`. The Shop is a free Collectibles gallery; Quests and Orbs are free in-app achievements; gifting is a "suggest a cosmetic" card.
16. **Voice.** Self-hosted LiveKit (systemd on enfinitos1, proxied same-origin under `/livekit/`), `voice_states` in Postgres as truth, signed webhooks plus a leader reconcile job. `VOICE_MODE`: `direct` when TCP 7881 / UDP 7882-7892 are forwarded; `relay` (LiveKit TURN/TLS on 443 through an nginx stream SNI split, plus coturn with a widened relay range disjoint from Asterisk RTP) when they are not; `mesh` (existing CallEngine, capped at 8) if LiveKit is not installed; `off` hides voice and keeps text-in-voice.
17. **Desktop** is web-first. A thin Tauri shell (W16) adds tray, taskbar flash, global push-to-talk, game detection, an always-on-top overlay window and clips. In-game overlay injection is approximated by that overlay window.
18. **Cosmetic art.** Original procedural CSS/SVG/canvas cosmetics ship in W3 so nothing waits on art. Licensed or commissioned APNG/WebP packs can be dropped into `apps/web/public/cosmetics` later with no code change. No Discord assets, names or branding.
19. **Themes.** Light, Ash, Dark, Onyx plus gradient and custom themes. Dark is the default for new accounts (pending user confirmation). The Enbox violet brand stays.
20. **IDs** stay UUIDs; new tables default to `uuidv7()` where Postgres 18 and PGlite both support it. No snowflake migration.

## Principles

- **Visible every wave.** Each wave ships something the user can see and is pushed and redeployed straight away. Discord look on the existing card-pane layout (`.card-pane`, `--pane-gap`, per-pane tone tokens), and no divider lines (remove leftovers when a file is touched).
- **Contracts first.** Each wave starts with one contracts agent: shared types and zod schemas, the wave's single migration (`0006` onwards, one per wave), router entries, design tokens, bus events, and stub files and exports that the parallel streams fill in. Streams then edit only the files they own; `touchesShared` edits are small named hooks.
- **Fork, don't mutate.** Discord components are built beside the WhatsApp ones (DiscordMessageRow, ChatBar, DmHeader, GuildRail). DMs, groups and broadcast channels keep working until they move over on purpose.
- **Additive wire changes only.** New fields are optional; old routes and fields stay (`myReaction`, `PUT /reaction`, `Message.media`, 31-bit permission ints, the `call:*` mesh contract, `/chats`, `/updates`, `/calls` URLs). Contract tests replay the old client's requests in CI.
- **Rolling-deploy safe migrations.** The old process runs against the new schema during the two-process restart. Destructive steps (PK swaps, column drops) and long index builds run as post-deploy scripts with CONCURRENTLY.
- **No process-local truth.** Rate limits, cooldowns, tickets, viewer sets and counters live in Valkey (`lib/clusterLimit.ts` from W1). Durable state lives in Postgres. Timers are leader jobs that process batches with `FOR UPDATE SKIP LOCKED`. Per-process caches are derived state, invalidated over the cluster bus.
- **Bounded everything.** Keyset cursors, capped counts (SPACE_UNREAD_CAP style), LIMITs on mutuals and lists. Delta events (reactions, voice state, positions, cosmetics, member-list ops) instead of full re-serialisation or refetch storms. Jitter on resyncs after deploys. `@everyone` and role mentions are computed at read time, never materialised.
- **Permission checks on the server**, mirrored on the client through shared helpers. Any listing (search, bookmarks, mentions, pins) re-checks VIEW_CHANNEL / READ_MESSAGE_HISTORY from computed bits and never trusts the lazy `chat_members` join alone.
- **Cosmetics are catalogue ids** in `packages/shared/src/cosmetics.ts`, never URLs or CSS. A static frame shows by default and animates on hover or when a profile opens; nothing animates under reduced motion or when the app is hidden. Try-on previews stay on the client; Save sends one PATCH.
- **Third parties behind switches.** GIFs, embed players, oEmbed, SMTP, SMS, CAPTCHA, OAuth connections, IGDB, LLM, FCM, GeoIP, NSFW classifier, age vendor: each has a config switch, and the UI hides the feature cleanly when it is off. Every outbound fetch goes through the SSRF-safe fetcher.
- **Tests on the 16 GB box.** Agents run only targeted tests (vitest on touched files, server tests with PGlite on touched modules). The full web and server suites plus typecheck run once at the end of each wave, then a fix-up pass, then push and redeploy.
- **Accessibility ships with each feature:** roving focus, aria labels, reduced motion, focus rings. W16 does a final pass (saturation, contrast, screen reader).

## Waves

Each workstream line gives its owned files (disjoint inside the wave), the shared files it may touch with small hooks, its size, its acceptance, and its feature ids (generated from the feature matrix below). Deploy checks run on enbox.dev with both processes up, after push and redeploy.

### W1. Discord shell: guild rail, Home sidebar, user panel, settings overlay, themes

**Goal.** The app stops looking like WhatsApp: one guild rail with Home and Spaces, a Home/DM sidebar, the bottom-left user panel, a full-screen User Settings overlay, Light/Ash/Dark/Onyx and gradient themes, density and zoom, and Servers / Messages / You tabs on phones.

**Contracts (one agent).** Migration `0006_shell.sql`: `user_preferences(user_id PK, data jsonb, version bigint, updated_at)`. Shared: `UserPreferences` zod (appearance{theme, followOs, osDarkTheme, colorTheme, customThemes, density, chatFontPx, zoom, syncAcrossClients}, railItems, collapsedCategories; 32 KB cap), event `me:preferences`; `MUTE_DURATIONS`, `AVAILABILITY_DURATIONS`; `chatPrefsSchema.closed`; `MAX_PINNED_CHATS` 25 (direct/group only); `ChatSummary.memberPreview`. Server: `apps/server/src/lib/clusterLimit.ts` (Valkey fixed window + Lua token bucket), used by every new limit from now on. Web: pane tokens in `index.css` (`--rail-bg`, `--sidebar-bg`, `--chat-bg`, `--panel-bg`, `--user-panel-bg`, `--sidebar-w`, density vars) and empty theme blocks for `ash|dark|onyx`; a z-index token table (settings ~35, sheets 40, call 45, incoming 58); `routeHandle` flags `{sidebar:'home'|'space'|'none', aside, overlay}`; new `tabs.ts` TabIds; router entries (`/friends` placeholder, `/channels/@me` alias, `/settings` overlay over `state.backgroundLocation`, redirects for `/updates` and `/calls`); bus events `settings:open`, `quickswitcher:open`; `UserAvatar` and `UserName` seam components used by every row; stub `GuildRail`, `DmSidebar`, `UserPanel`, `TitleBar`, `NoticeBar`, `SettingsLayer` so AppShell composes them.

- **W1-A Guild rail** (L). Owns `apps/web/src/components/layout/GuildRail/**`, `features/spaces/SpaceRail.tsx`, `components/ui/Avatar.tsx`, `components/ui/FacePile.tsx`, `components/ui/RailTooltip.tsx`, `lib/dnd.ts`, `stores/spaceBadges.ts`, `apps/server/src/services/summaries.ts`. Touches `stores/spaces.ts` (mute-aware badge), `stores/preferences.ts` (railItems API). Acceptance: one scrollable 72px rail rendered once by AppShell; Home squircle with pill and up to 10 unread DM avatars; separator; 40px static Space squircles in synced railItems order (drag or Alt+Shift+Up/Down); Add/Join/Download at the bottom; portal tooltips; off-screen NEW/MENTIONS pills; muted Spaces dimmed with no dot; per-Space memoised badge selectors (render-count test); FacePile for icon-less groups. Features: `layout-shape-language`, `layout-rail-home-button`, `layout-rail-unread-dm-bubbles`, `layout-rail-separator`, `layout-rail-server-icons`, `layout-rail-pill-indicator`, `layout-rail-mention-badge`, `layout-rail-offscreen-mentions`, `layout-rail-drag-reorder`, `layout-rail-download-apps`, `servers-server-rail`, `notifications-mention-badges`, `notifications-unread-pill-server`, `notifications-dm-rail-stack`
- **W1-B Shell frame, title bar, responsive columns, rehoming** (L). Owns `components/layout/AppShell.tsx`, `SplitView.tsx`, `NavRail.tsx`, `BottomTabs.tsx`, `useTabBadges.ts`, `navigation.ts`, `MainEmpty.tsx`, `TitleBar/**`, `NoticeBar/**`, `lib/historyNav.ts`, `hooks/useLayoutBudget.ts`, `features/spaces/SpacesView.tsx`, `features/communities/**`, `stores/communities.ts`, `realtime/communities.ts`, `features/updates/**`. Touches `realtime/index.ts` (drop resyncCommunities, add 0-3 s resync jitter), `app/guards.tsx` (last-location default). Acceptance: CSS grid [rail | sidebar (`--sidebar-w`, resizable 200-420px) | main | optional aside] with the user panel under rail and sidebar; sidebars stay mounted between Home and Spaces; crossing 1024px no longer remounts lists; `useLayoutBudget` turns right panels into drawers; 36px title bar with location label, working back/forward, Help, Inbox placeholder and version-reload notice; `/` opens the last location; phone tabs Servers/Messages/You; `/updates` and `/calls` redirect into Home rows; dead Communities web code and its tests gone. Features: `layout-app-shell-columns`, `layout-title-bar`, `layout-back-forward-navigation`, `layout-channel-list-resize`, `layout-help-button`, `layout-mobile-overall`, `layout-mobile-bottom-tabs-legacy`, `layout-tablet-layout`, `layout-responsive-breakpoints`, `layout-notice-banners`, `layout-remember-last-location`, `customization-appearance-channel-list-resize`
- **W1-C Home / DM sidebar** (M). Owns `features/home/**`, `features/chats/**`, `apps/server/src/modules/chats/routes.ts`, `modules/chats/service.ts`. Touches `packages/shared/src/constants.ts` (dedupe MUTE copies). Acceptance: fixed-width DmSidebar with a "Find or start a conversation" faux input (emits `quickswitcher:open`), rows for Friends, Stories, Broadcasts, Call history, a "DIRECT MESSAGES +" label, pinned group, single-line 42px DmRows (status dot, bold when unread, custom status or "N Members", hover X to close); Close DM sets `hidden` without touching `cleared_seq`, `POST /chats/direct` unhides; one mute submenu with Discord durations everywhere; phone Messages list keeps previews, drops chips/FAB/kebab. Features: `layout-dm-sidebar-search`, `layout-dm-sidebar-nav-links`, `layout-dm-list-rows`, `layout-dm-pinning`, `layout-mobile-dm-list`, `social-dm-list`, `social-dm-mute-read`, `customization-notif-mute-durations`, `notifications-mute`
- **W1-D User panel, status menu, account switcher, You tab** (L). Owns `components/layout/UserPanel/**`, `features/profile/AvailabilityPicker.tsx`, `features/profile/PresenceNoteDialog.tsx`, `features/profile/presenceApi.ts`, `features/you/**`, `stores/auth.ts`, `lib/session.ts`, `apps/server/src/modules/push/routes.ts`. Touches `features/calls/controller.ts` (selfMute/selfDeaf hooks). Acceptance: user panel card with avatar + presence, name, custom status that swaps to username on hover, Mute and Deafen (device state, applied to mesh calls) with device chevrons, gear to the overlay; avatar opens the status menu (Online/Idle/DND/Invisible with 15m/1h/8h/24h/3d/forever, custom status, Switch Accounts, Copy ID in developer mode); up to 5 accounts with full store/socket reset; push subscriptions unique per (endpoint, user); phone You tab with self profile, Edit Profile, Set Status, gear. Features: `layout-user-panel`, `layout-user-panel-account-popout`, `layout-mobile-you-bar`, `layout-mobile-you-page`, `social-account-panel`, `social-presence-status`, `social-status-duration`, `social-custom-status`, `social-account-switcher`, `customization-mobile-you-tab`, `customization-user-panel`, `customization-account-switcher`, `customization-status-online`, `customization-status-custom`, `notifications-dnd-status`, `notifications-platform-multi-account`
- **W1-E User Settings overlay** (L). Owns `features/settings/UserSettingsLayer.tsx`, `routes.tsx`, `sections.ts`, `SettingsSectionPage.tsx`, `SettingsPane.tsx`, `ui.tsx`, `search/**`, `account/**`, `HelpPages.tsx`, `WhatsNew/**`, `content/changelog.ts`, `components/ui/UnsavedChangesBar.tsx`, `features/spaces/settings/SpaceSettings.tsx`. Touches `apps/web/vite.config.ts` (`__ENBOX_BUILD__`). Acceptance: `/settings/:section` opens a fixed layer over the still-mounted app; grouped nav USER SETTINGS / APP SETTINGS / WHAT'S NEW, red Log Out, copyable client-info block; search over a static index highlights the setting; Esc/X returns to the exact previous view; UnsavedChangesBar blocks close and shakes (also in SpaceSettings); Space settings nav gets group headers, no divider; right-click on the gear opens a section menu; What's New once per version; phone grouped list with drill-down. Features: `layout-settings-modal`, `layout-whats-new-changelog`, `servers-settings-navigation`, `servers-unsaved-changes-bar`, `social-settings-shell`, `customization-settings-shell`, `customization-settings-search`, `customization-settings-unsaved-changes-bar`, `customization-settings-cog-quick-menu`, `customization-settings-whats-new`, `customization-settings-client-info`, `customization-account-overview`, `notifications-platform-whats-new`
- **W1-F Themes, appearance, synced preferences** (L). Owns `stores/ui.ts`, `stores/preferences.ts`, `apps/web/index.html`, `features/settings/appearance/**`, `features/settings/accessibility/**`, `features/appearance/**`, `apps/server/src/modules/preferences/**`. Touches `index.css` (theme values inside the contract blocks). Acceptance: Light, Ash, Dark (Discord greys) and Onyx with distinct pane tones, keeping `.dark`; ~20 gradient themes and a custom 5-stop editor; Sync with computer with a chosen dark theme; Compact/Default/Spacious density, 12-24px chat font, 50-200% zoom; pre-paint script mirrors theme ids (no flash); `GET/PATCH /api/me/preferences` with atomic jsonb merge + version, `me:preferences` to the user room, clusterLimit bucket; devices converge unless sync is off; reduced motion and GIF autoplay move to Accessibility; persist migration v3 tested. Features: `layout-ui-refresh-2025`, `layout-ui-density`, `layout-themes-base`, `layout-chat-font-scaling-zoom`, `social-settings-sync`, `customization-appearance-base-themes`, `customization-appearance-sync-with-computer`, `customization-appearance-sync-across-clients`, `customization-appearance-color-themes`, `customization-appearance-custom-theme-editor`, `customization-appearance-ui-density`, `customization-appearance-chat-font-scaling`, `customization-appearance-zoom`, `customization-a11y-reduced-motion`, `customization-a11y-gif-autoplay`, `notifications-premium-app-themes`

**Deploy check.** One rail; Home opens DMs; an unread DM from a second account shows as a bubble and clears on read from another device; the user panel works and Mute/Deafen hold during a mesh call; the settings overlay opens and Esc returns to the same scroll position; Onyx applies with no flash on reload and syncs to a second browser within a second; phone shows Servers/Messages/You; `/updates`, `/calls` and push links still open; logs show jittered resyncs and no preference PATCH errors on either process.

### W2. Discord messages: markdown, rows, ChatBar, actions, channel sidebar and header

**Goal.** Space channels read and feel like Discord: flat Cozy or Compact rows, Discord markdown, a ChatBar with typing line and slowmode countdown, hover bar, context menus, pins popout, NEW divider and a 48px channel header. Profiles and menus inside a Space know the Space context.

**Contracts.** Migration `0007_messages.sql`: `messages.flags int default 0`, `messages.mention_here`, `chats.last_pin_at`, `chat_members.pins_seen_at`, `space_members.hide_muted_channels`. Shared: `MESSAGE_FLAGS` (SILENT, SUPPRESS_EMBEDS, MARKDOWN, EPHEMERAL, CROSSPOSTED, IS_CROSSPOST, SPAM_SUSPECT, HAS_LINK, HAS_MEDIA); `sendMessageSchema {silent, mentionRepliedAuthor, format}`; `MessageNewEvent.spaceId`; events `message:ephemeral`, `space:read`; `markUnreadSchema`, `spaceReadSchema`; `SpaceChannelInfo.private`; `SpaceMemberSelf.hideMutedChannels`; `MAX_PINNED_MESSAGES_SPACE` 250, `SPACE_MESSAGE_MAX_LENGTH` 4000; `showsReceipts()`; `canEditMessage` / `canDeleteForEveryone` branch on `isSpaceChatType`; `BUBBLE_STYLES += 'compact'`. Stubs: `packages/shared/src/markdown.ts` signatures (`parse`, `markdownToPlain`), `conversation/rows/DiscordMessageRow`, `composer/ChatBar`, Menu submenu prop types, and the `MessageList.renderRow` switch so streams plug in without editing each other's files.

- **W2-A Shared Discord markdown** (L). Owns `packages/shared/src/markdown.ts`, `markdown.test.ts`, `features/conversation/bubbles/DiscordMarkdown.tsx`, `bubbles/CodeBlock.tsx`, `bubbles/pills/**`, `features/safety/LeavingModal.tsx`. Touches `packages/shared/src/utils.ts` (previews use `markdownToPlain`), `apps/server/src/services/messages.ts` (`deriveMentions` ignores code spans and escapes). Acceptance: pure tokenizer for the Discord dialect (emphasis, headings, `-#` subtext, lists, quotes, inline and fenced code with language, ANSI, spoilers, escapes, masked links with anti-phishing, `<url>` suppression, `<t:unix:style>`, channel and app-link pills); dialect chosen by `space_*` type or the MARKDOWN flag, so old messages render unchanged; lazy highlight.js; push and previews get plain text; external links go through "Leaving Enbox" with trusted domains; ~150 table tests. Features: `messaging-markdown-emphasis`, `messaging-markdown-headers`, `messaging-markdown-subtext`, `messaging-markdown-lists`, `messaging-markdown-masked-links`, `messaging-markdown-autolinks`, `messaging-markdown-blockquotes`, `messaging-markdown-inline-code`, `messaging-markdown-code-blocks`, `messaging-markdown-ansi`, `messaging-markdown-spoilers`, `messaging-markdown-escaping`, `messaging-timestamps`, `messaging-mention-channels`, `messaging-link-safety`, `servers-channel-links-mentions`, `customization-chat-spoiler-display`, `notifications-safety-link-warnings`, `notifications-dev-channel-links`, `notifications-dev-mention-syntax`, `notifications-dev-timestamps`
- **W2-B Discord rows, dividers, system rows, welcome headers** (L). Owns `features/conversation/rows/**`, `lib/rows.ts`, `MessageList.tsx`, `CozyMessageRow.tsx`, `MessageRow.tsx`, `bubbles/SystemPill.tsx`, `bubbles/Meta.tsx`, `bubbles/appearance.ts`, `components/illustrations/**`. Touches `ConversationPane.tsx` (no wallpaper in Space channels), `features/settings/appearance/` (Message display page). Acceptance: DiscordMessageRow with no ticks or inline meta, "Today at 3:14 PM" with tooltip, "(edited)"; 7-minute grouping broken by replies; reply spine with mini avatar; gold mention rows; red NEW line; full-date dividers; icon system rows and deterministic welcome lines with Wave; `#channel` and DM welcome headers; collapsed "N blocked messages"; inline video and audio; skeleton rows; sprout badge for 7-day members; Compact mode and group spacing; bubbles still work in DMs. Features: `layout-message-display-cozy-compact`, `layout-empty-states-wumpus`, `messaging-mention-highlight`, `messaging-replies`, `messaging-jumbo-emoji`, `messaging-attachment-video`, `messaging-attachment-audio`, `messaging-jump-to-message`, `messaging-unread-divider`, `messaging-pending-failed`, `messaging-edited-marker`, `messaging-swipe-to-reply`, `messaging-blocked-messages`, `messaging-system-join`, `messaging-system-pin`, `messaging-system-other`, `messaging-channel-beginning`, `messaging-history-scroll`, `messaging-message-grouping`, `messaging-date-dividers`, `messaging-message-timestamps`, `messaging-display-modes`, `messaging-author-header`, `servers-system-messages`, `servers-new-member-badge`, `voice-call-system-messages`, `customization-appearance-message-display`, `customization-appearance-compact-avatars`, `customization-appearance-message-group-spacing`, `notifications-mention-highlight`, `notifications-new-messages-divider`, `notifications-safety-blocked-placeholder`
- **W2-C ChatBar, typing line, slowmode, ephemeral notices** (L). Owns `composer/ChatBar/**`, `composer/Autocomplete/**`, `composer/MentionSuggestions.tsx`, `lib/composerMentions.ts`, `lib/typing.ts`, `lib/outbox.ts`, `stores/messages.ts`, `realtime/messages.ts`, `apps/server/src/services/spaceRules.ts`, `services/messages.ts`. Touches `modules/push/spaceNotifications.ts` (skip SILENT, @here online only), `features/spaces/SpaceChannelPane.tsx` (mount ChatBar). Acceptance: rectangular ChatBar with "+" menu, GIF/sticker/emoji slots, "Message #name", growth to 50vh, type-anywhere focus; typing line with bouncing dots; slowmode countdown with an atomic server check (conditional UPDATE, `retryAfter` in the 429, forwards included); 4000 counter with Send as file; full-pane drop; "Replying to @X" with @ ON/OFF (server adds the author to mentions); `@silent`; `#channel`, `:emoji:` (lazy emojibase), `@time` and built-in suggestions; gating from `spacePermissions`; refusals become "Only you can see this" rows; the WhatsApp Composer stays for DMs and broadcasts. Features: `messaging-composer`, `messaging-character-limit`, `messaging-autocomplete`, `messaging-emoticon-conversion`, `messaging-spellcheck`, `messaging-send-button-setting`, `messaging-drafts`, `messaging-drag-drop-paste`, `messaging-media-keyboard`, `messaging-silent-messages`, `messaging-time-picker`, `messaging-mention-everyone-here`, `messaging-reply-ping-toggle`, `messaging-typing-indicator`, `messaging-slowmode`, `messaging-composer-states`, `messaging-ephemeral-messages`, `servers-slowmode`, `customization-a11y-send-button`, `customization-chat-emoticon-conversion`, `customization-chat-emoji-autocomplete`, `customization-chat-spellcheck`, `notifications-silent-messages`, `notifications-reply-ping`, `notifications-everyone-here`, `notifications-apps-ephemeral`, `notifications-premium-message-length`
- **W2-D Message actions, pins, mark unread, no receipts in Spaces** (L). Owns `MessageActionsHost.tsx`, `actions.ts`, `HoverBar.tsx`, `InlineEditor.tsx`, `DeleteMessageModal.tsx`, `PinsPopover.tsx`, `PinnedBar.tsx`, `bars/**`, `MessageInfoSheet.tsx`, `apps/server/src/modules/messages/service.ts`, `modules/messages/routes.ts`, `services/watermarks.ts`. Touches `MessageList.tsx` (mount bars), `modules/chats/routes.ts` (`POST /chats/:id/unread`). Acceptance: hover bar (3 recent reactions, React, Reply/Edit, Thread slot, More; Shift reveals Pin, Copy Link, Mark Unread, Copy ID, Delete without confirm); Discord context menu with Star/Info/Select/Delete-for-me/Reply privately hidden in Spaces; mark unread moves the read seq back and syncs devices; inline edit, no window in Spaces; single-confirm delete emits `message:removed`; message info 404 for `space_*`; `advanceRead` and `markDeliveredOnConnect` skip Space chats; pins popout (250 cap, new-pin dot); "N new messages since" and Jump To Present bars; Developer mode toggle. Features: `layout-header-pins`, `layout-chat-new-messages-bar`, `layout-developer-mode-ids`, `messaging-message-links`, `messaging-jump-to-present`, `messaging-new-messages-bar`, `messaging-mark-unread`, `messaging-no-read-receipts`, `messaging-pins`, `messaging-edit`, `messaging-delete`, `messaging-copy-text`, `messaging-copy-id-developer-mode`, `messaging-hover-action-bar`, `messaging-context-menu`, `messaging-mobile-action-sheet`, `servers-developer-ids`, `customization-advanced-developer-mode`, `notifications-new-messages-bar`, `notifications-mark-read-channel`, `notifications-mark-unread`, `notifications-read-state-sync`, `notifications-dev-developer-mode`, `notifications-dev-copy-id`, `notifications-dev-message-links`
- **W2-E Channel sidebar, 48px header, Space and category menus** (L). Owns `features/spaces/ChannelSidebar.tsx`, `spaces/sidebar/**`, `spaces/menus/**`, `spaces/SpaceChannelPane.tsx`, `components/layout/PaneHeader.tsx`, `components/ui/Menu.tsx`, `apps/server/src/modules/spaces/routes.ts`, `services/spaceSummaries.ts`. Touches `GuildRail/SpaceTile.tsx` (context menu hook), `modules/spaces/members.ts` (hide_muted_channels). Acceptance: 48px header with #, markdown topic modal, Threads/Bell/Pins/Members/Search slots, no divider; bell menu with durations and levels; lock/NSFW/invite icons (isPrivate derived on the server); category menu (mark read, collapse, collapse all, mute, edit, delete) with collapse synced through preferences; Hide Muted Channels; personal pinned channels; unread and mention jump pills; banner inside the header, collapsing on scroll; shared `spaceMenuItems` on tile and header; Menu supports submenus; `POST /spaces/:id/read` is one bulk upsert (≤500 channels) and one `space:read`. Features: `layout-rail-server-context-menu`, `layout-channel-sidebar-header`, `layout-channel-categories`, `layout-channel-rows`, `layout-channel-unread-jump-pills`, `layout-channel-pinning`, `layout-channel-hide-muted`, `layout-channel-header`, `layout-header-notification-bell`, `layout-member-list-toggle`, `servers-header-menu`, `servers-channel-list-banner`, `servers-server-context-menu`, `servers-leave`, `servers-mark-as-read`, `servers-channel-list`, `servers-categories`, `servers-text-channel`, `servers-channel-header`, `servers-channel-context-menu`, `servers-pin-channels`, `servers-hide-muted-channels`, `customization-notif-hide-muted-channels`, `notifications-hide-muted-channels`, `notifications-unread-channel`, `notifications-sidebar-unread-jump`, `notifications-mark-read-server`, `notifications-mark-read-folder-category`
- **W2-F Space-context profile popout and user menu** (L). Owns `features/profile/ProfileCard.tsx`, `ProfileCardHost.tsx`, `ProfilePopover.tsx`, `profile/model.ts`, `profile/open.ts`, `features/users/userMenu.ts`, `spaces/MemberActions.tsx`, `spaces/dialogs/NicknameDialog.tsx`, `TransferOwnershipDialog.tsx`, `ModerationDialogs.tsx`, `apps/server/src/modules/users/routes.ts`. Touches `stores/spaces.ts` (negative member cache, timeout expiry timer), `spaces/MemberList.tsx` (menu for everyone). Acceptance: `spaceId` flows from `profile:open` to the card; nickname, role chips with +/X for MANAGE_ROLES, both join dates, owner crown; mutual Spaces (`GET /users/:id/mutual-spaces`, LIMIT 100); one `userMenuItems` builder (Profile, Mention, Message, Change Nickname, Roles, Timeout/Kick with reason, Ban, Transfer Ownership, Copy ID) in messages, mentions and the member list, with a long-press sheet; mention pills show nicknames; role popout; a timeout lifts in the UI exactly at expiry. Features: `layout-user-context-menu`, `messaging-mention-users`, `messaging-mention-roles`, `messaging-profile-popout-from-message`, `servers-transfer-ownership`, `servers-owner-crown`, `servers-member-nickname`, `servers-profile-popout-server`, `servers-role-mentions`, `servers-member-context-menu`, `servers-timeout`, `servers-kick`, `social-server-nickname`, `social-user-context-menu`, `social-member-since`, `social-roles-in-profile`, `customization-profile-member-since`, `notifications-role-mentions`, `notifications-safety-timeout`

**Deploy check.** In a Space, `**bold**`, `||spoiler||`, a fenced `ts` block and `<t:…:R>` render the same in two browsers; push previews are plain text; the slowmode countdown matches the server 429; Mark Unread on one device moves the NEW line on the other; the pins popout lists pins; the tile menu marks a Space read; the popout from a message shows roles. A DM still shows bubbles and ticks. Postgres shows no lock waits on chats rows during sends.

### W3. Profiles and decoration

**Goal.** Discord-grade profiles: themed popout and full profile, a two-column editor with live preview, avatar decorations, profile effects, nameplates, frames, display-name styles, banner colour or GIF, markdown bio, badges, per-server profiles, server tags, gradient and holographic role colours, and a free Collectibles gallery.

**Contracts.** Shared `packages/shared/src/cosmetics.ts`: `AVATAR_DECORATIONS`, `PROFILE_EFFECTS`, `NAMEPLATES`, `PROFILE_FRAMES`, `DISPLAY_NAME_FONTS/EFFECTS`, `COSMETIC_COLLECTIONS`, `BADGES`, `TENURE_TIERS`, `SERVER_TAG_BADGES`, validators. `UserPublic`/`UserSelf` gain `globalName`, `avatarDecoration`, `profileEffect`, `nameplate`, `profileFrame`, `nameStyle`, `bannerColor`, `badges`, `serverTag`, `profileVersion` (always present, null when hidden). `SpaceMember` gains profile overrides; `SpaceRole` gains style and icon; `Space` gains tag. Schemas `updateProfileSchema`, `updateMyMemberSchema`, `updateSpaceSchema`; event `user:cosmetics` carrying the changed fields (no batch refetch). Migration `0008_profiles.sql`: users `global_name`, `avatar_decoration`, `profile_effect`, `nameplate`, `profile_frame`, `display_name_style jsonb`, `banner_color`, `flags`, `primary_space_id`, `profile_version`, `favorite_cosmetics`; `username_history`, `avatar_history`; `space_members` override columns; spaces tag columns with `tag_version`; `space_roles.color_secondary`, `color_style`, `icon_media_id`, `unicode_emoji`; `media.dominant_color`; mediaGc NOT EXISTS clauses and partial indexes. `buildUserPublic`, `toUserSelf`, `scrubDeletedUser` plumbing including the deleted branch. `useCosmeticMotion` signature. The W1 `UserAvatar` / `UserName` seams get decoration, nameplate and style slots.

- **W3-A Profile surfaces** (L). Owns `features/profile/**`, `features/contacts/UserProfilePage.tsx`, `components/profile/**`, `components/ui/BottomSheet.tsx`, `apps/server/src/modules/users/profile.ts`. Touches `app/router.tsx` (`/users/:userId`), `components/ui/Avatar.tsx` (LogoMark fallback, colorSeed = id). Acceptance: ThemedProfileSurface popout (primary→accent gradient, contrast-aware text, short header without banner, status thought bubble, BadgeRow with tooltips, clamped markdown bio, Note and Message slots, "..." menu); 600px full profile with About / Activity / Mutual Friends / Mutual Servers / Widgets tabs, the same component for `/u/:username` and `/users/:id`; draggable 50%/100% phone sheet; `GET /users/:id/profile` in a fixed number of queries; `profileVersion` lets cached cards skip refetches. Features: `social-legacy-username-badge`, `social-user-id-and-link`, `social-default-avatar`, `social-profile-theme`, `social-badges`, `social-tenure-badges`, `social-profile-popout`, `social-full-profile-modal`, `social-mobile-profile-sheet`, `social-share-profile`, `customization-profile-theme`, `customization-profile-badges`, `customization-profile-legacy-username-badge`, `customization-profile-popout`, `customization-profile-full`, `notifications-premium-badges`
- **W3-B Two-column profile editor and identity fields** (L). Owns `features/settings/profile/**`, `features/settings/settingsApi.ts`, `apps/server/src/modules/users/routes.ts`, `modules/users/username.ts`. Touches `packages/shared/src/schemas.ts` (bio 300, display name 32, username refine). Acceptance: Main/Per-server tabs, form left, sticky preview right (card + sample chat row + member row) fed by a draft store; one Save sends one PATCH, unsaved bar guards; recent avatars, zoom slider, banner colour defaulting to the avatar's dominant colour; bio toolbar, emoji, n/300; pronoun chips; display name can be cleared; `POST /me/username` needs the password, 2/hour via clusterLimit, 14-day `username_history` redirects, reserved names; "Choose GIF" appears once GIF_PROVIDER is set (W6). Features: `social-unique-username`, `social-display-name`, `social-avatar`, `social-profile-banner`, `social-about-me`, `social-pronouns`, `social-profile-editor`, `customization-account-username`, `customization-profile-display-name`, `customization-profile-editor`, `customization-profile-live-preview`, `customization-profile-pronouns`, `customization-profile-avatar`, `customization-profile-banner`, `customization-profile-bio`, `customization-shop-try-on`
- **W3-C Avatar decorations and nameplates everywhere** (M). Owns `components/cosmetics/AvatarDecoration/**`, `components/cosmetics/Nameplate/**`, `hooks/useCosmeticMotion.ts`, `public/cosmetics/decorations/**`, `public/cosmetics/nameplates/**`. Touches the `UserAvatar`/`UserName` seams. Acceptance: ≥24 original decorations at ~1.2x avatar size in every avatar (messages, member list, DM rows, user panel, popout, call tiles); hover-animate in lists, always in profiles, never under reduced motion; ≥12 nameplates behind member-list and DM rows; pickers grouped by collection with None and live preview; only posters load in long lists (500 decorated rows scroll at 60 fps). Features: `layout-nameplates-in-lists`, `social-avatar-decorations`, `social-nameplates`, `social-cosmetic-motion-settings`, `customization-profile-avatar-decoration`, `customization-profile-nameplate`
- **W3-D Profile effects, frames, display-name styles** (M). Owns `components/cosmetics/ProfileEffectLayer/**`, `ProfileFrame/**`, `StyledName/**`, `public/cosmetics/effects/**`, `public/cosmetics/frames/**`, `public/fonts/**`. Touches `conversation/rows/SenderName` (use StyledName). Acceptance: canvas/CSS effects play once on open, replay on hover, rest on a still frame; 9-slice frames around the popout and full profile; StyledName with lazy OFL Latin fonts, gradient/neon/toon/pop/gummy/prism effects, 1-2 colours, full in profiles and member lists, font-only in messages, role colour wins inside Spaces; a viewer toggle hides other people's styles. Features: `social-display-name-styles`, `social-profile-effects`, `social-profile-frames`, `customization-profile-effect`, `customization-profile-frame`, `customization-profile-display-name-styles`, `customization-a11y-display-name-styles-toggle`, `notifications-premium-profile-perks`
- **W3-E Collectibles gallery and free-perks policy** (M). Owns `features/collectibles/**`, `apps/server/src/modules/cosmetics/**`, `apps/server/src/config.ts`. Touches `features/home/DmSidebar.tsx` (Collectibles row), `docs/ARCHITECTURE.md` (free-perks convention). Acceptance: `/shop` gallery with category tabs, hero, cards that animate only when visible, details modal with try-on against my own card, Equip, favourites heart (shown on the full profile); a static Perks page; "Send as suggestion" cosmetic card in DMs with a text fallback for old clients; upload and message limits from env through `/api/config`; no lock icons anywhere. Features: `layout-home-nitro-page`, `layout-home-shop-page`, `social-shop-collectibles`, `social-wishlist`, `customization-profile-wishlist`, `customization-profile-collectibles`, `customization-shop`, `customization-shop-gifting`, `customization-perk-model`, `customization-billing-pages`, `notifications-premium-nitro`, `notifications-premium-nitro-basic`, `notifications-premium-gifting`, `notifications-premium-shop`, `notifications-premium-free-mapping`
- **W3-F Per-server profiles, server tags, role styles and icons** (L). Owns `features/spaces/settings/ServerTagPage.tsx`, `features/spaces/settings/RolesPage.tsx`, `features/spaces/serverProfile/**`, `components/cosmetics/TagPill/**`, `components/cosmetics/RoleName/**`, `apps/server/src/modules/spaces/members.ts`, `modules/users/spaceTag.ts`. Touches `stores/spaces.ts` (`useSpaceAuthor` overrides, `topIconRole`), `modules/spaces/routes.ts` (tag fields). Acceptance: per-Space avatar, banner, bio, pronouns, theme and cosmetics with "Use default" per field, used in messages, member list and popout ("View Main Profile"); tags of 2-4 characters with badge and colour, worn via `PUT /me/space-tag`, cleared on leave; clients cache tag definitions by `tag_version` so an edit never fans out to every wearer; solid/gradient/holographic role names, role icons, custom colour picker with contrast warning, role colour display mode; all free per-Space switches. Features: `servers-member-server-profile`, `servers-server-tag-wear`, `servers-server-tag-setup`, `servers-role-display`, `servers-enhanced-role-styles`, `servers-role-icons`, `servers-boost-perk-allocation`, `social-server-tags`, `social-per-server-profile`, `social-enhanced-role-styles`, `customization-profile-server-tag`, `customization-server-tag-config`, `customization-profile-per-server`, `customization-a11y-role-colors`, `customization-role-enhanced-styles`, `notifications-premium-boost-unlocks`

**Deploy check.** Account A equips a decoration, nameplate, effect, frame and name style; account B sees them in chat, member list and popout within a second via `user:cosmetics`, with no `POST /users/batch` storm in the network tab; reduced motion freezes them; a per-server avatar shows only inside its Space; leaving the Space clears a worn tag; a mediaGc dry run keeps the new media columns.

### W4. Foundations and navigation: 64-bit permissions, cluster scale, hotkeys, Quick Switcher, search, channel settings

**Goal.** Clear the scale and permission blockers every later wave needs, and add Discord's keyboard navigation: Ctrl+K, Alt+Up/Down, the Ctrl+/ sheet, header search with filters and a results panel, full-screen channel settings and drag reorder.

**Contracts.** `permissions.ts` moves to BigInt (PERM constants and every helper); the wire carries `permissions64` decimal strings next to the legacy low-31-bit ints. New bits: 4 thread bits, PIN_MESSAGES, BYPASS_SLOWMODE, SEND_TTS, SEND_VOICE_MESSAGES, USE_EXTERNAL_STICKERS, CREATE_EXPRESSIONS, USE_SOUNDBOARD, USE_EXTERNAL_SOUNDS, USE_VAD, SET_VOICE_CHANNEL_STATUS, USE_APPLICATION_COMMANDS, USE_EMBEDDED_ACTIVITIES, USE_EXTERNAL_APPS, REQUEST_TO_SPEAK, CREATE/MANAGE_EVENTS, VIEW_INSIGHTS, PRUNE_MEMBERS. EMBED_LINKS, READ_MESSAGE_HISTORY, PRIORITY_SPEAKER, MANAGE_WEBHOOKS, MANAGE_EMOJI and USE_EXTERNAL_EMOJI are un-reserved (enforced in their waves); text bits are no longer masked off voice channels; a lint rule bans raw bitwise operators on permission values. Migration `0009_foundations.sql`: int4→int8 on `space_roles.permissions` and both overwrite tables; deferrable unique `(space_id, position)` on roles; `chat_members.activity_at` + index; GIN on `messages.mentions` and `mention_role_ids`; `messages (sender_id, created_at)`. Post-deploy script `scripts/db/search-indexes.sql` builds the trigram GIN on `messages.text` CONCURRENTLY (search uses a bounded ilike until it exists). Every `assertUserLimit` caller and the express-rate-limit stores move onto `clusterLimit`; `modules/spaces/routes.ts` splits into `routes/channels.ts`, `routes/roles.ts`, `routes/space.ts`. Schemas `chatsPageSchema`, `switcherQuerySchema`, `searchQuerySchema`, `bulkOverwritesSchema`. Infra: `deploy/livekit/` templates installed with `VOICE_MODE=off` plus a token-mint smoke test, so port and TURN problems show up before W8.

- **W4-A Permission enforcement, roles page, role tools** (L). Owns `features/spaces/settings/roles/**`, `spaces/permissionLabels.ts`, `stores/spaces.ts`, `apps/server/src/services/spaceAccess.ts`, `realtime/spaceRegistry.ts`, `modules/spaces/routes/roles.ts`. Touches `services/spaceRules.ts` (EMBED_LINKS, READ_MESSAGE_HISTORY, location/contact refused in Spaces, forwards run send rules). Acceptance: all bit maths in BigInt on server and web; READ_MESSAGE_HISTORY gates pages, pins and jumps; roles page with Display/Permissions/Links/Manage Members tabs, permission search, Clear, Valkey-cached member counts, drag order; bulk add/remove members with one perm_version bump; View Server As Role banner; Duplicate Role; a contract test proves the old APK still reads the int fields. Features: `messaging-permission-gating`, `messaging-read-history-permission`, `servers-roles-page`, `servers-role-permissions`, `servers-role-hierarchy`, `servers-role-members`, `servers-view-as-role`, `servers-duplicate-role`, `servers-everyone-role`, `voice-permissions`
- **W4-B Cluster scale: chat paging, delta resync, read state, limits** (L). Owns `apps/server/src/modules/chats/listing.ts`, `services/summaries.ts`, `services/watermarks.ts`, `realtime/presence.ts`, `cluster/presenceRegistry.ts`, `jobs/auditPurge.ts`, `jobs/memberCountFlush.ts`, `stores/chats.ts`, `realtime/chats.ts`, `realtime/index.ts`. Touches `services/effects.ts` (spaceId in `message:new`), `realtime/messages.ts` (patch unloaded Space aggregates instead of `refreshChat`). Acceptance: `GET /api/chats?limit&before` keyset on `activity_at`; `GET /api/chats/changes?since` deltas; unread counts stop at 101; the open chat resyncs first; unknown Space messages patch badges with no `GET /chats/:id`; presence carries a mobile flag; the 50-channels-per-category cap; audit-log retention job; `spaces.member_count` counted in Valkey and flushed by the leader (no hot row on join); 2,000 simulated reconnects keep p95 `GET /chats` under 300 ms. Features: `layout-dm-list-ordering`, `layout-read-state-sync`, `servers-limits`, `social-mobile-indicator`
- **W4-C Global hotkeys, shortcut sheet, keyboard message navigation** (M). Owns `lib/hotkeys.ts`, `features/shortcuts/**`, `features/conversation/keyboard/**`, `hooks/useRovingFocus.ts`. Touches `AppShell.tsx` (mount registry), `HelpPages.tsx` (link to the sheet). Acceptance: one registry aware of the overlay stack that ignores inputs; Alt+Up/Down, Alt+Shift (unread), Ctrl+Alt (Spaces), Ctrl+Shift+Alt (mentions); Esc / Shift+Esc mark read; Ctrl+P/I/U/F/E/K; F6 cycles regions; Ctrl+/ sheet generated from the registry; roving tabindex on rail, sidebars and messages with E/R/P/+/Backspace/Alt+Enter on the focused message; browser-reserved combos documented. Features: `layout-shortcuts-modal`, `layout-shortcuts-navigation`, `layout-shortcuts-panels-chat`, `layout-message-keyboard-navigation`, `messaging-mark-read`, `messaging-keyboard-shortcuts`, `messaging-message-keyboard-nav`, `customization-a11y-keyboard-navigation`, `customization-keybinds-defaults`, `notifications-unread-keyboard`
- **W4-D Quick Switcher and mobile Launchpad** (M). Owns `features/switcher/**`, `apps/server/src/modules/switcher/**`. Touches `app/RootLayout.tsx` (host). Acceptance: Ctrl+K with instant frecency recents; local results merged with a debounced `GET /api/switcher` (one bounded VIEW_CHANNEL-filtered query, LIMIT 20); `@ # ! *` prefixes; a phone edge Launchpad with recents and unreads. Features: `layout-quick-switcher`, `layout-quick-switcher-prefixes`, `layout-mobile-launchpad`
- **W4-E Message search** (L). Owns `features/search/**`, `apps/server/src/modules/search/**`, `packages/shared/src/searchQuery.ts`. Touches `SpaceChannelPane.tsx` (header SearchBox slot). Acceptance: a header box with `from:/mentions:/has:/before:/after:/during:/in:/pinned:/authorType:` suggestions and recents; results in the right aside ("1,234 Results", capped 5,000), Newest/Oldest/Relevant, grouped by channel, 25 per page, Jump; Space scope from computed visible channel ids with a VIEW_CHANNEL re-check (fixes the leak), and the starred listing fixed the same way; phone Media/Links/Files/Pins tabs. Features: `layout-header-search`, `messaging-search`, `messaging-search-filters`, `messaging-search-results`, `messaging-search-mobile-tabs`
- **W4-F Channel settings, overwrites, drag reorder** (L). Owns `features/spaces/channelSettings/**`, `spaces/dialogs/ChannelDialog.tsx`, `spaces/dialogs/CategoryDialog.tsx`, `spaces/sidebar/reorder.ts`, `apps/server/src/modules/spaces/routes/channels.ts`. Touches `ChannelSidebar.tsx` (drag handlers). Acceptance: full-screen channel and category settings (Overview/Permissions/Invites/Integrations/Delete) with the unsaved bar; role and member targets, search, X to remove, bits filtered by type, synced banner, a bulk overwrite PUT with one perm_version bump; Create Channel type cards and a private step with members and roles; Duplicate; deleting a designated channel returns 409; drag across categories and of categories with a sync prompt; `space:channels-changed` carries positions; Unicode and emoji naming tests. Features: `layout-channel-reorder-drag`, `servers-create-channel`, `servers-reorder-channels`, `servers-private-channels`, `servers-channel-permission-overwrites`, `servers-permission-sync`, `servers-channel-settings`, `servers-clone-channel`, `servers-delete-channel`, `servers-channel-naming`

**Deploy check.** Rehearse migration 0009 on a production snapshot first and time the int8 rewrite. Then: the installed APK still opens a Space and reads permissions; Ctrl+K finds a channel in an unloaded Space; search finds a word in a Space and a user with VIEW revoked gets nothing; restarting both processes spreads reconnect resyncs in the logs with no spike over the Postgres connection limit; Valkey rate-limit keys exist; the LiveKit token-mint smoke test passes.

### W5. Notifications, Inbox, bookmarks and reminders, folders, badges, Streamer Mode

**Goal.** Discord's notification model (server → category → channel → thread chain with overrides, role suppression, unread vs notify split, @here for online people only), the Inbox (For You / Unreads / Mentions / Bookmarks), the phone Notifications tab, reminders, poll durations, Space folders, tab title and app badges, and Streamer Mode.

**Contracts.** Migration `0010_notifications.sql`: `space_members` `suppress_roles`, `mobile_push`, `unread_setting`, `mute_new_events`; `chat_members.unread_setting`; `space_member_category_prefs`; `user_mentions` (direct mentions and reply pings only); `user_notifications`; `inbox_dismissals`; `message_reminders`; `messages.poll_expires_at` + `poll_closes`; `push_subscriptions.platform`. Shared: pure `resolveNotify()` used by web and server; `PushPayload {messageId, seq, conversationId, authorAvatar, actions, actionToken}`; Notification, InboxMention, Reminder types; events `notification:new`, `notification:seen`, `reminder:due`, `bookmarks:changed`; `UserSettings.pushInactiveTimeoutSec`; `POLL_DURATIONS`; `RailItem` folder schema in UserPreferences.

- **W5-A Notification settings model and Space push** (L). Owns `features/notifications/settings/**`, `spaces/dialogs/NotificationDialog.tsx`, `apps/server/src/modules/push/spaceNotifications.ts`, `modules/spaces/notificationPrefs.ts`, `services/spaceSummaries.ts`. Touches `stores/spaces.ts` (notifyLevelOf / mentionsMe through resolveNotify), `services/spaces.ts` (unread aggregate honours unread_setting). Acceptance: Space notification modal with mute durations, All/Mentions/Nothing, suppress @everyone/roles/highlights, mute new events, mobile push toggle, an overrides table for channels and categories, unread presets; the resolution chain channel → category → member → Space default is identical on client and server (shared tests); Space pushes carry the author avatar, a Discord title, a `?m=&mid=` deep link and a block filter; group notify levels honoured. Features: `servers-notification-settings`, `customization-notif-server-level`, `customization-notif-overrides`, `customization-notif-dnd-integration`, `notifications-server-notification-level`, `notifications-suppress-everyone`, `notifications-suppress-roles`, `notifications-mute-new-events`, `notifications-mobile-push-per-server`, `notifications-channel-overrides`, `notifications-server-default-notifications`, `notifications-unread-vs-notify-split`, `notifications-dm-group-notifications`, `notifications-profiles-gap`
- **W5-B Delivery: OS notifications, sounds, banners, push timeout, quick actions** (L). Owns `lib/notify.ts`, `public/sw.js`, `lib/push.ts`, `features/notifications/banners/**`, `features/settings/NotificationsPage.tsx`, `apps/server/src/modules/push/notifications.ts`, `push/sender.ts`, `push/actions.ts`. Touches `realtime/messages.ts` (notifyIncoming icon/url/block skip). Acceptance: OS notifications with the author avatar that open at the message; phone in-app slide-in banners; a per-sound toggle list with preview including the voice sounds; active-desktop detection through Valkey `active:<user>:<session>` keys (one MGET per batch) skips mobile pushes; Mark-as-read, Reply, Accept and Decline actions via HMAC tokens on `POST /api/push/action`; sw.js groups by conversation; an FCM HTTP v1 transport behind `FCM_SERVICE_ACCOUNT`, off by default. Features: `messaging-notification-quick-reply`, `voice-sound-notifications`, `customization-notif-desktop`, `customization-notif-push-timeout`, `customization-notif-sounds`, `customization-notif-mobile-push`, `notifications-desktop-os-notifications`, `notifications-mobile-push`, `notifications-push-inactive-timeout`, `notifications-push-quick-actions`, `notifications-in-app-banners`, `notifications-sounds`
- **W5-C Inbox popover and phone Notifications tab** (L). Owns `features/inbox/**`, `apps/server/src/modules/inbox/**`, `jobs/notificationRetention.ts`. Touches `TitleBar/InboxButton.tsx`, `components/layout/tabs.ts` (phone Notifications tab). Acceptance: Ctrl+I or the title-bar icon opens For You (keyset feed, 30-day leader purge), Unreads (per-channel cards with up to 5 messages via `POST /messages/peek`, check button, Mark All Read) and Mentions (`GET /me/mentions`, 7 days, GIN indexes, @everyone/role mentions computed at read time, VIEW_CHANNEL re-check, filters, Jump, X); the phone Notifications tab with an unseen count. Features: `layout-inbox`, `layout-mobile-notifications`, `messaging-inbox`, `messaging-inbox-mentions`, `messaging-inbox-unreads`, `messaging-inbox-for-you`, `notifications-inbox`, `notifications-inbox-for-you`, `notifications-inbox-unreads`, `notifications-inbox-mentions`, `notifications-mobile-notifications-tab`
- **W5-D Bookmarks, reminders, poll durations** (M). Owns `features/bookmarks/**`, `features/chats/StarredPane.tsx`, `bubbles/PollBody.tsx`, `composer/PollDialog.tsx`, `apps/server/src/modules/messages/bookmarks.ts`, `messages/polls.ts`, `jobs/reminders.ts`, `jobs/pollClose.ts`. Touches `MessageActionsHost.tsx` (Bookmark, Remind Me). Acceptance: "Bookmark Message" works in Spaces without a read row, keyset paging, devices sync via `bookmarks:changed`; Remind Me presets and custom time delivered once by a leader job (push + inbox + `reminder:due`); polls get 1h-2w durations, End Poll Now, results hidden until you vote, Remove Vote, per-answer emoji, a winner system message and a paged voter list in Spaces. Features: `messaging-polls`, `messaging-bookmarks`, `messaging-reminders`, `notifications-bookmarks`, `notifications-reminders`, `notifications-poll-ended`
- **W5-E Space folders** (M). Owns `apps/web/src/components/layout/GuildRail/**`. Touches `stores/preferences.ts` (railItems folders). Acceptance: drop a tile on a tile to make a folder; collapsed 2x2 mini grid, expanded tinted strip; combined pill and summed mentions from memoised selectors; Folder Settings (name, presets, hex); Mark Folder As Read loops the Space read endpoint in chunks; keyboard alternatives for every drag; folders sync across devices. Features: `layout-rail-folders`, `servers-folders`, `customization-appearance-server-folders`, `notifications-folder-unreads`
- **W5-F Badges, tab title, connection states, Streamer Mode** (M). Owns `features/chrome/**`, `features/streamer/**`, `components/layout/ConnectionBanner.tsx`, `components/layout/Splash.tsx`. Touches `stores/ui.ts` (streamerMode, unreadBadge prefs), `spaces/dialogs/InviteDialog.tsx` (mask codes). Acceptance: tab title "(N) Enbox | #channel | Space", canvas favicon dot and `navigator.setAppBadge` from one memoised count, title blink while unfocused; an "Enable desktop notifications" notice; splash tips; Streamer Mode hides personal info, invite codes and DM previews, can silence sounds and notifications, with a coloured banner and a keybind. Features: `layout-window-title-favicon`, `layout-taskbar-badge-tray`, `layout-loading-and-connection`, `layout-streamer-mode`, `social-streamer-mode`, `voice-streamer-mode`, `customization-notif-badge-flash`, `customization-streamer-mode`, `notifications-browser-permission-banner`, `notifications-app-badge`, `notifications-taskbar-flash`, `notifications-streamer-mode`, `notifications-platform-connection-state`

**Deploy check.** Two accounts in a Space: an @role with suppress roles on gives no push and no badge; @here reaches only online members; Inbox Mentions lists the mention; a reminder fires once across both processes; a folder syncs to a second browser; the tab title shows (1); push "Mark as read" clears the desktop badge. The reminders and pollClose jobs run only on the leader.

### W6. Expressions and rich media

**Goal.** Discord-style multiple reactions with chips and super reactions, custom Space emoji and stickers usable everywhere, one expression picker (GIFs / Stickers / Emoji), up to 10 attachments per message with mosaic, alt text and spoilers, stored embeds with click-to-load players, invite cards, forwarding with context, live markdown preview, built-in slash commands and TTS.

**Contracts.** Migration `0011_expressions.sql`: `message_reactions` gains `emoji_id` and `burst`, plus `message_reaction_counts` (backfilled in batches); the PK swap to `(message_id, user_id, emoji, burst)` runs as a post-deploy script (unique index CONCURRENTLY, then `ADD CONSTRAINT ... USING INDEX` in a short window); `space_emojis`, `space_stickers`; `messages.sticker_ids`, `messages.embeds jsonb`; `message_attachments`; `user_favorite_gifs`; mediaGc clauses. Shared: `ReactionSummary[]` on Message (`myReaction` kept); `message:reaction-add/remove/cleared` and `message:embeds` delta events; SpaceEmoji, Sticker, Attachment and Embed schemas with Discord limits; custom-emoji token in `markdown.ts`; `MAX_ATTACHMENTS_PER_MESSAGE` 10; `MAX_UNIQUE_REACTIONS` 20; config switches `GIF_PROVIDER` (tenor|klipy|giphy|off), `GIF_API_KEY`, `EMBED_PLAYERS`, `OEMBED_ALLOWLIST`. Server: `services/messages.ts` serializers split into reactions / attachments / embeds helper files so streams own separate files; CSP `frame-src` driven by config.

- **W6-A Multiple reactions, reactor lists, super reactions, reaction notifications** (L). Owns `bubbles/reactions/**`, `lib/optimistic.ts`, `apps/server/src/modules/messages/reactions.ts`, `services/messageReactions.ts`. Touches `realtime/messages.ts` (delta merge). Acceptance: per-emoji chips with counts, outline for my own, hover "+"; `PUT/DELETE /messages/:id/reactions/:emoji/@me` with the old replace route kept for the APK; counts denormalised in the same transaction and delta events instead of full `message:updated`; joining an existing reaction needs only VIEW_CHANNEL; paged reactor lists; moderator removal audited; super reactions rate-limited in Valkey with an animation that stops under reduced motion; double-tap react on touch; reaction push coalesced to once a minute per message. Features: `messaging-reactions`, `messaging-double-tap-react`, `messaging-reaction-list`, `messaging-reaction-moderation`, `messaging-super-reactions`, `messaging-reaction-notifications`, `customization-chat-emoji-reactions-display`, `customization-chat-tap-to-react`, `customization-notif-reactions`, `notifications-reaction-notifications`, `notifications-premium-super-reactions`
- **W6-B Custom emoji and stickers** (L). Owns `spaces/settings/EmojiPage.tsx`, `spaces/settings/StickersPage.tsx`, `bubbles/CustomEmoji.tsx`, `bubbles/StickerBody.tsx`, `features/expressions/popouts/**`, `apps/server/src/modules/spaces/expressions.ts`, `services/media.ts`. Touches `jobs/mediaGc.ts`. Acceptance: Space Emoji and Stickers settings (upload with crop and resize, rename, delete, role restriction, 250 emoji / 60 stickers free); `<:name:id>` and `<a:name:id>` at 22px or 48px jumbo, animated on hover or by pref; emoji from another Space work free for its members, gated by the destination's USE_EXTERNAL_EMOJI; emoji and sticker popouts with Join; sticker suggestion strip; default packs as static assets. Features: `messaging-custom-emoji`, `messaging-animated-emoji`, `messaging-emoji-popout`, `messaging-stickers`, `messaging-sticker-suggestions`, `servers-emoji`, `servers-stickers`, `customization-a11y-animated-emoji`, `customization-a11y-sticker-animation`, `customization-chat-sticker-suggestions`, `notifications-premium-emoji-anywhere`
- **W6-C Expression picker and GIFs** (M). Owns `features/expressions/picker/**`, `conversation/EmojiPickerPanel.tsx`, `apps/server/src/modules/gifs/**`. Touches `ChatBar/ChatBar.tsx` (picker buttons). Acceptance: one virtualised picker with GIFs | Stickers | Emoji tabs, Frequently Used, synced Favourites, a section per Space with a left rail, hover footer, skin tones, Ctrl+E/G/S; the GIF tab goes through the `/api/gifs` proxy (Valkey cache, per-user limit) with trending, categories and synced favourites; gifv pauses when unfocused; the tab is hidden when `GIF_PROVIDER=off`. Features: `messaging-emoji-picker`, `messaging-gif-picker`, `messaging-gif-favorites`, `messaging-gif-autoplay`
- **W6-D Upload tray and multi-attachment messages** (L). Owns `composer/UploadTray/**`, `lib/sendMedia.ts`, `lib/upload.ts`, `bubbles/MediaBody.tsx`, `bubbles/AttachmentMosaic.tsx`, `conversation/Lightbox.tsx`, `composer/VoiceRecorderBar.tsx`, `apps/server/src/modules/media/routes.ts`, `services/attachments.ts`. Touches `services/messages.ts` (attachments insert/serialize hook). Acceptance: up to 10 files plus text as one message; tray cards with progress, cancel, spoiler, edit modal (rename, alt text, crop/rotate) and remove; mosaic, SPOILER blur, ALT badge; text-file preview via Range; Lightbox gains Copy Image, Copy Link, Open in Browser, alt caption, swipe-down; a modal lists too-large files and 0-byte files are refused; `Message.media` stays `attachments[0]` for the APK; voice messages as a pill player with a 20-minute cap and the SEND_VOICE_MESSAGES bit. Features: `messaging-upload-tray`, `messaging-upload-limits`, `messaging-image-editing`, `messaging-attachment-images`, `messaging-media-viewer`, `messaging-attachment-files`, `messaging-attachment-alt-text`, `messaging-attachment-spoiler`, `messaging-voice-messages`, `customization-chat-media-display`, `notifications-safety-sensitive-blur-ui`, `notifications-premium-upload-limits`
- **W6-E Stored embeds, players, invite cards** (L). Owns `bubbles/embeds/**`, `bubbles/LinkPreviewCard.tsx`, `lib/linkPreview.ts`, `apps/server/src/services/linkPreviews.ts`, `services/embedResolver.ts`, `modules/linkPreviews/**`. Touches `apps/server/src/app.ts` (CSP frame-src). Acceptance: a post-commit resolver with bounded concurrency stores up to 5 embeds per message, honouring EMBED_LINKS, `<url>` and SUPPRESS_EMBEDS, re-running on edit and backfilling lazily; direct image/video/gifv links inline through the proxy cache; YouTube-nocookie, Vimeo, Twitch, Spotify and SoundCloud players load only on click and only when allow-listed; social adapters where configured; the author can X an embed; invite URLs become cards with live counts (batched, Valkey-cached); a Text & Images settings section. Features: `messaging-suppress-embeds`, `messaging-embeds-link`, `messaging-embeds-direct-media`, `messaging-embeds-video-players`, `messaging-embeds-music`, `messaging-embeds-social`, `messaging-invite-embeds`, `messaging-embed-settings`, `servers-invite-embed`, `customization-chat-embeds-link-previews`, `notifications-dev-link-embeds`, `notifications-dev-video-embeds`, `notifications-dev-suppress-embeds`, `notifications-dev-deep-links`
- **W6-F Forwarding, live preview, formatting toolbar, built-in commands, TTS** (M). Owns `conversation/ForwardDialog.tsx`, `ChatBar/preview/**`, `composer/commands/**`, `features/tts/**`, `apps/server/src/modules/messages/forward.ts`. Touches `ChatBar/ChatBar.tsx`. Acceptance: forward to DMs and channels with an optional comment and source context ("#channel • Space • time", Go to original) and per-target Space send rules; a highlight layer behind the textarea styles markdown, mentions and emoji while spellcheck and IME keep working; selection toolbar and Ctrl+B/I/U; `/shrug /tableflip /unflip /me /spoiler /nick /tts /thread /giphy`; TTS gated by SEND_TTS, played with speechSynthesis per prefs, plus Speak Message. Features: `messaging-composer-markdown-preview`, `messaging-composer-formatting-toolbar`, `messaging-tts`, `messaging-builtin-commands`, `messaging-forwarding`, `customization-a11y-tts`, `customization-chat-rich-text-preview`, `customization-notif-tts`, `notifications-tts`, `notifications-apps-builtin-commands`

**Deploy check.** Three emoji on one message from two accounts show correct counts on both; the APK still shows a reaction; a custom emoji from Space A works in Space B for a member of A; six images in one message render as a mosaic; a YouTube link plays only after a click; GIF search works with the key set and disappears with `GIF_PROVIDER=off`; the CSP header is right and the Valkey GIF cache is hit; the reaction PK swap script finishes without long locks.

### W7. Friends, DMs, message requests, group DMs, block, ignore, report

**Goal.** Discord's social graph: Friends page (Online / All / Pending / Blocked / Add Friend), requests with spam filtering, message requests and DM privacy, a 48px DM header with a docked profile panel, private notes and mutuals, group DMs capped at 10, Ignore, and reporting. DMs and groups move to Discord rows and ChatBar.

**Contracts.** Migration `0012_social.sql`: `relationships` (two rows per pair, pair advisory lock), `friend_invites`, `user_notes`, `user_ignores`, `reports` (evidence snapshot), `chat_members.request_state`, `chats.is_group_dm` and `invite_expires_at`, `space_members.allow_dms`, `users.is_system` plus a reserved SYSTEM user row. Shared: Relationship; events `relationship:upsert/remove`, `note:changed`, `ignores:changed`, `chat:request`; UserSettings `dmPolicy`, `dmSpamFilter`, `friendRequestsFrom`, `allowSpaceDms`, `friendOnlineNotify`; `GROUP_DM_MAX_MEMBERS` 10, `MAX_FRIENDS` 1000; `REPORT_CATEGORIES`; a `levelAllows` mapping where an accepted friend implies contact. Stub `services/friendSignals.ts` interface.

- **W7-A Relationships core and Friends page** (L). Owns `features/friends/**`, `stores/relationships.ts`, `realtime/relationships.ts`, `apps/server/src/modules/relationships/**`. Touches `services/users.ts` (friend counts as contact for privacy), `GuildRail/HomeTile.tsx` (pending badge). Acceptance: `/friends` with Online (default), All, Pending (badge), Blocked and Add Friend, each with search and "ONLINE — n" headers; rows with Message, More, Accept/Ignore/Cancel; simultaneous requests become one friendship; "not found" looks the same for missing, deleted or blocking users; request and accept send push plus a For You item; friend nicknames and favourites; presence subscriptions batched (≤1000); illustrated empty states. Features: `layout-friends-page`, `layout-friends-row-actions`, `layout-friends-pending`, `layout-friends-add-friend`, `layout-friends-empty-states`, `layout-friend-nicknames-favorites`, `social-friend-nicknames`, `social-friends-list`, `social-add-friend`, `social-friend-requests`, `social-friend-request-note`, `social-remove-friend`, `social-favorite-friends`, `customization-profile-friend-nickname`, `notifications-friend-request-notifications`
- **W7-B Friend spam, request privacy, invite links, online alerts, wave** (M). Owns `apps/server/src/services/friendSignals.ts`, `modules/friendInvites/**`, `jobs/friendInvitePurge.ts`, `features/friendInvites/**`, `settings/privacy/FriendRequestSettings.tsx`, `features/home/WavePrompt.tsx`. Touches `cluster/presenceRegistry.ts` (offline→online hook). Acceptance: requests from strangers with young accounts or high request rates (Valkey counters) land in a collapsed spam section with no push; who-may-send settings (everyone, friends of friends, Space members); 7-day invite link and QR that make the friendship directly; Contact Picker matching on Android Chrome (verified phones only); friend-online toasts deduped with Valkey SET NX across processes; "Wave to X" on new empty DMs. Features: `layout-dm-wave-prompt`, `layout-friend-online-notifications`, `social-friend-request-spam`, `social-friend-request-settings`, `social-friend-invite-links`, `social-contact-sync`, `social-friend-online-notifications`, `customization-notif-friend-online`, `customization-social-friend-requests`, `notifications-safety-friend-request-privacy`, `notifications-safety-friend-request-warning`
- **W7-C Message requests, DM gate, spam filter, Space DM privacy** (L). Owns `apps/server/src/modules/requests/**`, `services/dmGate.ts`, `features/requests/**`, `settings/privacy/MessagingPermissions.tsx`, `spaces/dialogs/SpacePrivacyDialog.tsx`. Touches `services/messages.ts` (insertMessage calls dmGate), `modules/chats/service.ts` (openDirectChat). Acceptance: a first DM from someone who is not a friend and shares no Space is refused with an ephemeral notice; with a shared Space and an allowing policy it becomes a pending request (no push, not in `GET /chats`, not counted); Message Requests with Requests and Spam tabs, Accept/Ignore/Block/Report, replying accepts; spam heuristics on Valkey counters; per-Space DM toggles with "apply to existing Spaces" as one bounded UPDATE; a safety card on stranger DMs. Features: `layout-dm-message-requests`, `messaging-message-requests`, `messaging-spam-filter`, `servers-privacy-settings`, `servers-dm-spam-protection`, `social-message-requests`, `social-dm-spam-filter`, `social-dm-permissions`, `social-dm-safety-alerts`, `customization-social-dm-spam-filter`, `customization-social-server-dms`, `notifications-safety-message-requests`, `notifications-safety-dm-spam-filter`, `notifications-safety-dm-privacy`, `notifications-safety-safety-alerts`
- **W7-D DM header, docked profile panel, notes, mutuals, DMs on Discord rows** (L). Owns `features/dm/**`, `conversation/ConversationHeader.tsx`, `contacts/ContactInfoPanel.tsx`, `features/home/dmMenu.ts`, `apps/server/src/modules/users/notes.ts`, `modules/users/mutuals.ts`. Touches `ConversationPane.tsx` (DMs use DiscordMessageRow + ChatBar unless Classic bubbles). Acceptance: 48px DM header (@, status, call/video, pins, Add Friends to DM, profile toggle, search); docked 340px themed profile panel, remembered, with paged mutual Spaces and friends and a private Note (`note:changed` to my own devices only); Discord rows and ChatBar by default, Classic bubbles kept as an option; DM context menu (Profile, Call, Add Note, Nickname, Close, Invite to Space, friend actions, Ignore/Block, Copy ID); react or reply to a custom status (server snapshots the note). Features: `layout-dm-context-menu`, `layout-dm-header-toolbar`, `layout-dm-profile-side-panel`, `messaging-dm-chat`, `social-dm-profile-panel`, `social-mutuals`, `social-user-notes`, `social-status-reactions-replies`, `social-dm-header`, `customization-profile-notes`
- **W7-E Group DMs and Create DM popover** (M). Owns `features/groups/**`, `features/home/CreateDmPopover.tsx`, `contacts/NewChatPane.tsx`, `apps/server/src/modules/groups/**`. Touches `services/membership.ts` (is_group_dm add rules). Acceptance: the "+" popover with friend checkboxes, chips and "You can add N more"; one pick opens the DM, several create a nameless (auto-named) group DM capped at 10; any member adds friends, only the owner removes, no admin UI, 24 h invite links; inline rename; silent leave; bulk-leave inactive groups in chunks; existing large groups keep their admin UI plus "Convert to Space". Features: `layout-dm-create-dm`, `layout-dm-bulk-leave-groups`, `social-dm-create`, `social-group-dm`, `social-group-dm-name-icon`, `social-group-dm-owner`, `social-group-dm-invites`, `social-group-dm-leave`
- **W7-F Block, Ignore, lists, reporting, system account** (M). Owns `features/safety/reports/**`, `settings/privacy/BlockedPage.tsx`, `apps/server/src/modules/reports/**`, `modules/ignores/**`, `services/systemUser.ts`, `scripts/reportsReview.ts`. Touches `push/notifications.ts` and `push/spaceNotifications.ts` (one batched blockers/ignorers query per message). Acceptance: blocking also removes friendship and pending requests; pushes and mentions from blocked or ignored users are dropped in groups and Spaces; Ignore hides messages behind "Ignored message — Show" and silences notifications without telling the other person; Blocked and Ignored lists with search; a stepped report flow for messages, profiles, Spaces and events with an evidence snapshot that survives deletion and an "also block" step; an operator CLI lists reports; a SYSTEM-tagged read-only DM account. Features: `layout-friends-blocked-ignored`, `messaging-report-message`, `messaging-ignore-user`, `social-block`, `social-ignore`, `social-blocked-ignored-lists`, `social-report-user`, `customization-social-block-ignore`, `notifications-safety-block`, `notifications-safety-ignore`, `notifications-safety-blocked-list`, `notifications-safety-report-message`, `notifications-safety-report-profile`, `notifications-safety-report-other`, `notifications-safety-system-messages`

**Deploy check.** A sends B a friend request, B accepts on a phone, A gets a push and the Wave prompt; a stranger with no shared Space cannot DM; a shared-Space stranger's DM lands in Message Requests on all of B's devices; a 10-person group DM refuses the 11th add; an ignored user's Space mention sends no push; the installed APK still lists DMs, with request rows filtered out.

### W8. Voice channels on LiveKit

**Goal.** Drop-in voice channels like Discord, with the relay or mesh fallback until ports are forwarded: occupants in the sidebar, the voice view with grid, focus and controls, the Voice Connected panel, devices, mic test, processing, VAD and push-to-talk, per-user volume, voice moderation, AFK, and text chat inside voice.

**Contracts.** Migration `0013_voice.sql`: `voice_states` (PK `user_id`; indexes on `channel_id`, `space_id`, `last_active_at`); chats `bitrate`, `rtc_region`, `video_quality_mode`, `voice_status`; `call_participants.deafened`. Shared: VoiceState; events `voice:join` (ack `{url, token, state}`), `voice:leave`, `voice:update`, `voice:state`, `voice:moved`, `voice:disconnected`, `voice:activity`; `rooms.voice(channelId)`; `VOICE_BITRATE`, `VOICE_GRACE_MS`; `ServerConfig.voice {mode: 'direct'|'relay'|'mesh'|'off', url}`; DevicePrefs voice keys (devices, volumes, inputMode, ptt, profiles, userAudio map) with persist v4. Add `livekit-client` (web) and `livekit-server-sdk` (server). `deploy/livekit/` grows from the W4 smoke test to the full service: UDP mux range, TURN/TLS 443 via SNI, coturn relay range widened and disjoint from Asterisk RTP.

- **W8-A Voice server module, reconcile, moderation, AFK** (L). Owns `apps/server/src/modules/voice/**`, `jobs/voiceReconcile.ts`, `jobs/voiceAfk.ts`, `deploy/livekit/**`. Touches `modules/spaces/members.ts` (server mute/deaf; kick, ban, timeout call the voice disconnect hook), `modules/calls/service.ts` (busy check spans voice_states). Acceptance: `voice:join` checks VIEW+CONNECT and the user limit under the chats row lock (MOVE_MEMBERS bypasses) and mints a short-lived token with grants derived from the bits; one voice connection per account with a takeover prompt; signed webhook plus leader reconcile keep voice_states true; rejoin within 20 s of grace; move, disconnect, server mute/deafen through RoomService, audited; the AFK job moves idle members; priority speaker as a server-side attribute; `VOICE_MODE=mesh` falls back to CallEngine capped at 8. Features: `servers-afk-channel`, `servers-voice-channel`, `servers-voice-moderation`, `voice-channel-join`, `voice-channel-user-limit`, `voice-server-mute-deafen`, `voice-move-members`, `voice-disconnect-member`, `voice-priority-speaker`, `voice-afk-channel`, `voice-device-transfer`, `voice-reconnect-rejoin`, `voice-moderation-audit`
- **W8-B Voice view, grid, control bar, camera, pop-out and PiP** (L). Owns `features/voice/engine/**`, `features/voice/view/**`, `calls/ui/ParticipantTile.tsx`, `calls/ui/CallButton.tsx`. Touches `SpaceChannelPane.tsx` (replace the voice placeholder). Acceptance: clicking a voice row joins at once with no ringing (confirm when leaving a DM call); grid and focus layouts with green speaking rings, mute/deafen/LIVE icons, profile-colour avatar tiles, fading controls, adaptiveStream for off-screen tiles; Discord control bar; camera with simulcast and a 25-member video cap; full screen, Document PiP pop-out and an in-app mini player when navigating away; ARIA labels like "Name, muted"; browser permission help. Features: `layout-in-app-pip`, `layout-voice-channel-view`, `voice-speaking-indicator`, `voice-camera`, `voice-video-grid`, `voice-call-control-bar`, `voice-call-fullscreen-popout-pip`, `voice-web-browser`, `voice-accessibility`
- **W8-C Sidebar occupants, voice presence, per-user audio, voice menu** (L). Owns `features/voice/sidebar/**`, `features/voice/menus/**`, `stores/voice.ts`, `realtime/voice.ts`, `apps/server/src/modules/voiceStatus/**`. Touches `ChannelSidebar.tsx` (occupant rows), `GuildRail/SpaceTile.tsx` (speaker glyph). Acceptance: 24px occupant rows with state icons, "n/limit", a facepile when collapsed, a hover popout and drag-to-move for MOVE_MEMBERS; `voice:state` to the virtual chat room (private channels stay private), coalesced per channel during join waves; rail speaker glyph and tooltip; "In Voice" card on profiles; channel status set by connected members with the bit, cleared when the last leaves; Invite to Voice; per-user volume 0-200%, local mute and disable video remembered on the device; a warning when a blocked user is in the channel. Features: `layout-rail-activity-badges`, `layout-channel-voice-occupants`, `servers-voice-channel-status`, `voice-sidebar-participants`, `voice-channel-status`, `voice-per-user-volume`, `voice-user-context-menu`, `voice-presence-in-voice`, `voice-invite-to-voice`, `voice-blocked-ignored-in-voice`, `customization-voice-per-user-volume`, `notifications-safety-blocked-voice-warning`
- **W8-D Voice Connected panel, connection info, devices, processing** (L). Owns `features/voice/panel/**`, `calls/voice.ts`, `calls/engine/media.ts`, `features/settings/voice/**`, `settings/VoiceSettingsPage.tsx`. Touches `UserPanel/UserPanel.tsx` (panel slot above). Acceptance: VoicePanel above the user panel with status text, signal colour, channel link, noise toggle, Disconnect, Camera/Share; ping graph and transport/debug popout from getStats; global mute/deafen with sounds and a locked server-muted state; input/output pickers with hot-plug fallback, input 0-100% and output 0-200%; loopback mic test and a no-input warning; Voice Isolation / Studio / Custom profiles as a TrackProcessor (no mic re-acquire); in-app ducking; Reset Voice Settings. Features: `layout-voice-connection-panel`, `voice-connection-panel`, `voice-connection-info`, `voice-mute-deafen`, `voice-input-profiles`, `voice-noise-suppression`, `voice-echo-gain-processing`, `voice-devices-volume`, `voice-mic-test`, `voice-attenuation`, `voice-advanced-settings`, `customization-voice-devices`, `customization-voice-mic-test`, `customization-voice-processing`, `customization-voice-attenuation`, `customization-voice-advanced`
- **W8-E Input mode (VAD, push-to-talk) and Keybinds page** (M). Owns `features/voice/input/**`, `features/settings/keybinds/**`. Touches `lib/hotkeys.ts` (custom binding layer). Acceptance: Voice Activity with automatic or manual sensitivity, live meter and advanced VAD from RNNoise; push-to-talk with release delay, sounds, mouse-button binding and a touch hold button; USE_VAD denied forces PTT; Settings → Keybinds with a recorder, add/delete, voice and navigation actions, a read-only list of defaults and a "works only while focused" note. Features: `layout-keybinds-settings`, `voice-input-voice-activity`, `voice-push-to-talk`, `voice-keybinds`, `customization-keybinds-custom`, `customization-voice-input-mode`
- **W8-F Voice channel settings, text in voice, tiers, feedback** (M). Owns `spaces/channelSettings/voice/**`, `features/voice/chat/**`, `apps/server/src/modules/callFeedback/**`, `modules/spaces/routes/channels.ts`. Touches `services/spaceRules.ts` (space_voice accepted), `services/spaceSummaries.ts` (voice unread). Acceptance: voice Overview settings (bitrate to 96 kbps or the operator max, Auto/720p video, region Automatic, user limit at create, NSFW, slowmode); a voice chat panel beside the grid, readable without connecting, with unread badges on voice rows; generous fixed tier limits from config; a sampled post-call survey in `call_feedback` with a retention job. Features: `messaging-text-in-voice`, `servers-text-in-voice`, `voice-channel-bitrate`, `voice-channel-region`, `voice-channel-video-quality`, `voice-channel-create-settings`, `voice-text-in-voice`, `voice-call-feedback`, `voice-server-boost-perks`

**Deploy check.** With LiveKit running in `direct` or `relay` mode: three browsers join General and every client sees the occupants, including a viewer who is not connected; speaking rings show; a moderator's server mute mutes; killing one node frees stale state within 30 s; a TURN-only network still connects; `VOICE_MODE=mesh` works on a staging copy. Watch LiveKit CPU on enfinitos1 and confirm no port overlap with Asterisk.

### W9. Voice depth: Go Live, Stage, soundboard, Discord DM calls, backgrounds, E2EE, Active Now

**Goal.** Screen share as separate tracks with tab audio and viewer choice; Stage channels with speakers, audience and raise hand; soundboard and entrance sounds; DM and group calls inline in the chat, Discord style; video backgrounds; opt-in E2EE; the Active Now column on Friends.

**Contracts.** Migration `0014_voice2.sql`: `chats_type_ck` adds `space_stage`; `stage_instances`; `soundboard_sounds`, `soundboard_favorites`; `users.entrance_sound_id`, `space_members.entrance_sound_id`; voice_states `suppress`, `request_to_speak_at`; `user_device_keys`. Shared: StageInstance, SoundboardSound, stream viewer events (`voice:watch/unwatch/stream-viewers`), stage events, `voice:soundboard`, `voice:effect`; `GO_LIVE` presets, STAGE caps, `SOUND_MAX_MS` 5200; `callJoinSchema.withVideo`. Decision: DM and group calls move onto LiveKit rooms (room = call id) with the `call:*` contract kept compatible; any call with an APK peer stays on the mesh.

- **W9-A Screen share and Go Live** (L). Owns `features/voice/stream/**`, `apps/server/src/modules/voice/streams.ts`. Touches `voice/view/VoiceGrid.tsx` (stream tiles). Acceptance: screen video and tab audio as separate tracks, so camera and screen run together; presets up to 1080p60 or the operator cap; viewers click Watch (no auto-subscribe), a Valkey viewer set with a Lua cap of 50 and a thumbnail every 60 s; LIVE pill, hover preview, viewer list, zoom/pan, change source without unpublishing, Invite to Stream, "ended the stream" screen; a phone web viewer with PiP. Features: `voice-screen-share`, `voice-go-live-game`, `voice-go-live-quality`, `voice-go-live-watch`, `voice-stream-zoom-pan`, `voice-go-live-streamer-controls`, `voice-stream-request`, `voice-mobile-screen-share`, `notifications-premium-streaming-quality`
- **W9-B Stage channels** (L). Owns `features/stage/**`, `apps/server/src/modules/stage/**`. Touches `ChannelSidebar.tsx` (stage row + live card). Acceptance: Start Stage with topic and notify (MENTION_EVERYONE, rate-limited); speakers grid and virtualised audience (counts plus first N for large audiences); Request to Speak, moderator queue, Invite to Speak, Move to Audience, Leave Quietly; at most 5 video speakers and 1 screen; stage chat; auto-end when the last moderator leaves; never E2EE. Features: `servers-stage-channel`, `voice-stage-channel`, `voice-stage-start-topic`, `voice-stage-speakers-audience`, `voice-stage-request-to-speak`, `voice-stage-video`, `voice-stage-text-chat`, `notifications-stage-stream-notify`
- **W9-C Soundboard, entrance sounds, voice effects** (M). Owns `features/soundboard/**`, `spaces/settings/SoundboardPage.tsx`, `apps/server/src/modules/soundboard/**`. Touches `services/media.ts` (`requireSoundMedia` with server-side duration). Acceptance: Space Soundboard settings (upload, waveform trim, name, emoji, volume, 48 free slots); a picker in voice and DM calls with favourites and defaults; a Valkey cooldown across processes, broadcast to `rooms.voice` only; per-listener soundboard volume and mute; global and per-Space entrance sounds (skipped on reconnect); emoji bursts over tiles. Features: `servers-soundboard`, `voice-soundboard`, `voice-soundboard-management`, `voice-entrance-sounds`, `voice-channel-effects`, `customization-voice-soundboard-settings`, `notifications-premium-soundboard`
- **W9-D Discord-style DM and group calls** (L). Owns `features/calls/**`, `stores/calls.ts`, `realtime/calls.ts`, `apps/server/src/modules/calls/**`. Touches `ConversationPane.tsx` (DmCallStage slot). Acceptance: an inline resizable call stage above the DM chat with the Discord control bar, Full view, Join Call header button, Ring for members who have not joined, adding friends mid-call (becomes a group DM); incoming call offers Join with video, Join voice and Decline plus Ctrl+Enter/Esc; the notification opens `/chats/:id`; Ctrl+' starts a call; LiveKit rooms lift the 8 cap, mesh stays for the APK; phone pre-join sheet, full-screen view with swipe-down to a connected bar, Media Session controls; data-testids kept or tests updated. Features: `layout-dm-call-area`, `layout-mobile-voice-bar`, `voice-dm-call-start`, `voice-incoming-call-ringing`, `voice-group-dm-call`, `voice-dm-call-ui`, `voice-mobile-voice-ui`, `notifications-call-ringing`
- **W9-E Video backgrounds, video settings, E2EE, Active Now** (L). Owns `features/voice/backgrounds/**`, `features/voice/e2ee/**`, `features/friends/activeNow/**`, `apps/server/src/modules/voiceKeys/**`, `modules/friendActivity/**`. Touches `settings/voice/VideoSettings.tsx`. Acceptance: blur, preset and custom (IndexedDB) backgrounds via `@livekit/track-processors` with MediaPipe assets on our origin; camera preview modal (always preview, mirror, camera choice); opt-in E2EE for DM calls and small voice channels with per-device keys relayed by the server, rekey on join/leave, a privacy code and a Verify modal; an Active Now column (hidden below 1200px) from `GET /relationships/activity`, filtered to channels I can see. Features: `layout-friends-active-now`, `social-active-now`, `voice-video-backgrounds`, `voice-e2ee`, `customization-voice-video-settings`

**Deploy check.** Go Live at 1080p with tab audio to 3 viewers (check LiveKit CPU and bitrate); a Stage with 1 speaker and 20 listeners shows a raised hand to the moderator; a soundboard clip honours the cooldown across both processes; a DM call shows inline and the APK still receives and answers a ring; an E2EE call shows matching codes.

### W10. Threads, forums, media channels, webhooks, announcement channels

**Goal.** Threads from messages and channels (public and private) in a side panel; forum and media channels with tags and post actions; incoming webhooks with rich embeds; announcement channels with Publish and Follow.

**Contracts.** Migration `0015_threads.sql`: `chats_type_ck` adds `space_thread`, `space_forum`, `space_media`; chats `parent_chat_id`, `parent_message_id` (unique), `archived_at`, `locked`, `auto_archive_minutes`, `invitable`, `message_count`, `applied_tag_ids uuid[]` (GIN), `is_news`, `default_auto_archive_sec`, index `(parent_chat_id, archived_at, last_message_at desc)` and a partial index for the archive job; `thread_members` (notify level); `forum_tags`; `webhooks`; `messages.webhook_id` plus author override columns, with `messages_system_sender_ck` relaxed; `channel_follows`, `crosspost_jobs`, `crosspost_messages`. Shared: thread and forum models, `Message.thread`, `Message.webhook`, `Message.crosspost`; schemas; `THREAD_AUTO_ARCHIVE_OPTIONS`; Discord-compatible embed limits; events `thread:upsert/deleted/members`. `spaceRegistry` gains a hook that registers child chat ids under their parent's ChannelState.

- **W10-A Threads core and side panel** (L). Owns `apps/server/src/modules/threads/**`, `realtime/spaceRegistry.ts`, `services/spaceAccess.ts`, `features/threads/panel/**`. Touches `SpacesView.tsx` (aside slot), `rows/DiscordMessageRow.tsx` (thread preview card). Acceptance: Create Thread from a message or a channel, with an "X started a thread" line; threads are chats rows reusing seq, history and lazy read state, with access inherited from the parent through spaceRegistry on every process; a resizable right ThreadPanel with Open in full view and a phone screen; private threads visible to members plus MANAGE_THREADS via a bus-invalidated member cache, @mention adds the user; an active-thread cap counted in Valkey; 200 concurrent sends serialise only on the thread row. Features: `layout-thread-side-panel`, `messaging-threads`, `messaging-private-threads`, `servers-threads-public`, `servers-threads-private`
- **W10-B Thread lifecycle, browser, notifications** (M). Owns `apps/server/src/modules/threadLifecycle/**`, `jobs/threadArchive.ts`, `features/threads/browser/**`, `features/threads/menus/**`. Touches `ChannelSidebar.tsx` (nested thread rows), `push/spaceNotifications.ts` (thread followers). Acceptance: leader auto-archive (partial index, SKIP LOCKED); a reply revives unless locked; close and lock; Threads popout with Joined / Active / Archived and search; joined threads nested under the parent with branch lines; thread menu (edit, notifications, leave, delete, remove member); follow state drives push; threads also work in announcement channels. Features: `layout-header-threads-button`, `messaging-threads-browser`, `messaging-thread-archive`, `servers-thread-archive-lock`, `servers-threads-browser`, `servers-thread-actions`, `servers-announcement-threads`, `customization-notif-threads-forums`, `notifications-thread-notifications`
- **W10-C Forum channels, post composer, tags** (L). Owns `apps/server/src/modules/forums/**`, `features/forums/feed/**`, `features/forums/composer/**`, `features/forums/tags/**`. Touches `SpaceChannelPane.tsx` (route by type). Acceptance: forum feed with search, New Post, sort and list/gallery view, tag chips and post cards, keyset on `(parent, archived, last_message_at)`; the post composer creates thread and starter message in one transaction with guidelines, required tags and an atomic post slowmode; tag editor (≤20, emoji, moderated); forum settings for default reaction, sort and layout. Features: `servers-forum-channel`, `servers-forum-new-post`, `servers-forum-tags`
- **W10-D Forum post actions and media channels** (M). Owns `apps/server/src/modules/forumPosts/**`, `features/forums/post/**`, `features/mediaChannels/**`. Touches `forums/feed/PostCard.tsx` (menu hook). Acceptance: follow/unfollow, close (author), lock, pin (one per forum via a unique partial index), edit title and tags, delete, all audited; followed posts in the sidebar; media channels as a thumbnail grid with a required attachment and an honest "hide download buttons" flag. Features: `servers-forum-post-actions`, `servers-media-channel`
- **W10-E Webhooks and rich embeds** (L). Owns `apps/server/src/modules/webhooks/**`, `spaces/settings/integrations/webhooks/**`, `bubbles/embeds/RichEmbed.tsx`. Touches `rows/AuthorLine.tsx` (APP tag, override author). Acceptance: up to 15 webhooks per channel with name, avatar, Copy URL (token encrypted at rest), regenerate with a system DM to the creator; public `POST /api/webhooks/:id/:token` with a Discord-compatible body, files, `?wait`, edit and delete of own messages, Valkey limits per webhook and per IP; `/slack` and `/github` adapters; rich embed renderer (fields grid, author, footer); APP tag and grouping that breaks on webhook name change. Features: `messaging-embeds-rich`, `messaging-webhooks`, `servers-webhooks`, `notifications-webhooks-create`, `notifications-webhooks-execute`, `notifications-webhooks-display`, `notifications-webhooks-compat`, `notifications-webhooks-security`, `notifications-dev-rich-embeds`
- **W10-F Announcement channels, Publish, Follow, Integrations page** (M). Owns `apps/server/src/modules/announcements/**`, `jobs/crosspost.ts`, `features/announcements/**`, `spaces/settings/integrations/IntegrationsPage.tsx`, `features/channels/convert/**`. Touches `ChannelSidebar.tsx` (megaphone icon). Acceptance: convert a channel between text and announcement; Publish limited to 10/hour per channel in Valkey; crossposts delivered by a leader job in batches through follower webhooks, with edits and deletes propagated via `crosspost_messages`; Follow modal (MANAGE_WEBHOOKS in the target); SERVER tag on crossposts; Integrations page (Webhooks, Channels Followed, Apps later); the opt-in broadcast-to-Space converter posts under a channel webhook identity. Features: `messaging-announcement-publish`, `servers-announcement-channel`, `servers-integrations-page`, `notifications-apps-integrations-page`, `notifications-announce-channel`, `notifications-announce-publish`, `notifications-announce-follow`, `notifications-announce-crosspost-render`

**Deploy check.** Threads created on two processes deliver to both clients; a private thread stays invisible to non-members even to a socket spy; the archive job runs only on the leader; a curl to a webhook posts a rich embed; Publish crossposts to a followed channel in another Space.

### W11. Moderation and safety: AutoMod, raids, verification, members, Mod View, audit, member list

**Goal.** Server safety at Discord level: AutoMod (keywords, RE2 regex, presets, spam, mention spam, profile quarantine, alerts), raid protection and security actions, verification levels, Safety Setup, a Members table with signals and bulk actions, Mod View, bans and prune, bulk delete, an audit log with diffs, and a presence-aware lazy member list.

**Contracts.** Migration `0016_safety.sql`: `automod_rules` + `spaces.automod_version`; spaces `verification_level`, `raid_mode_until`, `invites_paused_until`, `dms_paused_until`, `invites_disabled`, `safety jsonb`; `space_safety_alerts`; space_members `join_type`, `join_code`, `join_inviter_id`, `last_active_at`, `quarantined_at`; `space_member_history`; `users.spam_score`. Shared: `packages/shared/src/automod.ts` (pure wildcard matcher, rule and action types, limits); verification gate evaluator; `RISKY_EVERYONE_PERMISSIONS`; `BAN_DELETE_MESSAGE_OPTIONS` (0, 1h, 6h, 12h, 24h, 3d, 7d); `bulkDeleteSchema`, `bulkMemberActionSchema`; `MemberListPage` and range-subscription op events. CAPTCHA switch (turnstile|hcaptcha|altcha|off). The `re2` native dependency is built on the server host (linear-time JS fallback if it cannot build).

- **W11-A AutoMod engine, keyword, regex, presets, exemptions** (L). Owns `apps/server/src/modules/automod/engine/**`, `modules/automod/routes.ts`, `spaces/settings/automod/**`. Touches `services/spaceRules.ts` (evaluate hook on send, edit, forward, titles). Acceptance: rule CRUD with per-type caps under lockSpace; a compiled per-Space cache (Aho-Corasick + RE2) invalidated by `automod_version` over the bus; the editor has a live test box, regex tests go through the server; preset word lists stay on the server; role and channel exemptions, admins always exempt; under 2 ms p99 overhead with 6 rules × 1000 keywords. Features: `servers-automod`, `servers-automod-keyword`, `servers-automod-presets`, `notifications-safety-automod`, `notifications-safety-automod-keywords`, `notifications-safety-automod-regex`, `notifications-safety-automod-preset`, `notifications-safety-automod-exemptions`
- **W11-B AutoMod responses, spam, mention spam, quarantine, alerts** (L). Owns `apps/server/src/modules/automod/actions/**`, `services/spamSignals.ts`, `features/automod/**`. Touches `ChatBar/ChatBar.tsx` (automod_blocked restores text + ephemeral). Acceptance: a blocked send returns `automod_blocked` with a custom message, the text goes back to the composer with an ephemeral notice; alert cards in the alert channel highlight the match and offer timeout, kick, ban, jump; cross-channel duplicate hashes in Valkey for spam; mention spam limit and raid detection; profile filter quarantines on join, nickname change or `user:changed` (bounded to 200 Spaces); quarantined members keep only VIEW_CHANNEL. Features: `messaging-automod-block`, `servers-automod-spam`, `servers-automod-mention-spam`, `servers-automod-member-profile`, `servers-automod-responses`, `servers-automod-alerts`, `notifications-safety-automod-spam`, `notifications-safety-automod-mention-spam`, `notifications-safety-automod-member-profile`, `notifications-safety-automod-actions`, `notifications-safety-automod-blocked-notice`, `notifications-safety-automod-alerts`
- **W11-C Raid protection, alerts, security actions, Safety Setup, verification** (L). Owns `apps/server/src/modules/safety/**`, `spaces/settings/safety/**`, `features/safety/RaidBanner.tsx`. Touches `modules/spaces/invites.ts` (paused, raid, CAPTCHA checks), `realtime/spaceRegistry.ts` (`space-mods:<id>` virtual room). Acceptance: join and DM raid detection on Valkey sliding windows; CAPTCHA in raid mode or for suspicious accounts; a moderator-only banner reaches only sockets with moderation bits; pause invites or DMs up to 24 h; Report Raid; reports routable to the Space's moderators; Safety Setup with one-click removal of risky @everyone bits; verification None/Medium/High enforced on the server with a composer countdown (Low and Highest wait for W13 email and phone). Features: `servers-verification-level`, `servers-raid-protection`, `servers-activity-alerts`, `servers-security-actions`, `servers-report-raid`, `servers-safety-setup`, `notifications-safety-raid-protection`, `notifications-safety-activity-alerts`, `notifications-safety-security-actions`, `notifications-safety-verification-level`, `notifications-safety-risky-permissions`, `notifications-safety-report-to-mods`
- **W11-D Members table, Mod View, bans, prune, bulk delete** (L). Owns `spaces/settings/members/**`, `spaces/modView/**`, `spaces/settings/bans/**`, `apps/server/src/modules/spaces/moderation.ts`, `jobs/prune.ts`, `jobs/banPurge.ts`. Touches `modules/spaces/members.ts` (join method on join). Acceptance: a virtualised members table (Member Since, Joined Enbox, join method, roles, signals) with filters, sort and bulk kick/ban/role for up to 200 under lockSpace; Mod View slide-over (last 20 messages via the sender index), also for members who left or were banned; ban with every purge window as a batched hard delete with one removal event per chat; ban by ID; searchable paged bans; prune with a count preview run by a leader job; bulk delete of up to 100 messages under 14 days; moderator deletes audited. Features: `messaging-bulk-delete`, `servers-members-page`, `servers-mod-view`, `servers-ban`, `servers-bans-list`, `servers-prune`, `servers-message-moderation`, `notifications-safety-members-page`, `notifications-safety-mod-view`, `notifications-safety-suspected-spammer`
- **W11-E Lazy presence-aware member list service** (L). Owns `apps/server/src/modules/memberList/**`, `cluster/memberListIndex.ts`, `jobs/memberListRebuild.ts`. Touches `cluster/presenceRegistry.ts` (online set updates). Acceptance: Valkey ZSETs per Space and permission signature for hoisted roles, online and offline, updated from presence, role, join and leave events; `GET /spaces/:id/member-list?channelId&ranges` returns group counts and rows; offline omitted above 1,000; range-subscribed sockets get SYNC/INSERT/UPDATE/DELETE/INVALIDATE; a leader rebuild repairs drift; small Spaces keep the SQL path; load test with 50k synthetic members. Features: `servers-member-list`
- **W11-F Member list client and audit log** (M). Owns `spaces/MemberList.tsx`, `spaces/memberList/**`, `spaces/settings/auditLog/**`. Touches `services/spaces.ts` (audit change shape). Acceptance: MemberList requests visible ranges ("ROLE — n", "Online — n"), shows status lines and nameplates, opens the user menu for everyone; the audit log has user and action filters, infinite scroll, old→new diffs, channel and role names and the new action types. Features: `layout-member-list`, `servers-audit-log`

**Deploy check.** A keyword rule blocks a message and the text comes back to the sender; an alert lands in the alert channel; 30 joins in 10 s raise the moderator banner on both processes; pausing invites blocks `/join`; a 5k-member test Space shows correct Online counts; bulk delete removes 50 messages with one event; RE2 loads in production.

### W12. Community and growth: onboarding, applications, discovery, invites, events, templates, insights

**Goal.** Discord Community features: Enable Community, onboarding questions, rules screening, Server Guide and welcome screen, Browse Channels, Channels & Roles, applications and join modes, Server Discovery with preview (lurk) mode and public pages, the full invite system with vanity URLs and splash, scheduled events, templates, widget, insights, and the Space identity settings.

**Contracts.** Migration `0017_community.sql`: spaces `features text[]`, `rules jsonb`, `join_mode`, `system_channel_flags`, `safety_alerts_channel_id`, `public_updates_channel_id`, `preferred_locale`, `traits`, `games`, `splash_media_id`, discovery and widget fields, `verified`, `vanity_uses`; pg_trgm index on spaces name/description; `space_onboarding`, `space_member_onboarding`, `space_member_channels`, `space_application_forms`, `space_applications`, `space_welcome_screen`, `space_events`, `space_event_interests`, `space_templates`, `space_stats_daily`; space_invites `temporary`, `role_ids`, `bypass_application`, `event_id`, `target_user_id`; space_members `temporary`, `onboarded_at`, `passed_screening_at`, `guide_progress`. Shared: `SPACE_STARTER_TEMPLATES`, `DISCOVERY_CATEGORIES`; `perksOf(space)` returns the top tier; Onboarding, Event, Template and Directory types; `<id:customize|browse|guide>` markdown tokens. Express and nginx serve `/join/*`, `/servers/*`, `/widget/*`, `/template/*` before the SPA fallback.

- **W12-A Community mode, onboarding, rules screening** (L). Owns `apps/server/src/modules/onboarding/**`, `features/onboarding/**`, `spaces/settings/community/**`. Touches `services/spaceRules.ts` (screening gate), `packages/shared/src/permissions.ts` (pending input masks bits). Acceptance: an Enable Community wizard checks safety prerequisites; onboarding stepper with default channels validated by the permission engine (≥7, ≥5 sendable) and questions linking roles and channels (roles below the admin only); the member flow runs after Accept Invite and grants roles in bulk with one perm_version bump; the rules screening banner gates sending; designated rules and updates channels cannot be deleted; `<id:browse>` and similar pills. Features: `messaging-mention-guild-navigation`, `servers-rules-and-updates-channels`, `servers-rules-screening`, `servers-community-enable`, `servers-community-overview`, `servers-onboarding-setup`, `servers-onboarding-questions`, `servers-onboarding-member-flow`, `notifications-safety-rules-screening`
- **W12-B Server Guide, welcome screen, Browse Channels, applications, join modes, checklist** (L). Owns `apps/server/src/modules/spaceApplications/**`, `modules/guide/**`, `features/spaceApplications/**`, `spaces/guide/**`, `spaces/browse/**`, `spaces/checklist/**`. Touches `ChannelSidebar.tsx` (top links: Events, Guide, Channels & Roles, Browse, Members). Acceptance: Server Guide (welcome sign, to-dos, resource cards, cheap progress); legacy welcome modal; opt-in Browse Channels listing (permissions unchanged); Channels & Roles page; Access page (invite-only, apply, discoverable); application form builder, applicant modal, review list with approve/reject/interview, push on decision; new-Space setup cards with tick-offs. Features: `layout-channel-sidebar-top-links`, `servers-new-server-checklist`, `servers-browse-channels`, `servers-channels-and-roles`, `servers-access-join-modes`, `servers-member-applications`, `servers-server-guide`, `servers-welcome-screen`
- **W12-C Discovery, preview (lurk), public pages, directory channels** (L). Owns `apps/server/src/modules/discovery/**`, `http/publicPages.ts`, `features/discover/**`, `spaces/lurk/**`. Touches `realtime/spaceRegistry.ts` (lurk sockets get public messages only), `apps/server/src/app.ts` (routes before the SPA fallback). Acceptance: `/discover` with hero, categories, trigram search, cards, keyset by member count, Valkey cache; discovery requirements checklist and listing form; preview mode with a temporary rail tile and Join footer that reads only @everyone-visible channels, creates no read rows and is rate-limited; `/servers/:slug-:id` server-rendered with OG tags; Verified badge from a staff CLI; directory channels listing Spaces. Features: `layout-rail-discover`, `layout-server-preview-mode`, `servers-preview-lurk`, `servers-public-web-page`, `servers-discovery-browse`, `servers-discovery-settings`, `servers-verified-partnered`, `servers-hubs-directory`
- **W12-D Invites, vanity URL, splash, landing page, level-3 perks** (L). Owns `apps/server/src/modules/spaces/invites.ts`, `jobs/invitePurge.ts`, `spaces/dialogs/InviteDialog.tsx`, `features/invites/**`, `spaces/settings/invites/**`. Touches `modules/voice` leave hook (temporary members removed). Acceptance: the invite modal reuses an existing invite, lists friends with Invite buttons that DM the link, Copy, and Edit invite link (temporary, roles, bypass application); a job purges expired and used-up invites; paged list with inviter and countdown; public `/join/:code` with splash and OG HTML, viewable logged out, counts from a 30 s Valkey cache; vanity setter with a collision check across every code table under an advisory lock; guest and targeted invites; `perksOf` gives every Space banner, animated icon, splash, vanity and role icons, with no boost UI. Features: `servers-join-via-invite`, `servers-invite-modal`, `servers-invite-options`, `servers-temporary-membership`, `servers-role-invites`, `servers-targeted-invites`, `servers-guest-invites`, `servers-invites-management`, `servers-invite-landing-page`, `servers-invite-splash`, `servers-vanity-url`, `servers-boosting`, `servers-boost-levels`, `voice-temporary-membership`, `notifications-premium-boosts`, `notifications-premium-boost-perks`
- **W12-E Scheduled events** (M). Owns `apps/server/src/modules/events/**`, `jobs/events.ts`, `features/events/**`. Touches `spaces/sidebar/TopLinks.tsx` (Events count, Live Now card). Acceptance: a 3-step create modal (stage, voice or external; info; recurrence subset; cover); Interested with `interested_count` kept in the transaction; a leader job starts and ends events and pushes interested users in batches, honouring `mute_new_events`; Live Now card; event links and invite cards with Interested and Join. Features: `servers-events-create`, `servers-events-list-rsvp`, `servers-events-live`, `servers-events-share`, `voice-scheduled-events`, `notifications-event-notifications`
- **W12-F Add Space, templates, Server Profile, Engagement, widget, insights, delete** (L). Owns `spaces/dialogs/AddSpaceModal.tsx`, `spaces/settings/OverviewPage.tsx`, `EngagementPage.tsx`, `TemplatePage.tsx`, `WidgetPage.tsx`, `spaces/settings/insights/**`, `apps/server/src/modules/templates/**`, `modules/widget/**`, `modules/insights/**`, `jobs/insightsFlush.ts`, `jobs/spacePurge.ts`. Touches `services/spaces.ts` (createSpaceTx applies a template). Acceptance: Add Space (Create my own or a template, icon and name, link to Join, Ctrl+Shift+N); templates with generate, sync, preview and `/template/:code`; Server Profile (icon, 16:9 banner, traits, games, live preview); Engagement (system channel flags, AFK, default notifications); widget JSON, iframe and badges cached in Valkey; insights from Valkey HINCRBY/HyperLogLog flushed into daily tables by the leader, with charts and CSV; deleting a Space needs its name typed and purges in the background. Features: `layout-rail-add-server`, `servers-create-server`, `servers-delete-server`, `servers-server-profile-settings`, `servers-engagement-settings`, `servers-insights`, `servers-template`, `servers-widget`, `notifications-dev-server-widget`, `notifications-premium-server-limit`

**Deploy check.** Enable Community on a test Space and join through an invite as a new user: onboarding runs and grants roles; a discoverable Space appears in `/discover` and lurk mode reads #general without joining; the vanity URL resolves; a `/join` link unfurls in an external chat; an event starts on time on one process only; the insights flush runs on the leader.

### W13. Account security, privacy and content safety

**Goal.** Email with verification and password reset; MFA (TOTP, backup codes, passkeys); QR login; login alerts; SMS-verified phone; Discord-style profile privacy; data export; disable or delete with a grace period; account standing; sensitive-media filters; age-restricted gates; age assurance; Family Center; signed media URLs.

**Contracts.** Migration `0018_security.sql`: users `email` (unique lower), `email_verified_at`, `totp_secret_enc`, `mfa_enabled_at`, `phone_verified_at`, `disabled_at`, `deletion_scheduled_at`, `birthdate`, `age_group`, `locale`; tables `email_tokens`, `email_outbox`, `mfa_backup_codes`, `webauthn_credentials`, `login_challenges`, `phone_verifications`, `data_exports`, `user_violations`, `family_links`, `user_channel_acks`; media `nsfw_score`, `sensitive`; `chats.spoiler`, `spaces.nsfw_level`, `spaces.mfa_level`; sessions `os`, `client`, `location`. Shared: schemas for every flow; `LoginResult {mfaRequired, ticket, methods}`; UserSettings `profileVisibility`, `sensitiveMedia`, `spoilerReveal`. Config switches `SMTP_URL`, `SMS_PROVIDER`, `MFA_ENCRYPTION_KEY`, `WEBAUTHN_RP_ID`/related origins, `GEOIP_DB`, `NSFW_CLASSIFIER` (local|api|off), `AGE_VENDOR` (off), `MEDIA_SIGNING_SECRET`.

- **W13-A Email, password reset, login alerts, digests** (L). Owns `apps/server/src/modules/auth/email.ts`, `auth/passwordReset.ts`, `services/mailer.ts`, `jobs/emailOutbox.ts`, `jobs/digest.ts`, `jobs/highlights.ts`, `settings/account/email/**`, `features/auth/reset/**`. Touches `features/auth/LoginPage.tsx` (Forgot password link). Acceptance: add or change email with codes and a verify banner; mail through an outbox drained by a leader job, so a crash loses no mail; forgot/reset revokes all sessions across processes; new-country login challenge by email; missed-message digest and highlights at most daily with List-Unsubscribe and one-click unsubscribe; with `SMTP_URL` unset the UI hides email features. Features: `social-account-email`, `social-account-password`, `customization-account-email`, `customization-account-password`, `customization-notif-email`, `customization-notif-highlights`, `notifications-email`, `notifications-highlights`, `notifications-safety-login-alerts`
- **W13-B MFA, passkeys, QR login, 2FA for moderation** (L). Owns `apps/server/src/modules/auth/mfa.ts`, `auth/webauthn.ts`, `auth/qr.ts`, `features/auth/mfa/**`, `settings/account/mfa/**`. Touches `modules/auth/routes.ts` (two-step ticket in Valkey), `packages/shared/src/permissions.ts` (mfaOk input). Acceptance: two-step login with a 5-minute Valkey ticket completed by TOTP, backup code or passkey; authenticator QR enable; backup codes view, download and regenerate after re-auth; security keys and passwordless passkeys with RP ID or related origins for the 3 domains; QR login where the browser long-polls through Valkey pub/sub and a logged-in phone approves; owners can require 2FA for moderators, and moderation bits are stripped without it. Features: `servers-2fa-moderation`, `social-mfa`, `social-passkey-login`, `social-qr-login`, `customization-account-mfa`, `notifications-safety-mod-2fa`, `notifications-safety-2fa`, `notifications-platform-qr-login`
- **W13-C Phone verification, devices, disable and delete with grace** (M). Owns `apps/server/src/modules/auth/phone.ts`, `services/sessions.ts`, `modules/users/account.ts`, `jobs/accountDeletion.ts`, `settings/account/removal/**`, `settings/DevicesPage.tsx`. Touches `services/users.ts` (scrub covers social, cosmetic and per-Space tables). Acceptance: SMS OTP phone verification rate-limited per number and IP; only verified numbers log in or match contacts; device cards with parsed OS and client and a GeoLite2 city; "Log out all" needs the password; disable (reactivated by logging in); delete schedules a 14-day grace that login can cancel, then a leader job runs the full scrub including the new tables. Features: `social-account-phone`, `social-devices`, `social-disable-account`, `social-delete-account`, `customization-account-phone`, `customization-account-removal`, `customization-account-devices`, `notifications-safety-devices`
- **W13-D Profile privacy, data export, account standing** (L). Owns `apps/server/src/modules/privacyData/**`, `modules/standing/**`, `jobs/dataExport.ts`, `settings/privacy/dataPrivacy/**`, `settings/account/standing/**`. Touches `services/users.ts` (profileVisibility levels via a batched shared-Space query). Acceptance: Friends & All Servers / Friends & Small Servers (≤200) / Friends Only with a per-Space override and a slim locked card, old contacts levels mapped over with tests; a Data & Privacy page stating that no analytics are collected; data export once per 30 days streamed by a leader job in keyset batches to a private path, delivered as a signed expiring link in a system DM; Account Standing meter and violation cards with appeals. Features: `social-profile-privacy`, `social-data-privacy`, `social-data-download`, `social-account-standing`, `customization-account-standing`, `customization-profile-privacy`, `customization-privacy-data-usage`, `customization-privacy-data-export`, `notifications-safety-account-standing`, `notifications-platform-data-privacy`
- **W13-E Sensitive media, explicit filter, age-restricted and spoiler channels** (L). Owns `apps/server/src/services/mediaClassifier.ts`, `workers/nsfwWorker.ts`, `features/safety/sensitive/**`, `features/safety/AgeGate/**`. Touches `modules/media/routes.ts` (queue classification), `services/spaceAccess.ts` (nsfw gate on the server). Acceptance: upload-time classification (bounded worker queue or external API) sets `media.sensitive`; Show/Blur/Block per context; Space explicit filter levels; age-restricted channels and Spaces refuse history to minors and to users who have not acknowledged, with a one-time interstitial and no previews or discovery; spoiler channels with a gate; with `NSFW_CLASSIFIER=off` the blur uses spoiler flags only. Features: `messaging-sensitive-media`, `messaging-spoiler-channels`, `servers-age-restricted-channel`, `servers-spoiler-channel`, `servers-explicit-media-filter`, `servers-age-restricted-server`, `social-sensitive-media-filter`, `customization-social-sensitive-media`, `notifications-safety-explicit-filter-server`, `notifications-safety-sensitive-media`, `notifications-safety-age-restricted`
- **W13-F Age assurance, Family Center, signed media URLs** (M). Owns `apps/server/src/modules/age/**`, `modules/family/**`, `jobs/familySummary.ts`, `http/signedUploads.ts`, `features/family/**`, `features/auth/AgeStep.tsx`. Touches `apps/server/src/app.ts` (`/uploads` middleware or nginx secure_link). Acceptance: self-attested date of birth at registration with teen defaults and an `AGE_VENDOR` hook off by default; Family Center QR pairing and a weekly counts-only summary; media URLs with day-bucketed HMAC expiry verified on `/uploads`, a grace period for old links, client refetch on 403, and the APK caching media URLs for under 24 h. Features: `messaging-attachment-cdn-expiry`, `social-age-assurance`, `social-family-center`, `customization-account-family-center`, `notifications-safety-age-assurance`, `notifications-safety-family-center`

**Deploy check.** With SMTP configured, a reset email arrives and resets the password; enable TOTP and log in on the second process with a code; QR login from a phone works; an explicit test image is blurred for another user; an age-restricted channel refuses history to an under-18 account; signed media URLs load, an expired one gets 403 and is refetched.

### W14. Apps platform: bots, OAuth2, commands, interactions, components, activities

**Goal.** Third-party apps as on Discord: bot users with tokens and a gateway, a developer portal, OAuth2 consent and installs into Spaces or for a user, managed roles, slash/user/message commands with options and autocomplete, interactions with buttons, selects, modals and Components V2, an App Directory and launcher, embedded activities, bot and rich presence, manual activity, and a small JS SDK.

**Contracts.** Migration `0019_apps.sql`: `applications`, `app_tokens`, `oauth_grants`, `oauth_tokens`, `users.is_bot`, `application_commands`, `command_permission_overwrites`, `app_user_installs`, messages `components jsonb` and `interaction jsonb`, `space_roles.managed_by_app_id`, `activity_sessions`, `user_activity_history`. Shared: Application, Command, Interaction and Component schemas with Discord limits; OAuth scopes; `Presence.activities`; the `</name:id>` markdown token. Config `ACTIVITIES_ORIGIN` (sandbox), `APPS_ENABLED`. Interaction tokens live in Valkey with a 15-minute TTL.

- **W14-A Bot users, gateway, developer portal, app profiles** (L). Owns `apps/server/src/modules/applications/**`, `realtime/botGateway.ts`, `features/developers/**`, `features/profile/AppProfile.tsx`. Touches `apps/server/src/http/auth.ts` (Bot token auth). Acceptance: `/developers/applications` creates apps, resets tokens (shown once), toggles public, configures OAuth clients and redirects, verifies the interactions URL with a ping, adds testers; test mode before publishing; bots connect to a Socket.IO bot namespace with intents and Valkey rate-limit headers and only join Spaces they are installed in; APP tag and app profile popout. Features: `social-app-profiles`, `customization-advanced-app-test-mode`, `notifications-apps-bot-users`, `notifications-apps-app-profile`, `notifications-apps-developer-portal`
- **W14-B OAuth2, installs, authorized apps, managed roles** (L). Owns `apps/server/src/modules/oauth/**`, `modules/spaces/integrations.ts`, `features/oauth/**`, `settings/authorizedApps/**`. Touches `modules/spaces/routes/roles.ts` (managed role guards). Acceptance: authorization code with PKCE, client credentials and refresh tokens, revocation propagated over the bus; consent page with Space picker and permission checklist; install creates the bot member and a managed role (locked, not deletable or hand-assignable), audited, 100-Space cap for unverified apps; user installs work in DMs and responses are forced ephemeral without USE_EXTERNAL_APPS; Authorized Apps with Deauthorize. Features: `messaging-user-installed-apps`, `servers-managed-roles`, `servers-add-apps`, `social-authorized-apps`, `customization-authorized-apps`, `notifications-apps-install-server`, `notifications-apps-user-install`, `notifications-apps-oauth2`, `notifications-apps-authorized-apps`, `notifications-apps-managed-role`
- **W14-C Slash and context-menu commands, interactions, permissions** (L). Owns `apps/server/src/modules/commands/**`, `modules/interactions/**`, `composer/appCommands/**`, `spaces/settings/integrations/appManage/**`. Touches `composer/Autocomplete/providers.ts`. Acceptance: "/" picker with app rail and frecency, typed option chips with choices, autocomplete under 3 s, attachment options; user and message commands under Apps submenus; Ed25519-signed outbound interactions through the SSRF fence, 3 s deadline recorded in Valkey, deferred "thinking", 15-minute follow-ups, "The application did not respond"; command permission overwrites; clickable `</cmd:id>` pills. Features: `messaging-mention-slash-commands`, `messaging-slash-commands`, `messaging-context-menu-commands`, `servers-app-command-permissions`, `notifications-apps-slash-commands`, `notifications-apps-command-options`, `notifications-apps-context-menus`, `notifications-apps-command-permissions`, `notifications-apps-interactions`, `notifications-apps-command-mentions`
- **W14-D Message components and modals** (M). Owns `bubbles/components/**`, `features/appModals/**`, `apps/server/src/modules/interactions/componentValidation.ts`. Touches `rows/DiscordMessageRow.tsx` (component slot). Acceptance: buttons in up to 5x5 rows with styles, link buttons through the leaving-site warning, spinner, "This interaction failed"; string, user, role, mentionable and channel selects with search; app modals with up to 5 inputs; a recursive Components V2 renderer; validation covered by shared and server tests. Features: `messaging-components-buttons`, `messaging-components-selects`, `messaging-components-v2`, `messaging-modals`, `notifications-apps-buttons`, `notifications-apps-selects`, `notifications-apps-modals`, `notifications-apps-components-v2`
- **W14-E App Directory, launcher, activities, SDK, bots in voice** (L). Owns `apps/server/src/modules/appDirectory/**`, `modules/activities/**`, `features/appDirectory/**`, `features/activities/**`, `packages/sdk/**`. Touches `voice/view/VoiceGrid.tsx` (activity tile). Acceptance: Discover → Apps with categories, an app page and Add App; composer and voice launcher; activities in a sandboxed iframe on `ACTIVITIES_ORIGIN` with a postMessage RPC, OAuth handoff, per-room state in Valkey, "X started an activity" with Join, and PiP; `@enbox/sdk` over the public API and OAuth; server-side bots publish audio into LiveKit rooms (rtc-node). Features: `messaging-app-launcher`, `servers-app-directory`, `servers-activities`, `voice-activities`, `voice-bots-in-voice`, `notifications-apps-app-directory`, `notifications-apps-app-launcher`, `notifications-apps-activities`, `notifications-apps-social-sdk`
- **W14-F Activity presence: bots, rich presence, manual activity, privacy, history** (M). Owns `apps/server/src/services/presenceActivities.ts`, `jobs/activityHistoryPrune.ts`, `features/activity/**`, `settings/activityPrivacy/**`. Touches `cluster/presenceRegistry.ts` (activities per session in a Valkey hash with TTL). Acceptance: activities ride `presence:update`, filtered per viewer by activity privacy with a per-Space override; "In voice" derived from voice states; a "Set activity" editor (Playing, Listening, Watching); bots set activities through the gateway; activity cards with timers, party and buttons; Ask to Join relay; a 30-day recent-activity tab from bounded upserts. Features: `social-activity-rich-presence`, `social-game-invites-join`, `social-recent-activity`, `social-activity-privacy`, `customization-activity-privacy`, `customization-activity-registered-games`, `notifications-apps-bot-presence`, `notifications-apps-rich-presence`

**Deploy check.** A sample bot (in `/examples`) connects through the gateway on both processes, answers `/ping` within 3 s and round-trips a button click; it installs with a managed role through OAuth; revoking it in Authorized Apps kills its token within a second; an activity iframe loads only from the sandbox origin.

### W15. Connections, integrations, linked roles, widgets, achievements

**Goal.** Linked accounts on profiles (GitHub, Spotify, Steam, Twitch, YouTube, domain and more, each behind its own switch), Spotify listening and Listen Along, Twitch and YouTube subscriber roles, streaming status, linked roles, game widgets and game profiles via IGDB, and Quests/Orbs as free in-app achievements.

**Contracts.** Migration `0020_connections.sql`: `user_connections` (tokens encrypted), `space_roles.link_requirements`, `user_role_connections`, `games` cache, `user_profile_widgets`, `achievements`, `user_achievements`. Shared: `CONNECTION_PROVIDERS` registry; Connection, Widget, Game and Achievement types; streaming and listening activity types. Config: per-provider client id/secret (a provider shows only when configured), `CONNECTIONS_KEY`, IGDB credentials. OAuth state and PKCE live in Valkey for 10 minutes, so any process can finish the callback.

- **W15-A Connections framework and profile display** (L). Owns `apps/server/src/modules/connections/**`, `settings/connections/**`, `features/profile/connections/**`. Touches `modules/users/profile.ts` (visible connections). Acceptance: Settings → Connections grid of configured providers, cards with "Display on profile" and "Display as status" toggles and remove; OAuth for GitHub, Google/YouTube, Spotify, Twitch, Reddit and X, Steam OpenID, Bluesky and Mastodon; domain verification by DNS TXT; verified ticks on profiles; hidden in streamer mode. Features: `social-connections`, `customization-profile-connections-display`, `customization-connections`, `notifications-integrations-connections`
- **W15-B Spotify, Twitch, YouTube, streaming status** (L). Owns `apps/server/src/modules/integrations/**`, `jobs/spotifyPoll.ts`, `jobs/subscriberSync.ts`, `features/integrations/**`. Touches `services/presenceActivities.ts` (listening and streaming). Acceptance: Spotify currently-playing polled on a per-user budget by a leader job, listening card and Listen Along via the Web Playback SDK (Premium only); Twitch EventSub for live status, purple streaming status with Watch, subscriber tiers synced to managed roles with a grace period; YouTube memberships when API access is granted; a slim now-playing card above the voice panel. Features: `layout-user-panel-activity`, `servers-twitch-youtube-integrations`, `social-streaming-status`, `social-spotify-listen-along`, `notifications-integrations-twitch`, `notifications-integrations-youtube`, `notifications-integrations-streaming-status`, `notifications-integrations-spotify`
- **W15-C Linked roles** (M). Owns `apps/server/src/modules/linkedRoles/**`, `features/linkedRoles/**`. Touches `spaces/settings/roles/LinksTab.tsx`. Acceptance: role editor Links tab with connection and app metadata requirements; a member Linked Roles page with Connect buttons; roles granted and revoked when metadata changes, bounded per user; verified mark on linked roles. Features: `servers-linked-roles`, `social-linked-roles`, `notifications-apps-linked-roles`
- **W15-D Profile widgets, game catalogue, game profiles** (M). Owns `apps/server/src/modules/games/**`, `modules/widgets/**`, `features/widgets/**`, `features/games/**`. Touches `profile/full/FullProfileModal.tsx` (Widgets tab). Acceptance: widgets editor (favourite, playing, want-to-play, played games, text, links, pinned media; up to 8 with drag order), widget media protected by mediaGc; IGDB proxy cached in Postgres and Valkey; game profile modal with friends who play (LIMIT 50); `@game` autocomplete and pill; without IGDB, games are free text. Features: `messaging-mention-game`, `social-profile-widgets`, `social-game-profiles`, `customization-profile-widgets`
- **W15-E Achievements (free Quests and Orbs)** (M). Owns `apps/server/src/modules/achievements/**`, `features/achievements/**`. Touches `services/events.ts` (domain event listeners). Acceptance: an achievements page in the Home sidebar (join Spaces, voice minutes, first thread…) fed by domain events through bounded atomic upserts; completing one unlocks an exclusive free cosmetic and a badge; Orbs are a cosmetic currency granted by achievements only, no sponsors and no money. Features: `layout-home-quests-page`, `social-orbs-quests`, `customization-shop-orbs-quests`, `notifications-premium-orbs-quests`

**Deploy check.** Link GitHub and Spotify with keys set; the connection shows on the profile; Spotify listening appears for a friend within the poll interval, polled only on the leader; a provider without keys does not appear; a linked-role requirement grants the role; a widget game search returns IGDB results.

### W16. Phone shell, PWA, i18n, accessibility pass, desktop shell, extras

**Goal.** Finish parity: Discord phone swipe panels and server view, PWA share target, localisation, the accessibility pass (saturation, contrast, screen reader), a Tauri desktop shell (tray, global push-to-talk, game detection, overlay window, clips), plus summaries, a yearly recap, locked role-gated previews and the living-room voice layout.

**Contracts.** Migration `0021_finish.sql`: `user_recaps`, `channel_summaries`, `chats.show_locked_preview` (`users.locale` already exists from W13). Add the i18n library (i18next or Lingui) with an extraction script and one namespace per top-level folder. Config `LLM_PROVIDER`, `LLM_KEY` (summaries, opt-in per Space), `DESKTOP_UPDATE_FEED`. Create the `apps/desktop` Tauri 2 workspace skeleton. Manifest `share_target` entry.

- **W16-A Phone swipe panels, server view, share target** (L). Owns `features/mobileShell/**`, `features/share/**`, `public/manifest.webmanifest`. Touches `public/sw.js` (share POST handler). Acceptance: phone swipe panels with a direction lock and an edge zone that does not fight swipe-to-reply (rail and channels left, member list right, chat peeking); tapping the channel header opens a details sheet (Members, Pins, Threads, Search, Notifications, Settings, Invite); server-view quick buttons; the PWA share target opens a destination picker and sends; long-press sheets everywhere. Features: `layout-mobile-swipe-panels`, `layout-mobile-server-view`, `messaging-share-sheet`, `notifications-platform-mobile`
- **W16-B i18n framework and shell/settings localisation** (L). Owns `lib/i18n/**`, `apps/web/src/locales/**`, `settings/language/**`. Touches `components/layout/**`, `features/settings/**`, `features/home/**` (string extraction only). Acceptance: lazy locale bundles, ICU plurals, Intl dates, "Use browser language", a Language page with native names; shell, settings and Home strings extracted; display-name style fonts follow the locale; English complete plus at least two seeded locales. Features: `customization-language`
- **W16-C Conversation, Spaces and server-side localisation** (L). Owns `apps/server/src/i18n/**`. Touches `features/conversation/**` and `features/spaces/**` (string extraction only), `modules/push/**` (localised titles). Acceptance: all conversation and Spaces strings extracted; system-message wording locale-aware; push titles and bodies built in the recipient's `users.locale`; a CI check fails on new hard-coded strings in extracted folders. Features: `notifications-platform-localization`
- **W16-D Tauri desktop shell: tray, global keys, game detection, overlay window, clips** (L). Owns `apps/desktop/**`, `lib/desktopBridge.ts`, `features/clips/**`. Touches `features/settings/sections.ts` (Windows/OS, Overlay, Clips pages when the bridge is present). Acceptance: Tauri app wrapping enbox.dev with tray unread badge, flashFrame, start on boot, minimise to tray, window-state persistence, custom frame feeding the title bar, a hardware-acceleration toggle, global push-to-talk and mute; process-list game detection feeding activity; an always-on-top click-through overlay window with voice members and notifications (the in-game overlay without injection); clips from a rolling MediaRecorder buffer with a keybind and gallery (also on web for streams); auto-update from GitHub releases; signing is a user action. Features: `layout-desktop-window-behaviors`, `layout-in-game-overlay`, `social-game-detection`, `voice-game-overlay`, `voice-clips`, `customization-os-settings`, `customization-advanced-hardware-acceleration`, `customization-activity-overlay`, `customization-clips-settings`, `notifications-game-overlay`, `notifications-platform-desktop-app`
- **W16-E Accessibility pass and app icon** (M). Owns `features/settings/accessibility/**`, `lib/announcer.ts`, `conversation/rows/a11y.ts`. Touches `index.css` (oklch saturation, contrast token sets, underlined links). Acceptance: Accessibility page with saturation ("apply to custom colours"), contrast and forced-colours support, always-underline links, role colour mode, send button, TTS rate, sticker and emoji animation; messages carry composed aria labels (author, time, content, reactions, reply context), spoilers are buttons; one shared live announcer; cosmetic layers aria-hidden; in-app icon variants with favicon swap; axe checks pass on the shell. Features: `layout-accessibility-layout`, `messaging-screen-reader`, `messaging-accessibility-settings`, `customization-appearance-app-icon`, `customization-a11y-saturation`, `customization-a11y-contrast`, `customization-a11y-link-underline`, `customization-a11y-screen-reader`
- **W16-F Summaries, recap, locked previews, living room, platform notes** (M). Owns `apps/server/src/modules/summaries/**`, `modules/recap/**`, `jobs/summaries.ts`, `jobs/recap.ts`, `modules/spaces/lockedPreview.ts`, `features/summaries/**`, `features/recap/**`, `features/voice/livingRoom/**`. Touches `ChannelSidebar.tsx` (locked rows). Acceptance: opt-in channel summaries from a leader job through `LLM_PROVIDER` with bounded input and a side panel of topic cards with Jump, hidden when unset; a December recap from keyset-batched stats as a card carousel; "Requires role" locked channel stubs (name only, never content, never joined to rooms) as the free stand-in for server subscriptions; living-room voice layout toggle; new ids use `uuidv7()` where supported; a web-platform note in Help. Features: `messaging-summaries`, `servers-server-subscriptions`, `voice-living-room-layout`, `notifications-dev-snowflakes`, `notifications-premium-server-subscriptions`, `notifications-platform-web`, `notifications-platform-checkpoint`

**Deploy check.** On a phone, swipe between channels, chat and members in a Space, and share a photo from the gallery into a channel; switch language and a push title arrives localised; the desktop build installs, shows the tray badge and global push-to-talk works while unfocused; the axe scan of the shell has no serious violations; summaries run only on the leader with the key set.

## Feature matrix

Every gap-matrix id appears exactly once, in one workstream or in Exclusions. Status is from the gap matrix (exists = already built, only small polish). Size is the gap-matrix estimate.

### Layout, navigation and Home

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| layout-app-shell-columns | Desktop four-column shell | partial | W1-B | XL |
| layout-title-bar | Top title bar | missing | W1-B | M |
| layout-back-forward-navigation | Back / Forward navigation | partial | W1-B | S |
| layout-ui-refresh-2025 | 2025 visual refresh | partial | W1-F | L |
| layout-shape-language | Circles for people, squircles for things | partial | W1-A | M |
| layout-ui-density | UI density | missing | W1-F | S |
| layout-themes-base | App themes | partial | W1-F | L |
| layout-message-display-cozy-compact | Cozy vs Compact display | partial | W2-B | M |
| layout-chat-font-scaling-zoom | Chat font scaling and zoom | partial | W1-F | S |
| layout-rail-home-button | Rail Home button | missing | W1-A | S |
| layout-rail-unread-dm-bubbles | Unread DM avatars on the rail | missing | W1-A | S |
| layout-rail-separator | Rail separator | partial | W1-A | S |
| layout-rail-server-icons | Server icons on the rail | partial | W1-A | M |
| layout-rail-pill-indicator | Rail pill indicator | partial | W1-A | S |
| layout-rail-mention-badge | Rail mention badges | partial | W1-A | S |
| layout-rail-activity-badges | Rail voice/event/live glyphs | missing | W8-C | S |
| layout-rail-offscreen-mentions | Off-screen rail indicators | missing | W1-A | S |
| layout-rail-folders | Server folders | missing | W5-E | L |
| layout-rail-drag-reorder | Rail drag reorder | missing | W1-A | M |
| layout-rail-add-server | Add a Server | partial | W12-F | M |
| layout-rail-discover | Discover button | missing | W12-C | L |
| layout-rail-download-apps | Download Apps button | missing | W1-A | S |
| layout-rail-server-context-menu | Server icon context menu | missing | W2-E | M |
| layout-server-preview-mode | Server preview (lurk) | missing | W12-C | L |
| layout-dm-sidebar-search | Find or start a conversation | missing | W1-C | S |
| layout-dm-sidebar-nav-links | Home sidebar fixed links | missing | W1-C | S |
| layout-dm-create-dm | Create DM / group DM popout | partial | W7-E | M |
| layout-dm-list-rows | DM list rows | partial | W1-C | M |
| layout-dm-list-ordering | DM list ordering and paging | partial | W4-B | L |
| layout-dm-pinning | Pin DMs | partial | W1-C | S |
| layout-dm-context-menu | DM row context menu | partial | W7-D | M |
| layout-dm-bulk-leave-groups | Bulk-leave inactive group DMs | missing | W7-E | S |
| layout-dm-wave-prompt | Wave prompt for new friends | missing | W7-B | S |
| layout-dm-message-requests | Message Requests inbox | missing | W7-C | L |
| layout-dm-header-toolbar | DM header | partial | W7-D | M |
| layout-dm-profile-side-panel | DM profile side panel | partial | W7-D | M |
| layout-dm-call-area | DM call area | partial | W9-D | M |
| layout-friends-page | Friends page | missing | W7-A | XL |
| layout-friends-row-actions | Friend row actions | missing | W7-A | S |
| layout-friends-pending | Pending friend requests | missing | W7-A | M |
| layout-friends-blocked-ignored | Blocked tab and Ignore | partial | W7-F | M |
| layout-friends-add-friend | Add Friend panel | missing | W7-A | M |
| layout-friends-active-now | Active Now column | missing | W9-E | M |
| layout-friends-empty-states | Friends empty states | missing | W7-A | S |
| layout-friend-nicknames-favorites | Friend nicknames and favourites | partial | W7-A | S |
| layout-friend-online-notifications | Friend-online notifications | missing | W7-B | M |
| layout-home-nitro-page | Nitro page (becomes Perks) | missing | W3-E | S |
| layout-home-shop-page | Shop page (Collectibles) | missing | W3-E | M |
| layout-home-quests-page | Quests page (achievements) | missing | W15-E | L |
| layout-channel-sidebar-header | Server header and banner | partial | W2-E | S |
| layout-channel-sidebar-top-links | Channel sidebar shortcuts | missing | W12-B | S |
| layout-channel-categories | Collapsible categories | partial | W2-E | M |
| layout-channel-rows | Channel rows and states | partial | W2-E | S |
| layout-channel-voice-occupants | Voice occupants in the sidebar | missing | W8-C | L |
| layout-channel-unread-jump-pills | Unread/mention jump pills | missing | W2-E | S |
| layout-channel-list-resize | Resizable sidebar | missing | W1-B | S |
| layout-channel-pinning | Pin channels | missing | W2-E | S |
| layout-channel-hide-muted | Hide muted channels | missing | W2-E | S |
| layout-channel-reorder-drag | Drag-reorder channels and categories | partial | W4-F | M |
| layout-user-panel | User panel | missing | W1-D | M |
| layout-user-panel-account-popout | Account / status popout | partial | W1-D | M |
| layout-voice-connection-panel | Voice connection panel | missing | W8-D | M |
| layout-user-panel-activity | Now-playing panel | missing | W15-B | L |
| layout-in-app-pip | In-app picture-in-picture | partial | W8-B | S |
| layout-channel-header | Server channel header | partial | W2-E | S |
| layout-header-threads-button | Threads popout | missing | W10-B | M |
| layout-header-notification-bell | Channel notification bell | partial | W2-E | S |
| layout-header-pins | Pinned messages popout | partial | W2-D | M |
| layout-member-list-toggle | Member list toggle | partial | W2-E | S |
| layout-member-list | Member list panel | partial | W11-F | XL |
| layout-header-search | Header search and results | partial | W4-E | L |
| layout-inbox | Inbox popout | missing | W5-C | L |
| layout-help-button | Help button | partial | W1-B | S |
| layout-thread-side-panel | Thread side panel | missing | W10-A | L |
| layout-voice-channel-view | Voice/stage view | missing | W8-B | XL |
| layout-quick-switcher | Quick Switcher | missing | W4-D | M |
| layout-quick-switcher-prefixes | Quick Switcher prefixes | missing | W4-D | S |
| layout-shortcuts-modal | Shortcuts overlay | missing | W4-C | S |
| layout-shortcuts-navigation | Navigation shortcuts | missing | W4-C | M |
| layout-shortcuts-panels-chat | Panel and chat shortcuts | partial | W4-C | M |
| layout-message-keyboard-navigation | Keyboard message navigation | missing | W4-C | M |
| layout-keybinds-settings | Custom keybinds page | missing | W8-E | M |
| layout-mobile-overall | Mobile layout | partial | W1-B | L |
| layout-mobile-swipe-panels | Mobile swipe panels | missing | W16-A | L |
| layout-mobile-you-bar | Mobile You Bar | missing | W1-D | M |
| layout-mobile-bottom-tabs-legacy | Mobile bottom tabs | partial | W1-B | S |
| layout-mobile-dm-list | Mobile Messages list | partial | W1-C | S |
| layout-mobile-notifications | Mobile Notifications feed | missing | W5-C | L |
| layout-mobile-you-page | Mobile You page | partial | W1-D | M |
| layout-mobile-launchpad | Mobile Launchpad | missing | W4-D | S |
| layout-mobile-server-view | Mobile server channel list | partial | W16-A | S |
| layout-mobile-voice-bar | Mobile voice bar and PiP | partial | W9-D | S |
| layout-tablet-layout | Tablet layout | partial | W1-B | M |
| layout-responsive-breakpoints | Responsive width budget | partial | W1-B | M |
| layout-window-title-favicon | Window title and unread favicon | missing | W5-F | S |
| layout-taskbar-badge-tray | App badge (tray in W16-D) | missing | W5-F | S |
| layout-desktop-window-behaviors | Desktop window behaviours | missing | W16-D | L |
| layout-loading-and-connection | Loading and connection state | partial | W5-F | M |
| layout-notice-banners | Notice banners | partial | W1-B | S |
| layout-chat-new-messages-bar | New-messages and jump bars | partial | W2-D | M |
| layout-remember-last-location | Remembered locations and links | partial | W1-B | M |
| layout-read-state-sync | Cross-device read state | partial | W4-B | M |
| layout-user-context-menu | User context menu | partial | W2-F | M |
| layout-developer-mode-ids | Developer Mode copy ID | missing | W2-D | S |
| layout-settings-modal | User Settings full-screen layout | partial | W1-E | M |
| layout-whats-new-changelog | What's New | missing | W1-E | S |
| layout-streamer-mode | Streamer Mode | missing | W5-F | S |
| layout-accessibility-layout | Accessibility layout options | partial | W16-E | M |
| layout-nameplates-in-lists | Nameplates and decorations in lists | missing | W3-C | M |
| layout-in-game-overlay | In-game overlay (overlay window) | missing | W16-D | XL |
| layout-empty-states-wumpus | Illustrated empty states | partial | W2-B | M |

### Messaging

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| messaging-composer | Chat bar | partial | W2-C | L |
| messaging-character-limit | Length limit and counter | partial | W2-C | S |
| messaging-composer-markdown-preview | Live markdown preview | missing | W6-F | L |
| messaging-composer-formatting-toolbar | Selection formatting toolbar | missing | W6-F | M |
| messaging-autocomplete | Composer autocomplete | partial | W2-C | M |
| messaging-emoticon-conversion | Emoticon to emoji | missing | W2-C | S |
| messaging-spellcheck | Spellcheck toggle | partial | W2-C | S |
| messaging-send-button-setting | Show send button | partial | W2-C | S |
| messaging-drafts | Per-channel drafts | exists | W2-C | S |
| messaging-drag-drop-paste | Drag-and-drop and paste | partial | W2-C | S |
| messaging-upload-tray | Attachment tray | missing | W6-D | XL |
| messaging-upload-limits | Upload limits | partial | W6-D | S |
| messaging-image-editing | Edit image before sending | partial | W6-D | M |
| messaging-media-keyboard | Mobile media keyboard | partial | W2-C | S |
| messaging-silent-messages | @silent messages | missing | W2-C | S |
| messaging-tts | Text-to-speech messages | missing | W6-F | M |
| messaging-builtin-commands | Built-in slash commands | missing | W6-F | M |
| messaging-markdown-emphasis | Markdown emphasis | partial | W2-A | L |
| messaging-markdown-headers | Markdown headers | missing | W2-A | S |
| messaging-markdown-subtext | Markdown subtext | missing | W2-A | S |
| messaging-markdown-lists | Markdown lists | missing | W2-A | S |
| messaging-markdown-masked-links | Masked links | missing | W2-A | S |
| messaging-markdown-autolinks | Autolinks | partial | W2-A | M |
| messaging-markdown-blockquotes | Block quotes | missing | W2-A | S |
| messaging-markdown-inline-code | Inline code | partial | W2-A | S |
| messaging-markdown-code-blocks | Code blocks with highlighting | partial | W2-A | M |
| messaging-markdown-ansi | ANSI code blocks | missing | W2-A | S |
| messaging-markdown-spoilers | Spoiler text | missing | W2-A | M |
| messaging-markdown-escaping | Escaping | missing | W2-A | S |
| messaging-timestamps | Dynamic timestamps | missing | W2-A | S |
| messaging-time-picker | @time picker | missing | W2-C | M |
| messaging-mention-users | User mentions | partial | W2-F | S |
| messaging-mention-roles | Role mentions | partial | W2-F | M |
| messaging-mention-everyone-here | @everyone and @here | partial | W2-C | M |
| messaging-mention-channels | Channel mentions | missing | W2-A | M |
| messaging-mention-slash-commands | Slash command mentions | missing | W14-C | S |
| messaging-mention-guild-navigation | Server navigation mentions | missing | W12-A | S |
| messaging-mention-game | @game mentions | missing | W15-D | L |
| messaging-mention-highlight | Mention highlighting | partial | W2-B | S |
| messaging-replies | Inline replies | partial | W2-B | M |
| messaging-reply-ping-toggle | Reply ping toggle | missing | W2-C | S |
| messaging-threads | Threads from messages | missing | W10-A | XL |
| messaging-threads-browser | Threads browser | missing | W10-B | M |
| messaging-private-threads | Private threads | missing | W10-A | M |
| messaging-thread-archive | Thread archive, lock, close | missing | W10-B | M |
| messaging-reactions | Emoji reactions | partial | W6-A | L |
| messaging-double-tap-react | Double-tap to react | missing | W6-A | S |
| messaging-reaction-list | Who reacted | partial | W6-A | M |
| messaging-reaction-moderation | Removing reactions | missing | W6-A | S |
| messaging-super-reactions | Super reactions | missing | W6-A | M |
| messaging-reaction-notifications | Reaction notifications | missing | W6-A | M |
| messaging-emoji-picker | Emoji picker | partial | W6-C | L |
| messaging-custom-emoji | Custom server emoji | missing | W6-B | XL |
| messaging-animated-emoji | Animated emoji playback | partial | W6-B | S |
| messaging-jumbo-emoji | Jumbo emoji | partial | W2-B | S |
| messaging-emoji-popout | Emoji info popout | missing | W6-B | S |
| messaging-stickers | Stickers | missing | W6-B | XL |
| messaging-sticker-suggestions | Sticker suggestions | missing | W6-B | S |
| messaging-gif-picker | GIF picker | missing | W6-C | L |
| messaging-gif-favorites | Favourite GIFs | missing | W6-C | M |
| messaging-gif-autoplay | GIF autoplay | partial | W6-C | S |
| messaging-attachment-images | Images and mosaic | partial | W6-D | M |
| messaging-media-viewer | Media viewer | partial | W6-D | S |
| messaging-attachment-video | Inline video player | partial | W2-B | S |
| messaging-attachment-audio | Inline audio player | partial | W2-B | S |
| messaging-attachment-files | Files and text previews | partial | W6-D | M |
| messaging-attachment-alt-text | Alt text | missing | W6-D | S |
| messaging-attachment-spoiler | Spoiler attachments | missing | W6-D | S |
| messaging-attachment-cdn-expiry | Signed expiring media URLs | missing | W13-F | L |
| messaging-voice-messages | Voice messages | partial | W6-D | M |
| messaging-polls | Polls | partial | W5-D | M |
| messaging-forwarding | Forwarding | partial | W6-F | M |
| messaging-message-links | Message links | partial | W2-D | S |
| messaging-jump-to-message | Jump to message | exists | W2-B | S |
| messaging-jump-to-present | Jump to present | partial | W2-D | S |
| messaging-unread-divider | NEW divider | partial | W2-B | S |
| messaging-new-messages-bar | New messages top bar | missing | W2-D | S |
| messaging-mark-unread | Mark Unread | partial | W2-D | S |
| messaging-mark-read | Mark as read | partial | W4-C | M |
| messaging-no-read-receipts | No receipts in Spaces | partial | W2-D | S |
| messaging-pending-failed | Pending and failed states | partial | W2-B | S |
| messaging-pins | Pinned messages | partial | W2-D | M |
| messaging-edit | Editing | partial | W2-D | M |
| messaging-edited-marker | (edited) marker | partial | W2-B | S |
| messaging-delete | Deleting | partial | W2-D | M |
| messaging-bulk-delete | Bulk delete | partial | W11-D | M |
| messaging-suppress-embeds | Remove embeds | missing | W6-E | S |
| messaging-report-message | Report message | missing | W7-F | M |
| messaging-copy-text | Copy Text and selection | partial | W2-D | S |
| messaging-copy-id-developer-mode | Copy Message ID | missing | W2-D | S |
| messaging-hover-action-bar | Hover action bar | partial | W2-D | M |
| messaging-context-menu | Message context menu | partial | W2-D | M |
| messaging-mobile-action-sheet | Mobile action sheet | partial | W2-D | S |
| messaging-swipe-to-reply | Swipe to reply | partial | W2-B | S |
| messaging-typing-indicator | Typing indicator | partial | W2-C | S |
| messaging-slowmode | Slowmode | partial | W2-C | M |
| messaging-composer-states | Composer locked states | partial | W2-C | S |
| messaging-permission-gating | Messaging permissions | partial | W4-A | L |
| messaging-read-history-permission | Read Message History gate | missing | W4-A | S |
| messaging-message-requests | Message Requests | missing | W7-C | L |
| messaging-spam-filter | DM spam filter | missing | W7-C | L |
| messaging-sensitive-media | Sensitive media filter | missing | W13-E | L |
| messaging-blocked-messages | Blocked users' messages | partial | W2-B | S |
| messaging-ignore-user | Ignore user | missing | W7-F | M |
| messaging-link-safety | Leaving-app link warning | missing | W2-A | S |
| messaging-automod-block | AutoMod blocked messages | missing | W11-B | XL |
| messaging-embeds-link | Link embeds | partial | W6-E | L |
| messaging-embeds-direct-media | Direct media links | missing | W6-E | M |
| messaging-embeds-video-players | Video site players | missing | W6-E | M |
| messaging-embeds-music | Music embeds | missing | W6-E | S |
| messaging-embeds-social | Social post embeds | missing | W6-E | L |
| messaging-embeds-rich | Rich embeds | missing | W10-E | M |
| messaging-invite-embeds | Invite cards | missing | W6-E | S |
| messaging-embed-settings | Embed and media settings | partial | W6-E | S |
| messaging-system-join | Join system messages | partial | W2-B | S |
| messaging-system-boost | Boost system messages | missing | excluded | S |
| messaging-system-pin | Pin system message | partial | W2-B | S |
| messaging-system-other | Other system messages | partial | W2-B | M |
| messaging-channel-beginning | Channel and DM intro headers | missing | W2-B | S |
| messaging-history-scroll | History loading and scroll | partial | W2-B | S |
| messaging-message-grouping | Message grouping | partial | W2-B | S |
| messaging-date-dividers | Date separators | partial | W2-B | S |
| messaging-message-timestamps | Message timestamps | partial | W2-B | S |
| messaging-display-modes | Cozy and Compact display | partial | W2-B | L |
| messaging-author-header | Author line | partial | W2-B | M |
| messaging-profile-popout-from-message | Profile popout from chat | partial | W2-F | M |
| messaging-slash-commands | App slash commands | missing | W14-C | XL |
| messaging-context-menu-commands | Context-menu commands | missing | W14-C | M |
| messaging-app-launcher | App Launcher | missing | W14-E | M |
| messaging-user-installed-apps | User-installed apps | missing | W14-B | L |
| messaging-components-buttons | Buttons | missing | W14-D | M |
| messaging-components-selects | Select menus | missing | W14-D | M |
| messaging-components-v2 | Components V2 | missing | W14-D | L |
| messaging-modals | App modals | missing | W14-D | M |
| messaging-ephemeral-messages | Ephemeral messages | missing | W2-C | M |
| messaging-webhooks | Webhook messages | missing | W10-E | L |
| messaging-announcement-publish | Publish announcements | missing | W10-F | L |
| messaging-search | Message search | partial | W4-E | L |
| messaging-search-filters | Search filters | missing | W4-E | M |
| messaging-search-results | Search results panel | missing | W4-E | M |
| messaging-search-mobile-tabs | Mobile search tabs | partial | W4-E | M |
| messaging-inbox | Inbox | missing | W5-C | M |
| messaging-inbox-mentions | Inbox Mentions | missing | W5-C | L |
| messaging-inbox-unreads | Inbox Unreads | missing | W5-C | M |
| messaging-inbox-for-you | Inbox For You | missing | W5-C | M |
| messaging-bookmarks | Bookmarks | partial | W5-D | M |
| messaging-reminders | Remind Me | missing | W5-D | M |
| messaging-text-in-voice | Text chat in voice | missing | W8-F | M |
| messaging-spoiler-channels | Spoiler channels | missing | W13-E | S |
| messaging-dm-chat | DM conversations on Discord rows | partial | W7-D | L |
| messaging-notification-quick-reply | Notification actions | missing | W5-B | M |
| messaging-share-sheet | Share target | missing | W16-A | M |
| messaging-keyboard-shortcuts | Messaging shortcuts | partial | W4-C | M |
| messaging-message-keyboard-nav | Keyboard message navigation | missing | W4-C | M |
| messaging-screen-reader | Screen reader messages | partial | W16-E | M |
| messaging-accessibility-settings | Chat accessibility settings | partial | W16-E | M |
| messaging-summaries | Conversation summaries | missing | W16-F | L |

### Servers, channels and administration

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| servers-server-rail | Guild rail | partial | W1-A | L |
| servers-folders | Server folders | missing | W5-E | M |
| servers-create-server | Create a server | partial | W12-F | M |
| servers-new-server-checklist | Setup checklist | missing | W12-B | S |
| servers-join-via-invite | Join via invite | partial | W12-D | M |
| servers-preview-lurk | Preview (lurking) | missing | W12-C | L |
| servers-limits | Structure limits | partial | W4-B | S |
| servers-header-menu | Server header menu | partial | W2-E | S |
| servers-channel-list-banner | Banner in channel list | partial | W2-E | S |
| servers-server-context-menu | Server icon menu | missing | W2-E | M |
| servers-leave | Leave server | partial | W2-E | S |
| servers-delete-server | Delete server | partial | W12-F | S |
| servers-transfer-ownership | Transfer ownership | partial | W2-F | S |
| servers-owner-crown | Owner crown | partial | W2-F | S |
| servers-server-profile-settings | Server Profile settings | partial | W12-F | M |
| servers-public-web-page | Public server page | missing | W12-C | M |
| servers-engagement-settings | Engagement settings | partial | W12-F | S |
| servers-system-messages | System messages | partial | W2-B | S |
| servers-afk-channel | AFK channel | partial | W8-A | M |
| servers-notification-settings | Per-server notification settings | partial | W5-A | M |
| servers-privacy-settings | Per-server privacy settings | missing | W7-C | M |
| servers-mark-as-read | Mark as read / unread | partial | W2-E | M |
| servers-member-nickname | Server nickname | partial | W2-F | S |
| servers-member-server-profile | Per-server profile | missing | W3-F | L |
| servers-profile-popout-server | Server details in popout | missing | W2-F | M |
| servers-server-tag-wear | Wear a server tag | missing | W3-F | M |
| servers-server-tag-setup | Server tag setup | missing | W3-F | M |
| servers-channel-list | Channel list | partial | W2-E | M |
| servers-categories | Categories | partial | W2-E | M |
| servers-create-channel | Create Channel modal | partial | W4-F | S |
| servers-reorder-channels | Drag reorder | partial | W4-F | M |
| servers-text-channel | Text channels | partial | W2-E | M |
| servers-channel-header | Channel header and welcome | partial | W2-E | M |
| servers-slowmode | Slowmode | partial | W2-C | S |
| servers-age-restricted-channel | Age-restricted channels | partial | W13-E | M |
| servers-spoiler-channel | Spoiler channels | missing | W13-E | S |
| servers-voice-channel | Voice channels | partial | W8-A | XL |
| servers-text-in-voice | Text in voice | missing | W8-F | M |
| servers-voice-channel-status | Voice channel status | missing | W8-C | S |
| servers-voice-moderation | Voice moderation | partial | W8-A | M |
| servers-stage-channel | Stage channels | missing | W9-B | L |
| servers-announcement-channel | Announcement channels | missing | W10-F | L |
| servers-forum-channel | Forum channels | missing | W10-C | XL |
| servers-forum-new-post | Forum post composer | missing | W10-C | M |
| servers-forum-tags | Forum tags | missing | W10-C | M |
| servers-forum-post-actions | Forum post actions | missing | W10-D | M |
| servers-media-channel | Media channels | missing | W10-D | M |
| servers-rules-and-updates-channels | Rules and updates channels | partial | W12-A | S |
| servers-private-channels | Private channels | partial | W4-F | S |
| servers-channel-permission-overwrites | Permission overwrites | partial | W4-F | M |
| servers-permission-sync | Category permission sync | partial | W4-F | S |
| servers-channel-settings | Channel settings pages | partial | W4-F | M |
| servers-clone-channel | Duplicate channel | missing | W4-F | S |
| servers-delete-channel | Delete channel or category | partial | W4-F | S |
| servers-channel-context-menu | Channel context menu | partial | W2-E | S |
| servers-pin-channels | Pin channels | missing | W2-E | S |
| servers-hide-muted-channels | Hide muted channels | missing | W2-E | S |
| servers-browse-channels | Browse Channels | missing | W12-B | M |
| servers-channels-and-roles | Channels & Roles | missing | W12-B | M |
| servers-channel-links-mentions | Channel mentions and links | partial | W2-A | M |
| servers-channel-naming | Channel naming | exists | W4-F | S |
| servers-threads-public | Public threads | missing | W10-A | XL |
| servers-threads-private | Private threads | missing | W10-A | M |
| servers-thread-archive-lock | Thread archive and lock | missing | W10-B | M |
| servers-threads-browser | Threads browser | missing | W10-B | M |
| servers-thread-actions | Thread actions | missing | W10-B | M |
| servers-announcement-threads | Announcement threads | missing | W10-B | S |
| servers-roles-page | Roles page | partial | W4-A | M |
| servers-role-display | Role display settings | partial | W3-F | S |
| servers-enhanced-role-styles | Gradient/holographic roles | missing | W3-F | S |
| servers-role-icons | Role icons | missing | W3-F | S |
| servers-role-permissions | Role permissions (64-bit) | partial | W4-A | L |
| servers-role-hierarchy | Role hierarchy | exists | W4-A | S |
| servers-role-members | Assign roles | partial | W4-A | S |
| servers-role-mentions | Role, @everyone, @here mentions | partial | W2-F | S |
| servers-view-as-role | View Server As Role | missing | W4-A | M |
| servers-duplicate-role | Duplicate role | missing | W4-A | S |
| servers-linked-roles | Linked roles | missing | W15-C | XL |
| servers-managed-roles | Managed roles | missing | W14-B | S |
| servers-everyone-role | @everyone role | exists | W4-A | S |
| servers-member-list | Member list service | partial | W11-E | XL |
| servers-member-context-menu | Member context menu | partial | W2-F | M |
| servers-members-page | Members page | partial | W11-D | M |
| servers-mod-view | Mod View | missing | W11-D | M |
| servers-timeout | Time out | partial | W2-F | S |
| servers-kick | Kick | partial | W2-F | S |
| servers-ban | Ban with purge | partial | W11-D | M |
| servers-bans-list | Bans list | partial | W11-D | S |
| servers-prune | Prune | missing | W11-D | M |
| servers-access-join-modes | Join modes | missing | W12-B | S |
| servers-member-applications | Member applications | missing | W12-B | L |
| servers-rules-screening | Rules screening | missing | W12-A | M |
| servers-verification-level | Verification level | missing | W11-C | M |
| servers-explicit-media-filter | Explicit media filter | missing | W13-E | L |
| servers-2fa-moderation | 2FA for moderators | missing | W13-B | L |
| servers-dm-spam-protection | DM and spam protection | missing | W7-C | L |
| servers-raid-protection | Raid protection and CAPTCHA | missing | W11-C | L |
| servers-activity-alerts | Activity alerts | missing | W11-C | M |
| servers-security-actions | Pause invites and DMs | missing | W11-C | S |
| servers-report-raid | Report raid | missing | W11-C | S |
| servers-safety-setup | Safety Setup page | missing | W11-C | S |
| servers-automod | AutoMod | missing | W11-A | L |
| servers-automod-keyword | AutoMod keywords | missing | W11-A | M |
| servers-automod-spam | AutoMod spam | missing | W11-B | M |
| servers-automod-mention-spam | AutoMod mention spam | missing | W11-B | S |
| servers-automod-presets | AutoMod presets | missing | W11-A | S |
| servers-automod-member-profile | AutoMod profile filter | missing | W11-B | M |
| servers-automod-responses | AutoMod responses | missing | W11-B | S |
| servers-automod-alerts | AutoMod alerts | missing | W11-B | M |
| servers-audit-log | Audit log | partial | W11-F | M |
| servers-message-moderation | Moderator message actions | partial | W11-D | M |
| servers-age-restricted-server | Age-restricted servers | missing | W13-E | S |
| servers-new-member-badge | New member badge | missing | W2-B | S |
| servers-emoji | Custom emoji | missing | W6-B | L |
| servers-stickers | Custom stickers | missing | W6-B | L |
| servers-soundboard | Soundboard | missing | W9-C | L |
| servers-invite-modal | Invite modal | partial | W12-D | M |
| servers-invite-options | Invite settings | partial | W12-D | S |
| servers-temporary-membership | Temporary membership | missing | W12-D | M |
| servers-role-invites | Role-granting invites | missing | W12-D | S |
| servers-targeted-invites | Targeted invites | missing | W12-D | S |
| servers-guest-invites | Guest invites | missing | W12-D | M |
| servers-invites-management | Invites page | partial | W12-D | S |
| servers-invite-embed | Invite cards in chat | missing | W6-E | S |
| servers-invite-landing-page | Invite landing page | partial | W12-D | M |
| servers-invite-splash | Invite splash | missing | W12-D | S |
| servers-vanity-url | Vanity URL | partial | W12-D | S |
| servers-community-enable | Enable Community | missing | W12-A | M |
| servers-community-overview | Community Overview | missing | W12-A | S |
| servers-onboarding-setup | Onboarding setup | missing | W12-A | L |
| servers-onboarding-questions | Onboarding questions | missing | W12-A | M |
| servers-onboarding-member-flow | Onboarding member flow | missing | W12-A | M |
| servers-server-guide | Server Guide | missing | W12-B | L |
| servers-welcome-screen | Welcome screen | missing | W12-B | S |
| servers-discovery-browse | Server Discovery | missing | W12-C | M |
| servers-discovery-settings | Discovery settings | partial | W12-C | M |
| servers-insights | Server Insights | missing | W12-F | L |
| servers-verified-partnered | Verified badge | missing | W12-C | S |
| servers-boosting | Boosting (free top tier) | missing | W12-D | XL |
| servers-boost-levels | Boost levels (free) | missing | W12-D | M |
| servers-boost-perk-allocation | Perk switches (tags, role styles) | missing | W3-F | M |
| servers-boost-progress-bar | Boost goal bar | missing | excluded | S |
| servers-booster-recognition | Booster recognition | missing | excluded | S |
| servers-events-create | Create event | missing | W12-E | L |
| servers-events-list-rsvp | Events list and RSVP | missing | W12-E | M |
| servers-events-live | Live events | missing | W12-E | M |
| servers-events-share | Event sharing | missing | W12-E | S |
| servers-integrations-page | Integrations page | missing | W10-F | S |
| servers-webhooks | Webhooks | missing | W10-E | L |
| servers-add-apps | Add bots and apps | missing | W14-B | XL |
| servers-app-command-permissions | App command permissions | missing | W14-C | M |
| servers-app-directory | App Directory | missing | W14-E | M |
| servers-twitch-youtube-integrations | Twitch/YouTube integrations | missing | W15-B | L |
| servers-activities | Activities | missing | W14-E | XL |
| servers-template | Server templates | missing | W12-F | M |
| servers-widget | Server widget | missing | W12-F | M |
| servers-settings-navigation | Server Settings layout | partial | W1-E | S |
| servers-unsaved-changes-bar | Unsaved changes bar | partial | W1-E | S |
| servers-developer-ids | Copy IDs | missing | W2-D | S |
| servers-server-subscriptions | Server subscriptions (role-gated previews) | missing | W16-F | XL |
| servers-hubs-directory | Directory channels | missing | W12-C | M |

### Users, social graph and profiles

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| social-unique-username | Unique username | partial | W3-B | S |
| social-display-name | Global display name | partial | W3-B | S |
| social-legacy-username-badge | "Originally known as" badge | missing | W3-A | S |
| social-user-id-and-link | User ID and profile link | partial | W3-A | S |
| social-default-avatar | Generated default avatar | partial | W3-A | S |
| social-avatar | Avatar upload | partial | W3-B | M |
| social-profile-banner | Banner and banner colour | partial | W3-B | S |
| social-profile-theme | Profile theme colours | partial | W3-A | M |
| social-about-me | About Me with markdown | partial | W3-B | M |
| social-pronouns | Pronouns | exists | W3-B | S |
| social-display-name-styles | Display name styles | missing | W3-D | L |
| social-avatar-decorations | Avatar decorations | missing | W3-C | L |
| social-profile-effects | Profile effects | missing | W3-D | M |
| social-nameplates | Nameplates | missing | W3-C | M |
| social-profile-frames | Profile frames | missing | W3-D | M |
| social-shop-collectibles | Collectibles catalogue | missing | W3-E | M |
| social-orbs-quests | Orbs and Quests (achievements) | missing | W15-E | L |
| social-wishlist | Wishlist (favourites shelf) | missing | W3-E | S |
| social-profile-widgets | Profile widgets | missing | W15-D | L |
| social-game-profiles | Game profiles | missing | W15-D | M |
| social-server-tags | Server tags | missing | W3-F | L |
| social-badges | Profile badges | missing | W3-A | M |
| social-tenure-badges | Tenure badges | missing | W3-A | S |
| social-per-server-profile | Per-server profiles | partial | W3-F | L |
| social-server-nickname | Server nickname | exists | W2-F | S |
| social-profile-popout | Profile popout | partial | W3-A | L |
| social-full-profile-modal | Full profile modal | partial | W3-A | M |
| social-dm-profile-panel | DM profile panel | partial | W7-D | M |
| social-mobile-profile-sheet | Mobile profile sheet | partial | W3-A | M |
| social-profile-editor | Profile editor with preview | partial | W3-B | L |
| social-account-panel | Own account panel | missing | W1-D | M |
| social-user-context-menu | User context menu | partial | W2-F | M |
| social-member-since | Member since dates | partial | W2-F | S |
| social-mutuals | Mutual servers and friends | partial | W7-D | M |
| social-roles-in-profile | Roles in profile | missing | W2-F | S |
| social-enhanced-role-styles | Role styles on names | missing | W3-F | M |
| social-user-notes | Private notes | missing | W7-D | S |
| social-friend-nicknames | Friend nicknames | partial | W7-A | S |
| social-connections | Connections | missing | W15-A | XL |
| social-linked-roles | Linked roles | missing | W15-C | XL |
| social-presence-status | Presence status | exists | W1-D | S |
| social-status-duration | Status duration | partial | W1-D | S |
| social-mobile-indicator | Mobile online indicator | missing | W4-B | M |
| social-streaming-status | Streaming status | missing | W15-B | L |
| social-custom-status | Custom status | partial | W1-D | S |
| social-status-reactions-replies | React and reply to status | missing | W7-D | S |
| social-activity-rich-presence | Activity and rich presence | missing | W14-F | XL |
| social-game-invites-join | Join / Ask to Join | missing | W14-F | XL |
| social-spotify-listen-along | Listen Along | missing | W15-B | L |
| social-game-detection | Game detection | missing | W16-D | XL |
| social-recent-activity | Recent activity | missing | W14-F | M |
| social-active-now | Active Now | missing | W9-E | M |
| social-activity-privacy | Activity privacy | missing | W14-F | S |
| social-friends-list | Friends list | missing | W7-A | M |
| social-add-friend | Add Friend by username | missing | W7-A | S |
| social-friend-requests | Friend requests | missing | W7-A | L |
| social-friend-request-note | Request note | missing | W7-A | S |
| social-friend-request-spam | Spam request filtering | missing | W7-B | M |
| social-friend-request-settings | Who can send requests | missing | W7-B | S |
| social-friend-invite-links | Friend invite links | missing | W7-B | M |
| social-contact-sync | Contact matching | partial | W7-B | M |
| social-remove-friend | Remove friend | missing | W7-A | S |
| social-favorite-friends | Favourite friends | missing | W7-A | S |
| social-friend-online-notifications | Friend online alerts | missing | W7-B | M |
| social-block | Block | partial | W7-F | M |
| social-ignore | Ignore | missing | W7-F | M |
| social-blocked-ignored-lists | Blocked and ignored lists | partial | W7-F | S |
| social-report-user | Report user | missing | W7-F | M |
| social-dm-list | DM list | partial | W1-C | L |
| social-dm-create | Start a DM / group DM | partial | W7-E | M |
| social-dm-header | DM header and intro | partial | W7-D | M |
| social-dm-mute-read | DM mute and read controls | partial | W1-C | S |
| social-message-requests | Message requests | missing | W7-C | L |
| social-dm-spam-filter | DM spam filter | missing | W7-C | L |
| social-dm-permissions | Who can DM you | missing | W7-C | M |
| social-dm-safety-alerts | DM safety alerts | missing | W7-C | M |
| social-sensitive-media-filter | Sensitive media filter | missing | W13-E | L |
| social-group-dm | Group DMs (10) | partial | W7-E | L |
| social-group-dm-name-icon | Group DM name and icon | partial | W7-E | S |
| social-group-dm-owner | Group DM owner | partial | W7-E | S |
| social-group-dm-invites | Group DM invite links | partial | W7-E | S |
| social-group-dm-leave | Leave silently | partial | W7-E | S |
| social-profile-privacy | Profile privacy | partial | W13-D | L |
| social-streamer-mode | Streamer mode | missing | W5-F | S |
| social-data-privacy | Data and privacy page | missing | W13-D | S |
| social-data-download | Data export | missing | W13-D | L |
| social-account-email | Email and verification | missing | W13-A | L |
| social-account-phone | Phone verification | partial | W13-C | M |
| social-account-password | Password change and reset | partial | W13-A | S |
| social-mfa | Multi-factor authentication | missing | W13-B | XL |
| social-passkey-login | Passkey login | missing | W13-B | M |
| social-qr-login | QR login | missing | W13-B | M |
| social-account-switcher | Account switcher | missing | W1-D | M |
| social-devices | Devices and sessions | partial | W13-C | S |
| social-authorized-apps | Authorized apps | missing | W14-B | XL |
| social-disable-account | Disable account | missing | W13-C | M |
| social-delete-account | Delete with grace period | partial | W13-C | M |
| social-account-standing | Account standing | missing | W13-D | L |
| social-age-assurance | Age assurance | missing | W13-F | XL |
| social-family-center | Family Center | missing | W13-F | XL |
| social-settings-sync | Settings sync | partial | W1-F | M |
| social-settings-shell | Settings shell | partial | W1-E | L |
| social-share-profile | Share profile link | partial | W3-A | S |
| social-app-profiles | Bot and app profiles | missing | W14-A | L |
| social-cosmetic-motion-settings | Cosmetic motion controls | partial | W3-C | S |

### Voice, video and live

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| voice-channel-join | Join a voice channel | partial | W8-A | XL |
| voice-sidebar-participants | Occupants in the sidebar | missing | W8-C | M |
| voice-speaking-indicator | Speaking indicators | partial | W8-B | S |
| voice-channel-user-limit | User limit | partial | W8-A | S |
| voice-channel-bitrate | Bitrate | missing | W8-F | S |
| voice-channel-region | Region override | missing | W8-F | S |
| voice-channel-video-quality | Video quality mode | missing | W8-F | S |
| voice-channel-create-settings | Voice channel settings | partial | W8-F | M |
| voice-permissions | Voice and stage permissions | partial | W4-A | L |
| voice-channel-status | Voice channel status | missing | W8-C | S |
| voice-text-in-voice | Text chat in voice | missing | W8-F | M |
| voice-connection-panel | Voice Connected panel | missing | W8-D | M |
| voice-connection-info | Ping, debug, privacy | missing | W8-D | S |
| voice-mute-deafen | Self mute and deafen | partial | W8-D | M |
| voice-input-voice-activity | Voice Activity mode | missing | W8-E | M |
| voice-push-to-talk | Push-to-talk | missing | W8-E | M |
| voice-keybinds | Voice keybinds | missing | W8-E | M |
| voice-input-profiles | Input profiles | partial | W8-D | S |
| voice-noise-suppression | Noise suppression | partial | W8-D | S |
| voice-echo-gain-processing | Echo, noise, gain | partial | W8-D | S |
| voice-devices-volume | Devices and volumes | partial | W8-D | M |
| voice-mic-test | Mic test | missing | W8-D | S |
| voice-attenuation | Attenuation (in-app ducking) | missing | W8-D | S |
| voice-advanced-settings | Advanced voice settings | missing | W8-D | S |
| voice-sound-notifications | Call and voice sounds | partial | W5-B | S |
| voice-per-user-volume | Per-user volume | missing | W8-C | M |
| voice-user-context-menu | Voice participant menu | partial | W8-C | M |
| voice-server-mute-deafen | Server mute and deafen | partial | W8-A | S |
| voice-move-members | Move members | missing | W8-A | M |
| voice-disconnect-member | Disconnect member | missing | W8-A | S |
| voice-priority-speaker | Priority speaker | missing | W8-A | S |
| voice-afk-channel | AFK channel | partial | W8-A | M |
| voice-dm-call-start | Start a DM call | partial | W9-D | S |
| voice-incoming-call-ringing | Incoming call ringing | partial | W9-D | S |
| voice-call-system-messages | Call history lines | partial | W2-B | S |
| voice-group-dm-call | Group DM calls | partial | W9-D | M |
| voice-dm-call-ui | DM call layout | partial | W9-D | L |
| voice-camera | Camera | partial | W8-B | M |
| voice-video-backgrounds | Video backgrounds | missing | W9-E | M |
| voice-video-grid | Grid and focus | partial | W8-B | L |
| voice-call-control-bar | Call control bar | partial | W8-B | S |
| voice-call-fullscreen-popout-pip | Full screen, pop-out, PiP | partial | W8-B | M |
| voice-screen-share | Screen share | partial | W9-A | L |
| voice-go-live-game | Go Live | missing | W9-A | M |
| voice-go-live-quality | Stream quality | missing | W9-A | S |
| voice-go-live-watch | Watching streams | missing | W9-A | L |
| voice-stream-zoom-pan | Zoom and pan | missing | W9-A | S |
| voice-go-live-streamer-controls | Streamer controls | missing | W9-A | M |
| voice-stream-request | Request to Stream | missing | W9-A | S |
| voice-mobile-screen-share | Mobile stream viewing | missing | W9-A | L |
| voice-stage-channel | Stage channels | missing | W9-B | L |
| voice-stage-start-topic | Start Stage and topic | missing | W9-B | M |
| voice-stage-speakers-audience | Speakers and audience | missing | W9-B | M |
| voice-stage-request-to-speak | Request to Speak | missing | W9-B | M |
| voice-stage-video | Stage video | missing | W9-B | S |
| voice-stage-text-chat | Stage chat | missing | W9-B | S |
| voice-soundboard | Soundboard | missing | W9-C | L |
| voice-soundboard-management | Soundboard management | missing | W9-C | M |
| voice-entrance-sounds | Entrance sounds | missing | W9-C | S |
| voice-channel-effects | Voice effects | missing | W9-C | S |
| voice-activities | Activities in calls | missing | W14-E | XL |
| voice-presence-in-voice | In Voice presence | missing | W8-C | M |
| voice-invite-to-voice | Invite to Voice | partial | W8-C | M |
| voice-temporary-membership | Temporary membership | missing | W12-D | S |
| voice-device-transfer | Move voice between devices | partial | W8-A | S |
| voice-reconnect-rejoin | Reconnect and rejoin | partial | W8-A | S |
| voice-e2ee | End-to-end encrypted calls | partial | W9-E | XL |
| voice-blocked-ignored-in-voice | Blocked users in voice | missing | W8-C | S |
| voice-moderation-audit | Voice moderation audit | partial | W8-A | S |
| voice-game-overlay | Overlay voice widget (overlay window) | missing | W16-D | XL |
| voice-clips | Clips | missing | W16-D | L |
| voice-mobile-voice-ui | Mobile voice experience | missing | W9-D | L |
| voice-web-browser | Voice in the browser | partial | W8-B | S |
| voice-scheduled-events | Voice and Stage events | missing | W12-E | L |
| voice-streamer-mode | Streamer Mode | missing | W5-F | S |
| voice-call-feedback | Post-call feedback | missing | W8-F | S |
| voice-bots-in-voice | Bots in voice | missing | W14-E | XL |
| voice-server-boost-perks | Voice tier limits (free) | missing | W8-F | M |
| voice-living-room-layout | Living Room layout | missing | W16-F | M |
| voice-accessibility | Voice accessibility | partial | W8-B | S |

### Settings, themes and customization

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| customization-settings-shell | User Settings layer | partial | W1-E | L |
| customization-settings-search | Settings search | missing | W1-E | M |
| customization-settings-unsaved-changes-bar | Unsaved changes guard | missing | W1-E | M |
| customization-settings-cog-quick-menu | Gear quick menu | missing | W1-E | S |
| customization-settings-whats-new | What's New | missing | W1-E | S |
| customization-settings-client-info | Client build info | partial | W1-E | S |
| customization-mobile-you-tab | Mobile You tab | partial | W1-D | M |
| customization-user-panel | Desktop user panel | partial | W1-D | M |
| customization-account-switcher | Account switcher | missing | W1-D | M |
| customization-account-overview | My Account card | partial | W1-E | S |
| customization-account-username | Change username | partial | W3-B | S |
| customization-profile-display-name | Display name | partial | W3-B | S |
| customization-account-email | Change email | missing | W13-A | L |
| customization-account-phone | Phone number | partial | W13-C | M |
| customization-account-password | Change password | partial | W13-A | M |
| customization-account-mfa | MFA | missing | W13-B | XL |
| customization-account-removal | Disable or delete | partial | W13-C | M |
| customization-account-standing | Account Standing | missing | W13-D | L |
| customization-account-devices | Devices | partial | W13-C | S |
| customization-account-family-center | Family Center | missing | W13-F | L |
| customization-profile-editor | Profile editor | partial | W3-B | L |
| customization-profile-live-preview | Live preview card | partial | W3-B | M |
| customization-profile-pronouns | Pronouns | exists | W3-B | S |
| customization-profile-avatar | Avatar upload and crop | partial | W3-B | M |
| customization-profile-avatar-decoration | Avatar decorations | missing | W3-C | L |
| customization-profile-banner | Banner image or colour | partial | W3-B | S |
| customization-profile-theme | Profile theme colours | partial | W3-A | M |
| customization-profile-effect | Profile effects | missing | W3-D | L |
| customization-profile-nameplate | Nameplates | missing | W3-C | L |
| customization-profile-frame | Profile frames | missing | W3-D | M |
| customization-profile-display-name-styles | Display name styles | missing | W3-D | L |
| customization-profile-bio | About Me formatting | partial | W3-B | S |
| customization-profile-server-tag | Wear a server tag | missing | W3-F | M |
| customization-server-tag-config | Server tag config | missing | W3-F | M |
| customization-profile-widgets | Profile widgets | missing | W15-D | L |
| customization-profile-wishlist | Favourites shelf | missing | W3-E | S |
| customization-profile-badges | Badges row | missing | W3-A | M |
| customization-profile-legacy-username-badge | Legacy username toggle | missing | W3-A | S |
| customization-profile-per-server | Per-server profiles | partial | W3-F | L |
| customization-profile-privacy | Profile privacy | partial | W13-D | M |
| customization-profile-popout | Profile popout | partial | W3-A | M |
| customization-profile-full | Full profile page decoration | partial | W3-A | M |
| customization-profile-connections-display | Connections on profile | missing | W15-A | S |
| customization-connections | Connections | missing | W15-A | XL |
| customization-authorized-apps | Authorized apps | missing | W14-B | L |
| customization-profile-notes | Private notes | missing | W7-D | S |
| customization-profile-friend-nickname | Friend nicknames | partial | W7-A | S |
| customization-profile-member-since | Member since dates | partial | W2-F | S |
| customization-status-online | Online status picker | partial | W1-D | S |
| customization-status-custom | Custom status | partial | W1-D | S |
| customization-profile-collectibles | Collectibles inventory | missing | W3-E | M |
| customization-shop | Collectibles gallery | missing | W3-E | M |
| customization-shop-try-on | Try-on preview | missing | W3-B | S |
| customization-shop-gifting | Suggest a cosmetic | missing | W3-E | M |
| customization-shop-orbs-quests | Orbs and Quests | missing | W15-E | L |
| customization-perk-model | Free perks policy | exists | W3-E | S |
| customization-appearance-base-themes | Light, Ash, Dark, Onyx | partial | W1-F | M |
| customization-appearance-sync-with-computer | Sync with computer | exists | W1-F | S |
| customization-appearance-sync-across-clients | Sync across clients | missing | W1-F | M |
| customization-appearance-color-themes | Gradient themes | missing | W1-F | M |
| customization-appearance-custom-theme-editor | Custom theme editor | missing | W1-F | M |
| customization-appearance-ui-density | UI density | missing | W1-F | M |
| customization-appearance-message-display | Cozy or Compact | partial | W2-B | M |
| customization-appearance-compact-avatars | Avatars in Compact | missing | W2-B | S |
| customization-appearance-chat-font-scaling | Chat font scaling | partial | W1-F | S |
| customization-appearance-message-group-spacing | Group spacing | missing | W2-B | S |
| customization-appearance-zoom | App zoom | missing | W1-F | M |
| customization-appearance-channel-list-resize | Resizable sidebar | missing | W1-B | S |
| customization-appearance-app-icon | Custom app icon | missing | W16-E | S |
| customization-appearance-server-folders | Folder name and colour | missing | W5-E | L |
| customization-a11y-saturation | Saturation | missing | W16-E | M |
| customization-a11y-contrast | Contrast | missing | W16-E | M |
| customization-a11y-reduced-motion | Reduced motion | partial | W1-F | S |
| customization-a11y-gif-autoplay | GIF autoplay | exists | W1-F | S |
| customization-a11y-animated-emoji | Animated emoji | missing | W6-B | S |
| customization-a11y-sticker-animation | Sticker animation | missing | W6-B | S |
| customization-a11y-link-underline | Underline links | missing | W16-E | S |
| customization-a11y-role-colors | Role colour display | missing | W3-F | S |
| customization-role-enhanced-styles | Role styles and icons | partial | W3-F | M |
| customization-a11y-display-name-styles-toggle | Show others' name styles | missing | W3-D | S |
| customization-a11y-tts | TTS playback | missing | W6-F | M |
| customization-a11y-keyboard-navigation | Keyboard navigation | partial | W4-C | L |
| customization-a11y-screen-reader | Screen reader | partial | W16-E | M |
| customization-a11y-send-button | Show send button | partial | W2-C | S |
| customization-chat-media-display | Inline media display | missing | W6-D | S |
| customization-chat-embeds-link-previews | Embeds toggle | partial | W6-E | M |
| customization-chat-emoji-reactions-display | Show reactions | missing | W6-A | S |
| customization-chat-emoticon-conversion | Emoticon conversion | missing | W2-C | S |
| customization-chat-emoji-autocomplete | Autocomplete | partial | W2-C | M |
| customization-chat-sticker-suggestions | Sticker suggestions | missing | W6-B | S |
| customization-chat-rich-text-preview | Preview as you type | missing | W6-F | L |
| customization-chat-spoiler-display | Spoiler display | missing | W2-A | S |
| customization-chat-tap-to-react | Tap to react | missing | W6-A | S |
| customization-chat-spellcheck | Spellcheck | partial | W2-C | S |
| customization-notif-desktop | Desktop notifications | exists | W5-B | S |
| customization-notif-badge-flash | Badge and flash | missing | W5-F | S |
| customization-notif-push-timeout | Push inactive timeout | missing | W5-B | M |
| customization-notif-tts | TTS notifications | missing | W6-F | S |
| customization-notif-sounds | Per-sound toggles | partial | W5-B | M |
| customization-notif-reactions | Reaction notifications | missing | W6-A | M |
| customization-notif-friend-online | Friend-online notifications | missing | W7-B | M |
| customization-notif-mobile-push | Mobile push settings | partial | W5-B | M |
| customization-notif-email | Email preferences | missing | W13-A | L |
| customization-notif-server-level | Per-server notifications | partial | W5-A | M |
| customization-notif-overrides | Channel/category overrides | partial | W5-A | M |
| customization-notif-mute-durations | Mute durations | partial | W1-C | S |
| customization-notif-hide-muted-channels | Hide muted channels | missing | W2-E | S |
| customization-notif-threads-forums | Thread notifications | missing | W10-B | M |
| customization-notif-highlights | Highlights | missing | W13-A | L |
| customization-notif-dnd-integration | DND and notifications | exists | W5-A | S |
| customization-keybinds-custom | Custom keybinds | missing | W8-E | M |
| customization-keybinds-defaults | Default shortcuts and sheet | partial | W4-C | L |
| customization-voice-devices | Voice devices and volumes | partial | W8-D | M |
| customization-voice-mic-test | Mic test | missing | W8-D | S |
| customization-voice-input-mode | VAD or PTT | missing | W8-E | M |
| customization-voice-processing | Voice processing | exists | W8-D | S |
| customization-voice-attenuation | Attenuation | missing | W8-D | S |
| customization-voice-advanced | Advanced voice | missing | W8-D | S |
| customization-voice-video-settings | Camera and backgrounds | missing | W9-E | L |
| customization-voice-soundboard-settings | Soundboard volume, entrance sounds | missing | W9-C | M |
| customization-voice-per-user-volume | Per-user volume | missing | W8-C | M |
| customization-streamer-mode | Streamer Mode | missing | W5-F | M |
| customization-language | Language | missing | W16-B | XL |
| customization-os-settings | OS integration (install row, desktop shell) | missing | W16-D | S |
| customization-advanced-developer-mode | Developer Mode | missing | W2-D | S |
| customization-advanced-hardware-acceleration | Hardware acceleration (desktop shell) | missing | W16-D | S |
| customization-advanced-app-test-mode | App test mode | missing | W14-A | S |
| customization-activity-privacy | Activity privacy | missing | W14-F | L |
| customization-activity-registered-games | Manual activity | missing | W14-F | M |
| customization-activity-overlay | Overlay settings (overlay window) | missing | W16-D | S |
| customization-clips-settings | Clips settings | missing | W16-D | S |
| customization-social-sensitive-media | Sensitive media filters | missing | W13-E | L |
| customization-social-dm-spam-filter | DM spam filter | missing | W7-C | L |
| customization-social-server-dms | Server DMs and message requests | missing | W7-C | L |
| customization-social-friend-requests | Who can send friend requests | missing | W7-B | M |
| customization-social-block-ignore | Blocked and ignored users | partial | W7-F | M |
| customization-privacy-data-usage | Data usage page | missing | W13-D | S |
| customization-privacy-data-export | Request my data | missing | W13-D | L |
| customization-billing-pages | Billing pages (Perks) | missing | W3-E | S |

### Notifications, safety, apps and platform

| id | name | status | wave/ws | size |
| --- | --- | --- | --- | --- |
| notifications-desktop-os-notifications | Desktop notifications | partial | W5-B | S |
| notifications-browser-permission-banner | Permission prompt bar | partial | W5-F | S |
| notifications-mobile-push | Mobile push (FCM switch) | partial | W5-B | L |
| notifications-push-inactive-timeout | Push inactive timeout | missing | W5-B | M |
| notifications-push-quick-actions | Push quick actions | missing | W5-B | M |
| notifications-in-app-banners | In-app banners | missing | W5-B | S |
| notifications-sounds | Notification sounds | partial | W5-B | S |
| notifications-tts | TTS notifications | missing | W6-F | M |
| notifications-app-badge | App and tab badge | partial | W5-F | S |
| notifications-taskbar-flash | Taskbar flash (title blink) | missing | W5-F | S |
| notifications-email | Email notifications | missing | W13-A | L |
| notifications-reaction-notifications | Reaction notifications | missing | W6-A | M |
| notifications-friend-request-notifications | Friend request notifications | missing | W7-A | M |
| notifications-call-ringing | Incoming call ringing | partial | W9-D | M |
| notifications-stage-stream-notify | Stage and Go Live notify | missing | W9-B | L |
| notifications-event-notifications | Event notifications | missing | W12-E | L |
| notifications-highlights | Highlights | missing | W13-A | L |
| notifications-server-notification-level | Server notification level | exists | W5-A | S |
| notifications-suppress-everyone | Suppress @everyone/@here | exists | W5-A | S |
| notifications-suppress-roles | Suppress role mentions | missing | W5-A | S |
| notifications-mute-new-events | Mute new events | missing | W5-A | S |
| notifications-mobile-push-per-server | Per-server mobile push | missing | W5-A | S |
| notifications-channel-overrides | Channel and category overrides | partial | W5-A | M |
| notifications-mute | Mute with durations | partial | W1-C | M |
| notifications-hide-muted-channels | Hide muted channels | missing | W2-E | S |
| notifications-server-default-notifications | Server default level | exists | W5-A | S |
| notifications-unread-vs-notify-split | Unread vs notify split | missing | W5-A | M |
| notifications-dm-group-notifications | DM and group levels | partial | W5-A | S |
| notifications-thread-notifications | Thread notifications | missing | W10-B | L |
| notifications-dnd-status | Do Not Disturb | exists | W1-D | S |
| notifications-profiles-gap | Quiet hours via DND + timed mutes | partial | W5-A | S |
| notifications-streamer-mode | Streamer Mode | missing | W5-F | M |
| notifications-game-overlay | Overlay notifications (overlay window) | missing | W16-D | XL |
| notifications-silent-messages | @silent | missing | W2-C | S |
| notifications-reply-ping | Reply mention toggle | missing | W2-C | S |
| notifications-everyone-here | @everyone and @here | partial | W2-C | S |
| notifications-role-mentions | Role mentions | exists | W2-F | S |
| notifications-mention-highlight | Mention highlight | missing | W2-B | S |
| notifications-mention-badges | Mention badges | partial | W1-A | S |
| notifications-unread-pill-server | Server unread pill | partial | W1-A | S |
| notifications-unread-channel | Channel unread state | exists | W2-E | S |
| notifications-dm-rail-stack | Unread DMs on the rail | missing | W1-A | M |
| notifications-folder-unreads | Folder unreads | missing | W5-E | M |
| notifications-new-messages-divider | NEW divider | partial | W2-B | S |
| notifications-new-messages-bar | New messages bars | partial | W2-D | S |
| notifications-sidebar-unread-jump | Sidebar unread pills | missing | W2-E | S |
| notifications-mark-read-channel | Mark channel read | partial | W2-D | S |
| notifications-mark-read-server | Mark server read | missing | W2-E | M |
| notifications-mark-read-folder-category | Mark folder/category read | missing | W2-E | S |
| notifications-mark-unread | Mark unread | partial | W2-D | S |
| notifications-read-state-sync | Cross-device read state | exists | W2-D | S |
| notifications-unread-keyboard | Unread shortcuts | missing | W4-C | M |
| notifications-inbox | Inbox | missing | W5-C | M |
| notifications-inbox-for-you | Inbox For You | missing | W5-C | M |
| notifications-inbox-unreads | Inbox Unreads | missing | W5-C | M |
| notifications-inbox-mentions | Inbox Mentions | missing | W5-C | M |
| notifications-bookmarks | Bookmarks | partial | W5-D | S |
| notifications-reminders | Reminders | missing | W5-D | M |
| notifications-mobile-notifications-tab | Phone Notifications tab | missing | W5-C | M |
| notifications-poll-ended | Poll result notices | missing | W5-D | M |
| notifications-safety-automod | AutoMod | missing | W11-A | XL |
| notifications-safety-automod-keywords | AutoMod keywords | missing | W11-A | M |
| notifications-safety-automod-regex | AutoMod regex | missing | W11-A | M |
| notifications-safety-automod-preset | AutoMod presets | missing | W11-A | M |
| notifications-safety-automod-spam | AutoMod spam | missing | W11-B | L |
| notifications-safety-automod-mention-spam | AutoMod mention spam | missing | W11-B | M |
| notifications-safety-automod-member-profile | Profile quarantine | missing | W11-B | M |
| notifications-safety-automod-actions | AutoMod actions | missing | W11-B | S |
| notifications-safety-automod-blocked-notice | Blocked-message notice | missing | W11-B | S |
| notifications-safety-automod-alerts | AutoMod alerts | missing | W11-B | M |
| notifications-safety-automod-exemptions | AutoMod exemptions | missing | W11-A | S |
| notifications-safety-raid-protection | Raid protection | missing | W11-C | L |
| notifications-safety-activity-alerts | Activity alerts | missing | W11-C | M |
| notifications-safety-security-actions | Security actions | missing | W11-C | M |
| notifications-safety-verification-level | Verification level | missing | W11-C | M |
| notifications-safety-explicit-filter-server | Explicit filter | missing | W13-E | L |
| notifications-safety-mod-2fa | 2FA for moderators | missing | W13-B | S |
| notifications-safety-risky-permissions | Risky @everyone cleanup | missing | W11-C | S |
| notifications-safety-members-page | Members page signals | partial | W11-D | M |
| notifications-safety-mod-view | Mod View | missing | W11-D | M |
| notifications-safety-timeout | Timeout | partial | W2-F | S |
| notifications-safety-suspected-spammer | Suspected spammer | missing | W11-D | M |
| notifications-safety-link-warnings | Link warnings | missing | W2-A | M |
| notifications-safety-sensitive-media | Sensitive media (user) | missing | W13-E | M |
| notifications-safety-sensitive-blur-ui | Blurred media UI | missing | W6-D | S |
| notifications-safety-age-restricted | Age-restricted gates | partial | W13-E | M |
| notifications-safety-age-assurance | Age assurance | missing | W13-F | L |
| notifications-safety-message-requests | Message requests | missing | W7-C | L |
| notifications-safety-dm-spam-filter | DM spam filter | missing | W7-C | M |
| notifications-safety-dm-privacy | Server DM privacy | missing | W7-C | M |
| notifications-safety-friend-request-privacy | Friend request privacy | missing | W7-B | S |
| notifications-safety-friend-request-warning | Unknown-sender warnings | missing | W7-B | S |
| notifications-safety-safety-alerts | DM safety alerts | missing | W7-C | M |
| notifications-safety-block | Block | partial | W7-F | S |
| notifications-safety-blocked-placeholder | Blocked messages placeholder | missing | W2-B | S |
| notifications-safety-blocked-voice-warning | Blocked user in voice warning | missing | W8-C | S |
| notifications-safety-ignore | Ignore | missing | W7-F | M |
| notifications-safety-blocked-list | Blocked and ignored lists | partial | W7-F | S |
| notifications-safety-report-message | Report message | missing | W7-F | M |
| notifications-safety-report-profile | Report profile | missing | W7-F | S |
| notifications-safety-report-other | Report Spaces, events, apps | missing | W7-F | S |
| notifications-safety-report-to-mods | Report to Space moderators | missing | W11-C | M |
| notifications-safety-account-standing | Account Standing | missing | W13-D | M |
| notifications-safety-system-messages | Official system account | missing | W7-F | M |
| notifications-safety-2fa | Two-factor and security keys | missing | W13-B | L |
| notifications-safety-devices | Devices and sessions | partial | W13-C | S |
| notifications-safety-login-alerts | Login alerts | missing | W13-A | M |
| notifications-safety-family-center | Family Center | missing | W13-F | L |
| notifications-safety-rules-screening | Rules screening | missing | W12-A | M |
| notifications-apps-bot-users | Bot users and APP tag | missing | W14-A | XL |
| notifications-apps-app-profile | App profile popout | missing | W14-A | M |
| notifications-apps-install-server | Add app to a server | missing | W14-B | L |
| notifications-apps-user-install | User-installed apps | missing | W14-B | L |
| notifications-apps-oauth2 | OAuth2 | missing | W14-B | XL |
| notifications-apps-authorized-apps | Authorized Apps | missing | W14-B | S |
| notifications-apps-managed-role | Managed bot role | missing | W14-B | S |
| notifications-apps-slash-commands | Slash commands | missing | W14-C | XL |
| notifications-apps-builtin-commands | Built-in commands | missing | W6-F | M |
| notifications-apps-command-options | Command options | missing | W14-C | L |
| notifications-apps-context-menus | Context-menu commands | missing | W14-C | M |
| notifications-apps-command-permissions | Command permissions | missing | W14-C | M |
| notifications-apps-interactions | Interaction lifecycle | missing | W14-C | XL |
| notifications-apps-ephemeral | Ephemeral messages | missing | W2-C | M |
| notifications-apps-buttons | Buttons | missing | W14-D | M |
| notifications-apps-selects | Selects | missing | W14-D | M |
| notifications-apps-modals | Modals | missing | W14-D | M |
| notifications-apps-components-v2 | Components V2 | missing | W14-D | L |
| notifications-apps-command-mentions | Command mentions | missing | W14-C | S |
| notifications-apps-app-directory | App Directory | missing | W14-E | L |
| notifications-apps-app-launcher | App Launcher | missing | W14-E | M |
| notifications-apps-activities | Activities | missing | W14-E | XL |
| notifications-apps-premium | Premium apps | missing | excluded | S |
| notifications-apps-linked-roles | Linked roles | missing | W15-C | L |
| notifications-apps-integrations-page | Integrations page | missing | W10-F | M |
| notifications-apps-bot-presence | Bot presence | missing | W14-F | M |
| notifications-apps-developer-portal | Developer portal | missing | W14-A | XL |
| notifications-apps-rich-presence | Rich Presence | missing | W14-F | L |
| notifications-apps-social-sdk | Social SDK (JS SDK) | missing | W14-E | XL |
| notifications-webhooks-create | Create webhooks | missing | W10-E | M |
| notifications-webhooks-execute | Webhook execute API | missing | W10-E | L |
| notifications-webhooks-display | Webhook rendering | missing | W10-E | S |
| notifications-webhooks-compat | Slack/GitHub-compatible endpoints | missing | W10-E | M |
| notifications-webhooks-security | Webhook token security | missing | W10-E | S |
| notifications-announce-channel | Announcement channels | partial | W10-F | S |
| notifications-announce-publish | Publish | missing | W10-F | L |
| notifications-announce-follow | Follow | missing | W10-F | M |
| notifications-announce-crosspost-render | Crosspost rendering | missing | W10-F | S |
| notifications-integrations-connections | Account connections | missing | W15-A | L |
| notifications-integrations-twitch | Twitch integration | missing | W15-B | L |
| notifications-integrations-youtube | YouTube memberships | missing | W15-B | L |
| notifications-integrations-streaming-status | Streaming status | missing | W15-B | M |
| notifications-integrations-spotify | Spotify | missing | W15-B | L |
| notifications-dev-developer-mode | Developer Mode | missing | W2-D | S |
| notifications-dev-copy-id | Copy ID | missing | W2-D | S |
| notifications-dev-snowflakes | Time-ordered IDs (uuidv7) | partial | W16-F | S |
| notifications-dev-message-links | Message links | partial | W2-D | S |
| notifications-dev-channel-links | Channel links | partial | W2-A | S |
| notifications-dev-mention-syntax | Raw mention syntax | partial | W2-A | M |
| notifications-dev-timestamps | Dynamic timestamps | missing | W2-A | S |
| notifications-dev-link-embeds | Link previews | partial | W6-E | M |
| notifications-dev-video-embeds | Media players | missing | W6-E | M |
| notifications-dev-rich-embeds | Rich embeds | missing | W10-E | M |
| notifications-dev-suppress-embeds | Suppress embeds | missing | W6-E | S |
| notifications-dev-server-widget | Server widget | missing | W12-F | M |
| notifications-dev-deep-links | Deep links and invite cards | partial | W6-E | M |
| notifications-premium-nitro | Nitro mapped to free | partial | W3-E | S |
| notifications-premium-nitro-basic | Nitro Basic (no tiers) | exists | W3-E | S |
| notifications-premium-upload-limits | Upload limits from config | partial | W6-D | S |
| notifications-premium-message-length | Long messages | partial | W2-C | S |
| notifications-premium-server-limit | Server membership cap | exists | W12-F | S |
| notifications-premium-emoji-anywhere | Emoji and stickers anywhere | missing | W6-B | L |
| notifications-premium-streaming-quality | Streaming quality | missing | W9-A | M |
| notifications-premium-profile-perks | Profile perks | partial | W3-D | L |
| notifications-premium-app-themes | App themes | partial | W1-F | M |
| notifications-premium-super-reactions | Super Reactions | missing | W6-A | M |
| notifications-premium-soundboard | Soundboard and entrance sounds | missing | W9-C | L |
| notifications-premium-boosts | Boosts (dropped, top tier free) | missing | W12-D | S |
| notifications-premium-boost-perks | Level-3 perks for every Space | partial | W12-D | M |
| notifications-premium-boost-unlocks | Server tags and role styles | missing | W3-F | L |
| notifications-premium-booster-recognition | Booster recognition | missing | excluded | S |
| notifications-premium-badges | Tenure badge | missing | W3-A | S |
| notifications-premium-gifting | Gifting (suggest a cosmetic) | missing | W3-E | S |
| notifications-premium-shop | Shop (free gallery) | missing | W3-E | L |
| notifications-premium-orbs-quests | Quests and Orbs | missing | W15-E | S |
| notifications-premium-nitro-rewards | Nitro Rewards | missing | excluded | S |
| notifications-premium-server-subscriptions | Server subscriptions (locked previews) | partial | W16-F | M |
| notifications-premium-free-mapping | Free-app mapping policy | partial | W3-E | S |
| notifications-platform-desktop-app | Desktop client (Tauri) | missing | W16-D | XL |
| notifications-platform-web | Web client | exists | W16-F | S |
| notifications-platform-mobile | Mobile layout | partial | W16-A | L |
| notifications-platform-consoles | Console voice | missing | excluded | S |
| notifications-platform-qr-login | QR login | missing | W13-B | M |
| notifications-platform-multi-account | Account switcher | missing | W1-D | M |
| notifications-platform-localization | Localization | missing | W16-C | XL |
| notifications-platform-data-privacy | Data and privacy controls | partial | W13-D | M |
| notifications-platform-whats-new | What's New | missing | W1-E | S |
| notifications-platform-connection-state | Connection states | partial | W5-F | M |
| notifications-platform-checkpoint | Year in review | missing | W16-F | M |

## Exclusions

Only items that are impossible for Enbox, or that have nothing left to build under the free-for-everyone decision. The in-game overlay items are not excluded: W16-D ships them as an always-on-top overlay window in the Tauri shell.

| id | reason |
| --- | --- |
| notifications-platform-consoles | Xbox and PlayStation voice needs console platform partnerships and SDKs that only Microsoft and Sony grant. |
| notifications-premium-nitro-rewards | Nitro Rewards are partner perks bundled with a paid subscription. Enbox has no subscription and every perk is already free; the free achievements in W15-E cover the reward loop. |
| notifications-apps-premium | Premium apps means developers charging money through Discord billing. Enbox has no payments by policy, and apps are free in W14. |
| messaging-system-boost | There are no boosts: every Space has the top perk tier free (W12-D), so "X boosted the server" never happens. |
| servers-boost-progress-bar | A boost goal bar needs purchasable boosts; every Space is permanently at the top tier. |
| servers-booster-recognition | Booster gems and roles need paid boosts. A plain "Supporter" role already works with ordinary roles. |
| notifications-premium-booster-recognition | Same as servers-booster-recognition: nothing to recognise without paid boosts. |

## User actions

Listed in the order the waves need them.

1. **Before W1:** confirm Dark as the default theme for new users, the Enbox violet brand, and deleting the dead Communities web code (server routes stay for the APK).
2. **Before W3:** approve the cosmetic art source. W3 ships original procedural cosmetics; commissioned or licensed APNG/WebP packs and default sticker/soundboard packs can be added later. Approve the OFL fonts for display-name styles.
3. **Before W4:** grant the production DB role `CREATE EXTENSION pg_trgm`; allow migration 0009 (int4→int8) to be rehearsed on a snapshot and run in a short maintenance window; approve installing LiveKit as a systemd service on enfinitos1 (CPU/RAM capped) with the `/livekit/` WebSocket proxy on all 3 nginx domains, and `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in the server env.
4. **Before W8:** confirm router forwarding of TCP 7881 and UDP 7882-7892 to enfinitos1. Until then approve the `relay` fallback: LiveKit TURN/TLS on 443 through an nginx stream SNI split, and coturn's relay range widened beyond 49160-49200 to a range that does not overlap Asterisk RTP.
5. **Before W6:** provide a GIF provider key (Tenor, Klipy or GIPHY) and approve the embed player allow-list (YouTube-nocookie, Vimeo, Twitch, Spotify, SoundCloud), which changes CSP `frame-src`. Optional X and Meta oEmbed tokens.
6. **Before W7:** decide who reviews user reports and appeals (an operator CLI ships in W7; a webhook or email alert destination is optional).
7. **Before W11:** choose a CAPTCHA provider key (Cloudflare Turnstile or hCaptcha) or accept self-hosted ALTCHA proof-of-work; confirm the `re2` native module can build on the host; source licensable AutoMod preset word lists.
8. **Before W12:** confirm nginx on all 3 domains passes `/join/*`, `/servers/*`, `/widget/*` and `/template/*` to Express for OG and public pages.
9. **Before W13:** provide SMTP credentials and SPF/DKIM/DMARC records for the production domains; pick an SMS provider (for example Twilio Verify) and budget; decide the WebAuthn RP ID strategy across the 3 domains; optional MaxMind GeoLite2 key; generate `MFA_ENCRYPTION_KEY` and `MEDIA_SIGNING_SECRET`; decide the NSFW classifier (local ONNX worker on the shared host or an external API) and the age-assurance policy (self-attested until legal review says otherwise).
10. **Before W14:** set up wildcard DNS and TLS for an isolated activities sandbox origin (for example `*.activities.enbox.dev`).
11. **Before W15:** register OAuth apps for each connection wanted (GitHub, Google/YouTube, Spotify with extended quota, Twitch, Reddit, X, a Steam Web API key) with callback URLs on all 3 domains, plus IGDB credentials (Twitch developer app).
12. **Before W16:** Windows and macOS code-signing certificates for the Tauri shell; optional Firebase project for native Android push; optional LLM API key and consent policy for summaries; choose the translation source and the first non-English locales.
13. **After web parity:** plan an Android APK release (Spaces, Discord rows, LiveKit voice, FCM). Server changes stay additive until then.

## Risks

- **64-bit permission migration (W4)** touches every bit check on server and web, the spaceRegistry caches and stored overwrites; a missed spot silently grants or denies access, and one stray JS bitwise operator on a BigInt truncates to 32 bits. Mitigations: done in the contracts step, exhaustive shared tests comparing old and new results on fixtures, the lint rule, legacy int fields side by side, and a rehearsal on a production snapshot.
- **LiveKit on a shared host** that also runs envo, Asterisk and the databases can starve CPU, and UDP ranges can collide. Without forwarded ports, `relay` mode pushes all media through one host and caps voice scale. Mitigations: W4 smoke test, CPU cap, disjoint port plan, and `VOICE_MODE=mesh|off` as kill switches.
- **Reconnect thundering herds** after every deploy (full `GET /api/chats`, `GET /spaces` and per-Space refetches, watermark work). Mitigations: W1 resync jitter, W2 watermark skip for Space chats, W4 paging and delta sync; until W4, deploy at low-traffic times.
- **APK wire compatibility.** Multi-reactions, attachments, BigInt permissions, hidden request DMs, signed media URLs and new chat types can break the installed app. Every change is additive, with contract tests that replay the old client's requests in CI.
- **Rolling deploys.** The old process runs against the new schema during the two-process restart. Every migration is additive; the reaction PK swap, trigram index and column drops run as post-deploy scripts.
- **Shared hot files** (ChatBar.tsx, ChannelSidebar.tsx, MessageList.tsx, stores/spaces.ts, services/messages.ts, spaceNotifications.ts, spaceRegistry.ts) cause merge conflicts between parallel agents. One owner per wave; others make small additive hooks the contracts agent pre-creates; agents rebase often.
- **WhatsApp semantics in shared helpers** (tickStatus, canEditMessage, delete-for-everyone, contacts privacy, MAX_PINNED limits) can regress DMs when Space behaviour branches. Branch only on `isSpaceChatType`, `is_group_dm` or the MARKDOWN flag, and keep the DM test suites green.
- **Fan-out storms** from cosmetics, reactions, voice state, member-list ops and crossposts in large Spaces. Delta events, coalescing windows, version-cached tag definitions and range subscriptions are required, not optional; each wave's deploy check load-tests its new fan-out.
- **Privacy semantics shift** (friends next to contacts, profile visibility levels, message requests) changes who sees avatars, bios and presence everywhere at once. Migrate with explicit mapping tests and announce it in What's New.
- **Cosmetic performance.** Animated decorations, effects and nameplates in long lists hurt low-end phones. Posters by default, animation only on hover, focus or visibility, reduced motion respected, and a 500-row perf budget test in W3.
- **Third-party dependencies** (GIF, oEmbed, OAuth providers, SMTP, SMS, IGDB, Spotify quotas, LLM) add outages, quotas and secrets. Each is behind a switch that hides its UI cleanly, returns a clear "not configured" error on the server, and goes through the SSRF-safe fetcher with Valkey caching.
- **Security surface of the apps platform** (public webhooks, OAuth2, bot gateway, outbound interactions, sandboxed activities). SSRF fence for all outbound calls, Valkey rate limits, hashed or encrypted tokens, Ed25519 signing, a separate sandbox origin, and audits.
- **Moderation false positives** (AutoMod regex, spam heuristics, raid detection). Alert-only defaults, a "report false positive" path, and thresholds tunable per Space.
- **Storage growth on local disk** (attachments, emoji, stickers, sounds, clips, exports, embed cache). mediaGc clauses for every new media column, export expiry, and a later move to object storage if traffic keeps growing.
- **Schedule.** Sixteen large waves on a 16 GB box. Keep W1-W4 acceptance strict (foundations compound), ship contracts plus the most visible streams first when time is short, and budget a fix-up pass after each full test run before push and redeploy.

