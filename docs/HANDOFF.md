# Handoff — 2026-10-23

Written at the end of a long build session on the home computer so work can continue from
another machine. `CLAUDE.md` (repo root) has the standing rules, commands and deploy
procedure; this file has the current state and what to do next.

## Current state

- Branch `claude/discord`, pushed to GitHub. Production runs the head of this branch (see the
  release line at the end of this file).
- Database migrations: 15 (`apps/server/drizzle/0000` … `0014_everyday`).
- Test counts at the last full run: shared 131, server 1075, web 2016, e2e 116 (all passing).
- Main web chunk ~1.32 MB after this batch: keep new panels lazy.

### The last two batches

**polish (b21a9c6, live):** super reactions (burst chips, animation, 30/hour), timed polls
(durations, End Poll Now, results hidden until you vote, answer emoji, a result message), the
formatting toolbar and Ctrl/Cmd+B/I/U/Shift+X, forwarding with a comment and a source line,
ANSI code blocks, Settings ▸ Accessibility (saturation via oklch tokens, contrast, link
underlines, role colour display, sticker/emoji animation, send button, message spacing, skip
link, keyboard navigation between messages), server tags, forum post actions (follow, close,
lock, pin, edit, delete, followed posts in the sidebar, 10 files per post) and media channels.

**everyday (this batch):**
- Message box: typing line, slowmode countdown, 4000-character Space limit with a counter and
  "send as file", `@silent` (MESSAGE_FLAGS.SILENT, no pushes), emoticon conversion, `#channel`
  and `:emoji` suggestions. Channel mentions are `#{<uuid>}` tokens in message text.
- Reading: channel intros, the new-messages bar, "Today at" times, mention highlight, channel
  mention pills, highlight.js code blocks (lazy), the "Leaving Enbox" link warning with trusted
  domains, an emoji popout, folded blocked messages, keyboard actions on a focused message
  (E/R/P/Backspace/+/Ctrl+C), Escape marks read.
- Display: Compact mode, 8 gradient app themes + Custom, a 12–24 px chat font slider, UI
  density, zoom (per device; Ctrl/Cmd +/-/0), and synced preferences (`/api/me/preferences`,
  `me:preferences`; whitelist in `apps/web/src/stores/preferencesSync.ts`).
- Navigation: a desktop title bar (Back/Forward, place, What's New, Help), rail activity glyphs
  and off-screen mention pills, unread jump pills in the channel list, resizable sidebars,
  Online/Offline member list (Spaces ≤ 1000 members), What's New, reopening the last place,
  connection states.
- DMs and friends: a Discord user context menu (names, avatars, member rows; Mention inserts
  into the composer through the `composer:mention` bus event), the DM row menu with Discord mute
  durations, the DM header toolbar, a docked profile panel, friend invite links (`/friend/:code`),
  friend-online alerts.
- Notifications: bookmarks and Remind Me (message menu, Inbox tabs, `reminders` leader job),
  reaction pushes (`reactionNotifications` setting), followed-thread pushes, in-app banners, the
  enable-notifications bar, Discord mute durations everywhere.

### Known limitations worth fixing later

- Zoom: menus/popovers render at 100% while zoomed; the composer toolbar drifts slightly; drags
  in place move faster than the pointer; breakpoints don't change. A full fix divides final
  `top`/`left` by the zoom in `Menu.tsx`, `Popover.tsx` and the other positioned popups.
- Member list Online/Offline split only for Spaces up to 1000 members (large ones need a
  presence-aware Valkey list).
- Reaction push throttle and the AutoMod/rate-limit counters are per process (no cluster-wide
  limiter yet).
- Forum posts are not capped at 4000 characters; slowmode isn't enforced client-side for
  stickers/voice/polls (the server still refuses).
- Desktop notifications (`notifyIncoming` in `apps/web/src/realtime/messages.ts`) don't yet use
  the banners' `wouldNotify` rules (followed threads, muted parent channels).
- No screen to manage trusted link domains yet.

## How many batches are left

The audit in `docs/design/discord-parity.md` ("Remaining gaps (audit 2026-10-23)") grouped what's
missing into 10 waves. After polish and everyday:

| # | Wave | State | Needs from the user |
| --- | --- | --- | --- |
| 1 | Chat feel | mostly done (left: @time picker, live markdown preview, ephemeral messages) | — |
| 2 | GIFs and rich media | not started | a GIF provider key (Tenor / Klipy / GIPHY) |
| 3 | Shell and navigation | mostly done (left: phone swipe panels, pinned channels, share target, big-Space member list) | — |
| 4 | DMs and friends | partly done (left: DM/group calls on LiveKit, spam filter, favourites, DM list paging) | — |
| 5 | Display and themes | done (left: zoom polish, app icon) | — |
| 6 | Notifications and Inbox | mostly done (left: For You feed, push Reply/Mark as read, push timeout while active) | — |
| 7 | Voice and video depth | not started | forwarding LiveKit ports for scale |
| 8 | Permissions and moderation | not started — **do the 64-bit permission move first** (`docs/design/permissions-64bit.md`) | a CAPTCHA key for raid protection |
| 9 | Community growth and invites | not started | — |
| 10 | Account security and safety | not started | SMTP credentials (email, password reset), a WebAuthn domain plan |

Outside those waves (big, separate projects): apps/bots platform, connections (Spotify, Twitch…),
achievements, age assurance, localisation, a desktop app, summaries.

So: about **5 more full batches** for the main gaps (64-bit permissions, voice depth, community
growth, permissions and moderation, account security), plus GIFs once a key arrives, plus the
leftovers of waves 1/3/4/6, and the large separate projects after that.

Recommended order: 64-bit permissions (alone, nothing in parallel) → voice and video depth →
community growth → permissions and moderation depth → leftovers of 1/3/4/6 → GIFs (key) →
account security (SMTP).

## Setting up another computer

1. `git clone https://github.com/itsxifat/enbox.git && cd enbox && git checkout claude/discord`
   (or add a worktree for the branch), then `npm ci`.
2. Test databases (Docker):
   - `docker run -d --name enbox-spaces-pg -e POSTGRES_USER=enbox -e POSTGRES_PASSWORD=enbox -e POSTGRES_DB=enbox -p 127.0.0.1:5442:5432 postgres:18`
   - `docker run -d --name enbox-spaces-valkey -p 127.0.0.1:6390:6379 valkey/valkey:8.1-alpine`
3. E2E: `npx playwright install --only-shell chromium`, and LiveKit `livekit-server` 1.13.10
   (download the release for your OS from github.com/livekit/livekit) run as
   `livekit-server --dev --bind 127.0.0.1`.
4. Production access: the office SSH key and the host address (from the user). Everything
   else is in `CLAUDE.md` ("Production").
5. Smoke scripts: `deploy/smoke/` (README there).

## Waiting on the user

- Sign everyone out once? (old journal entries hold bearer tokens from before hotfix c91305b)
- A GIF provider key; SMTP; optionally 2FA for password changes.
