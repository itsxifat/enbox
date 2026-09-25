# Enbox web client (`@enbox/web`)

React 19 · Vite 7 · Tailwind CSS 4 · React Router 7 · Zustand 5 · socket.io-client 4.
Mobile-first PWA: phones get a single pane with bottom tabs, desktop (≥ 1024px) gets a
WhatsApp-Web-style nav rail + list pane + main pane.

```bash
npm run dev -w @enbox/web          # Vite on :5173, proxies /api /uploads /socket.io → ENBOX_API_URL
npm run typecheck -w @enbox/web
npm run test -w @enbox/web         # vitest (jsdom)
npm run build -w @enbox/web        # → apps/web/dist (served by the API server in production)
```

| Env                    | Where       | Meaning                                                                                                                                |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ENBOX_API_URL`        | dev/preview | Proxy target (default `http://localhost:4000`)                                                                                         |
| `WEB_PORT`, `WEB_HOST` | dev/preview | Port (default 5173) / bind host. `PORT` is _not_ used (the root `npm run dev` shares env with the server); `-- --port 5180` also works |
| `VITE_API_URL`         | build       | Absolute API origin for native wrappers / split deployments (default: same origin)                                                     |
| `VITE_ENABLE_SW`       | dev         | `true` registers the service worker in dev (always on in builds)                                                                       |

See `.env.example`. Screenshots of the shell live in [`docs/screenshots/`](docs/screenshots).

---

## Structure

```
src/
  main.tsx               bootstrap: theme, audio unlock, auth tab-sync, realtime binding, SW
  index.css              Tailwind v4 + design tokens (light/dark)            [shared, append-only]
  app/                   router composition, guards, root layout, error pages [foundation]
  components/
    ui/                  UI kit (Button, Modal, Menu, Sheet, ListItem…)      [shared, append-only]
    layout/              AppShell, NavRail, BottomTabs, SplitView, PaneHeader, MainEmpty, banners
    common/              Logo, ChatAvatar, UserAvatar, Placeholder
  hooks/                 useIsDesktop/useMediaQuery, useBus, useAppVisible, useOnline, useDebouncedValue
  lib/                   api, socket, bus, format, media, notify, push, sw, ids, storage, forms, lazy…
  stores/                zustand stores (auth, chats, messages, users, ui, calls, status, communities)
  realtime/              socket events → stores, one file per domain
  features/<domain>/     UI per domain, each with its own routes.tsx
  test/                  vitest setup + model factories (makeChat, makeMessage, makeUser, makeMe)
public/                  manifest.webmanifest, sw.js, icons/
scripts/screenshots.mjs  Playwright visual check with in-script API/socket mocks
docs/screenshots/        latest screenshots
```

## Feature ownership

Four feature agents build on this foundation in parallel. **Edit only the files you own.**
Shared files are _append-only_: add new exports/actions/events, never change or remove
existing signatures; if you need a breaking change, ask first.

| Owner                                                | Owns (free to edit / add files)                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent 1** — auth, settings, contacts, profile      | `features/auth/**`, `features/settings/**`, `features/contacts/**` (`NewChatPane` at `/new`, `ContactInfoPanel`), new `stores/contacts.ts` if needed                                                                                                                                         | Listen to `contacts:changed` / `blocks:changed` / `user:changed` via `useBus`. Profile edits → `useAuth().setUser(user)`. `realtime/users.ts` is append-only.        |
| **Agent 2** — chat list, conversation, composer      | `features/chats/**`, `features/conversation/**`; primary maintainer of `stores/chats.ts`, `stores/messages.ts`, `realtime/chats.ts`, `realtime/messages.ts` (append-only for others' sake: keep existing signatures)                                                                         | Keep the ConversationPane contract (see below). Lazy-load heavy deps (`emoji-picker-react`) with `lazyNamed`.                                                        |
| **Agent 3** — groups, communities, channels, invites | `features/groups/**` (`/new/group`, `GroupInfoPanel`), `features/communities/**`, `features/channels/**` (`ChannelsSection`, `ChannelPane`, `ChannelInfoPanel`, routes under `/updates/channels`), `features/invites/**` (`/join/:code`), `stores/communities.ts`, `realtime/communities.ts` | Refetch members on `useBus('chat:members-changed')`.                                                                                                                 |
| **Agent 4** — calls (WebRTC), status/stories         | `features/calls/**` (`CallsPane`, `CallOverlay`), `features/status/**` (`StatusSection`, routes under `/updates`), `stores/calls.ts`, `stores/status.ts`, `realtime/calls.ts`, `realtime/status.ts`                                                                                          | Implement `useCalls().startCall(chatId, type)`. Keep `useHasUnseenStatus()`. Keep MediaStreams/RTCPeerConnections out of the store.                                  |
| **Foundation (shared)**                              | `app/**`, `components/**`, `hooks/**`, `lib/**`, `stores/{auth,users,ui}.ts`, `realtime/index.ts`, `realtime/users.ts`, `features/updates/**`, `index.css`, `main.tsx`, configs, `package.json`                                                                                              | **Append-only / ask first.** Prefer adding a new file in your feature folder over editing a shared one. Need a new bus event? Append to `BusEvents` in `lib/bus.ts`. |

### Cross-feature contracts

- **Info panels** (rendered by the conversation inside a `<Sheet>`): `ContactInfoPanel`
  (agent 1, direct chats), `GroupInfoPanel` (agent 3), `ChannelInfoPanel` (agent 3). All take
  `{ chatId: ID; onClose(): void }` (`InfoPanelProps`) and render their own `PaneHeader`.
- **ConversationPane** (agent 2) must call `useChats().setOpenChat(chatId)` while mounted
  (read receipts, unread suppression, notification muting), load via `loadLatest`, and start
  calls with `useCalls().startCall(chatId, 'audio' | 'video')`. `ChannelPane` (agent 3)
  currently reuses it.
- **Updates tab**: `features/updates/UpdatesPane` composes `StatusSection` (agent 4) and
  `ChannelsSection` (agent 3); their child routes come from `features/status/routes.tsx` and
  `features/channels/routes.tsx`.
- **Links**: `/new/group` (agent 3) is linked from `/new` (agent 1) and the chat-list menu
  (agent 2). Status replies (agent 4) use `useMessages().sendMessage(chatId, { type: 'text',
text, statusReplyToId })` after `POST /api/chats/direct`.

---

## Routing & layout

`app/router.tsx` composes `RouteObject[]` exported by each `features/<domain>/routes.tsx`,
so adding a page never touches the router:

```tsx
// features/calls/routes.tsx
const CallsPane = lazyNamed(() => import('./CallsPane'), 'CallsPane'); // code-split
export const callsRoutes: RouteObject[] = [
  {
    path: 'calls',
    element: <SplitView list={<CallsPane />} empty={<MainEmpty icon={Phone} title="Calls" />} />,
    children: [{ path: ':callId', element: <CallDetails />, handle: { detail: true } }],
  },
];
```

- **`SplitView`** — desktop: list pane | main pane (child route or `empty`); phone: the list,
  or the child route full screen when it has `handle: { detail: true }` (bottom tabs hidden;
  the list stays mounted so its scroll position survives).
- **`handle`** flags (`app/routeHandle.ts`): `detail` (phone full-screen main), `hideTabs`
  (phone: hide bottom tabs, e.g. `/new`).
- **`FullView`** — whole content area without a list pane (e.g. `/join/:code`).
- **`PaneHeader`** — standard header (title/subtitle, `back` path or callback with arrow or ×,
  `leading` avatar, `actions`, `large` tab titles, children row for search/chips, safe-area).
  A `back` path goes back in history when the page was opened by an in-app link that passed
  `state: IN_APP_NAV` (`components/layout/navigation.ts`: list → chat, community → its chats,
  search/starred results, channel lists), else replaces the entry with the parent path.
- **Chat links**: `chatPath(chat, { seq?, messageId?, base? })` (`features/chats/links.ts`)
  opens channels in their feed (`/updates/channels/:id`, which also reads `?m=`/`mid`) and
  other chats in the conversation view; ConversationPane redirects channels there.
- **`MainEmpty`** — branded empty main pane. `Placeholder` marks unbuilt screens.
- Route tree: `RootLayout` (toasts, dialogs, bus navigation) → `PublicOnly` (`/login`,
  `/register`) | `RequireAuth` (splash while booting, `/login?next=…` when anonymous) →
  `AppShell` (connection banner, nav rail / bottom tabs, call overlay) → feature routes.
- Tabs: `components/layout/tabs.ts` (`TABS`, `activeTab(pathname)`); badges from
  `useTabBadges()` (unread chats count; Updates dot for unseen status/unread channels).
- Use `useIsDesktop()` (≥ 1024px, same as Tailwind `lg`) for layout decisions in JS.

## Calling the API (`lib/api.ts`)

```ts
const chats = await api.get<ChatSummary[]>('/api/chats');
const chat = await api.post<ApiResponse<'POST /api/chats/direct'>>('/api/chats/direct', { userId });
await api.patch(`/api/chats/${id}/prefs`, { isPinned: true });           // 204 → undefined
await api.delete(`/api/messages/${id}`, undefined, { query: { for: 'everyone' } });
const media = await api.upload(file, await probeMedia(file), (p) => setProgress(p), { signal });
<img src={mediaUrl(user.avatarUrl)} />                                     // resolves VITE_API_URL
```

- Paths are the full catalogue paths from `ApiRoutes` (`@enbox/shared`); `ApiResponse<K>`,
  `ApiBody<K>`, `ApiQuery<K>` derive types from the catalogue.
- Errors throw `ApiError { code, message, status, details }` (`status 0` + `network_error` /
  `timeout` for connectivity). `errorMessage(e)` for UI text, `fieldErrors(e)` maps
  `validation_error` details to `{ field: message }`, `toast.error(e)` shows it.
- A 401 on any authenticated request (except login/register) logs out automatically.
- Forms: `validate(registerSchema, values)` (`lib/forms.ts`) reuses the shared zod schemas.
- Media helpers (`lib/media.ts`): `readImageDimensions`, `readVideoMeta`, `readAudioDuration`,
  `probeMedia(file)` → upload meta, `createObjectUrl`/`revokeObjectUrl`, `fitWithin`.

## Stores (`src/stores/`)

Zustand stores are the contract between features. Use selectors (`useChats((s) => s.byId[id])`)
and the provided hooks; call actions via `useX.getState().action()` outside React. Every
per-account store registers a reset in `lib/session.ts`, run on logout.

| Store                       | State                                                                                                                                        | Actions / hooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                      | `token`, `user: UserSelf \| null`, `status: 'booting'\|'authenticated'\|'anonymous'`, `bootError`                                            | `bootstrap()`, `login(req)`, `register(req)`, `logout({ remote? })`, `setUser(u)`, `patchUser(p)`; `useMe()`, `getMe()`, `getMyId()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `chats`                     | `byId`, `loaded`, `loading`, `error`, `typing[chatId][userId]`, `pins[chatId]`, `openChatId`                                                 | `loadChats()`, `refreshChat(id)`, `upsertChat(s)`, `patchChat(id, p)`, `applyChatUpdate(id, changes)` (`chat:updated`; recomputes `permissions`), `removeChat(id)`, `setTyping(chatId, userId, state)` (auto-expires), `clearTyping()`, `setPins`, `setOpenChat`; `useSortedChats({ archived?, filter?: 'all'\|'unread'\|'groups', kind?: 'chats'\|'channels'\|'all', query? })` (pinned first, then `lastActivityAt` desc), `useChat(id)`, `getChat(id)`, `useTypingUsers(chatId)`, `useUnreadChatsCount()`, `isChatUnread(c)`                                                                                     |
| `messages`                  | `byChat[chatId]: { items, hasMoreBefore, hasMoreAfter, loaded, loadingLatest, loadingBefore, loadingAfter, error }`                          | `loadLatest`, `loadOlder`, `loadNewer`, `loadAround(chatId, seq)` (pages' side-loaded `users` go to the users store), `upsertMessage(m, { onlyIfPresent })` (keeps `starred`/`myReaction`/`poll.myOptionIds`, see `mergeMessage`), `upsertMessages`, `patchMessage`, `removeMessages`, `markQuotesDeleted(messageId)`, `clearChat(chatId, clearedSeq)`, `dropChat`, `addOptimistic`, `patchOptimistic`, `markFailed`, `removeOptimistic`, `sendMessage(chatId, req, { optimistic })`, `retryMessage`; `useChatMessages(chatId)`. Type `ClientMessage = Message & { pending?, failed?, localUrl?, uploadProgress? }` |
| `users`                     | `byId: Record<ID, UserPublic>`, `presence: Record<ID, Presence>` (`online: null` = hidden)                                                   | `upsertUsers`, `fetchUser(id, { force })` (deduped), `fetchUsers(ids, { force })` (batched `POST /api/users/batch`, one request per tick), `invalidateUser`, `setPresence`, `subscribePresence(ids)` / `unsubscribePresence(ids)` (ref-counted, re-sent on reconnect); `useUser(id)` (auto-fetch), `usePresence(id)` (auto-subscribe), `useUserName(id)`, `nameOf(id)`                                                                                                                                                                                                                                              |
| `ui` (persisted `enbox.ui`) | `theme`, `resolvedTheme`, `prefs: { enterToSend, fontSize, wallpaper, wallpaperPattern, sounds, desktopNotifications }`, `toasts`, `dialogs` | `setTheme`, `setPref(key, value)`; imperative `toast.success/error/info`, `confirm({...}) → Promise<boolean>`, `choose({ options }) → Promise<value \| null>`; `WALLPAPERS`, `FONT_SIZES`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `calls` _(agent 4)_         | `incoming: IncomingCallPayload \| null`, `active: ActiveCall \| null`                                                                        | `setIncoming`, `setActive`, `patchActive`, `startCall(chatId, type, userIds?)`, `acceptIncoming()`, `declineIncoming()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `status` _(agent 4)_        | `feed: StatusFeed \| null`, `loaded`                                                                                                         | `loadFeed()`, `applyNew`, `applyDeleted`, `applyViewed`; `useHasUnseenStatus()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `communities` _(agent 3)_   | `byId`, `loaded`                                                                                                                             | `loadCommunities()`, `refreshCommunity(id)`, `upsertCommunity`, `removeCommunity`; `useSortedCommunities()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Components never talk to the socket directly; use `lib/socket.ts` helpers:
`emitWithAck('call:start', payload)` (typed ack → `Promise<data>`, rejects with `ApiError`),
`sendEvent('chat:typing', { chatId, state })` (fire-and-forget, `false` when offline),
`useConnection()` (`state`, `ready`, `sessionId`).

Use `chat.permissions` (computed server-side by `computeChatPermissions`) to gate UI —
composer, info editing, member management, pins, calls, invite links — never re-derive it
from `myRole`/`groupSettings`.

## Realtime flow (`src/realtime/`)

1. `bindRealtimeToAuth()` (main.tsx) starts realtime when `auth.status === 'authenticated'`
   and stops it otherwise. `startRealtime()` loads chats over REST right away (no waiting
   for the socket), connects the single socket (`io(origin, { auth: { token } })`,
   WebSocket first with polling fallback) and registers every domain's handlers.
2. On each server `ready` (first connect **and** reconnects — the socket never replays) the
   domain resyncs run: clear typing indicators, reload `GET /api/chats`, **discard every
   cached message page** except the open chat, reload the open chat's latest page and pins
   (never `after=` catch-up: it would miss edits/deletes/reactions/votes), mark the open chat
   read, re-subscribe presence (subscriptions are per socket), refresh `/api/me` after a
   reconnect, reload status/communities (calls: agent 4 refetches `/api/calls/active`). Then
   the bus emits `realtime:ready` — use it for your own resync.
3. `message:new` (`{ message }` only; the server sends `chat:upsert` first when a chat becomes
   visible) → upsert the message (replacing the optimistic entry by `clientId`), update the
   chat preview/`lastSeq`/`lastActivityAt`, `unreadCount`+1 (non-system messages; and
   mentions) unless it's mine or the chat is open & focused; unknown chats are fetched
   (`GET /api/chats/:id`); unknown user ids (`referencedUserIds`) are batch-fetched. Delivered
   receipts are server-driven (no client event). If the chat is open & focused →
   `markChatRead`, else an in-app sound or a system notification (respecting mute,
   `messageNotifications`/`groupNotifications`, `notificationPreviews` and device prefs).
4. `message:updated` merges into loaded windows only (keeps `starred`, `myReaction`,
   `poll.myOptionIds`; a delete-for-everyone also blanks loaded quotes of it);
   `message:removed` prunes (refetching the chat preview if needed). `chat:upsert` replaces a
   chat, `chat:updated` merges viewer-neutral changes (and recomputes `permissions`),
   `chat:read` sets `lastReadSeq`/`unreadCount`/`unreadMentionCount`/`markedUnread`; other
   `chat:*` events patch the chat store; `chat:members-changed`, `contacts:changed`,
   `blocks:changed`, `user:changed` become bus events; `presence:update` → users store;
   `me:updated` → auth; `session:revoked` (for this session) → logout;
   `connect_error: unauthorized` → logout.
5. `markChatRead(chatId)` (exported from `@/realtime`) emits `chat:read` with the chat's
   `lastSeq` when the app is visible & focused (REST `POST /api/chats/:id/read` when
   offline), and clears the badge optimistically; reading also clears `markedUnread`
   server-side. It runs automatically when the open chat changes and when the window regains
   focus.
6. Calls/status/communities handlers are skeletons owned by agents 3/4; call events are
   forwarded to the bus (`bus.on('call:signal', …)`) so the WebRTC engine can live in
   `features/calls`. `call:ring-stop` (any reason) clears the incoming-call UI.

Bus (`lib/bus.ts`, typed): `realtime:ready`, `chat:members-changed`, `user:changed`,
`contacts:changed`, `blocks:changed`, `status:*`, `call:*`, `navigate`. In components:
`useBus('contacts:changed', refetch)`.

## Optimistic sends

```ts
// Text (and anything without an upload): one call does it all.
await useMessages
  .getState()
  .sendMessage(
    chatId,
    { type: 'text', text, replyToId },
    { optimistic: { replyTo: previewOf(replyMessage) } },
  );

// Media: show the bubble immediately, upload with progress, then send with the same clientId.
const clientId = newClientId();
const localUrl = createObjectUrl(file);
const { addOptimistic, patchOptimistic, markFailed, sendMessage } = useMessages.getState();
addOptimistic(chatId, { clientId, type: 'image', text: caption, localUrl, uploadProgress: 0 });
try {
  const media = await api.upload(file, await probeMedia(file), (p) =>
    patchOptimistic(chatId, clientId, { uploadProgress: p }),
  );
  await sendMessage(chatId, { clientId, type: 'image', mediaId: media.id, text: caption });
} catch {
  markFailed(chatId, clientId);
}
```

Optimistic entries have `id = 'local:<clientId>'`, `seq = 0`, `pending: true`, sit after the
confirmed messages and also become the chat-list preview. The REST response or the
`message:new` echo (whichever comes first) replaces them; the other merges idempotently.
`tickStatus(message, chat)` from `@enbox/shared` gives pending/sent/delivered/read (null =
no ticks: channels, system and call messages). Mentions are `@{<userId>}` tokens inside
`text` (`mentionToken(id)`); render them with `parseMentions`/`renderMentions` — the server
derives `mentions`. Bodies are discriminated by `type` and strict (no foreign fields).

## Styling

- Tailwind v4 with semantic tokens in `src/index.css` (light on `:root`, dark on `.dark`,
  exposed via `@theme inline`). Use them instead of raw colors:
  `bg-app` (window), `bg-surface` (panes), `bg-surface-2` (inputs/chips), `bg-elevated`
  (menus/dialogs), `bg-hover`, `bg-selected`, `border-line`, `border-line-strong`, `text-fg`,
  `text-muted`, `text-subtle`, `bg-brand`/`text-on-brand` (filled), `text-brand-ink` (brand
  colored text/icons — contrast-safe in both themes), `bg-brand-soft`, `bg-bubble-out`,
  `bg-bubble-in`, `text-bubble-out-meta`/`text-bubble-in-meta`, `.chat-wallpaper`,
  `text-danger` (+ `-soft`) for red text/icons, `bg-danger-fill` under white text,
  `success`, `warning`, `text-warning-ink` (warning text on `bg-warning-soft`), `bg-unread`,
  `bg-unread-muted`, `text-tick-read`, `bg-online`, `bg-overlay`, `shadow-elevated`,
  `shadow-bubble`, `text-chat` (user font-size pref). Static brand scale: `violet-50…950`.
- Dark mode is class-based (`dark:` variant works); theme/font-size/wallpaper are applied by
  `initTheme()` and a pre-paint script in `index.html` (no flash).
- Safe areas: `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, `px-safe` (PaneHeader/BottomTabs
  handle top/bottom; AppShell and full-screen overlays use `px-safe` for landscape notches).
- Focus rings: `outline-none focus-visible:outline-2 focus-visible:outline-brand` works (index.css
  restores `--tw-outline-style` on `.outline-none:focus-visible`); don't rely on `focus-visible:bg-hover`
  alone — it is nearly invisible.
  Animations: `animate-fade-in`, `-scale-in`, `-slide-up`, `-slide-in-right`, `-slide-down`,
  `-pop` (reduced-motion respected).
- **There is no tailwind-merge**: `className` overrides must not fight a component's own
  utilities (e.g. passing `rounded-2xl` to a `rounded-full` button). Use variant props
  instead (`Button variant/size`, `IconButton variant/size/shape`, `Input/Textarea
variant="filled"`, `Tabs variant="chips"`), or wrap in an element that you style.

UI kit (`@/components/ui`): `Avatar` (image → initials/icon fallback, deterministic color,
`online` dot, status `ring`, `kind: user|group|channel|community`), `Badge` (99+, dot),
`Button`, `IconButton` (aria-label + native tooltip), `Input`, `Textarea` (auto-resize),
`Field`, `Switch`, `Checkbox`, `RadioGroup`, `Modal` (focus trap, Esc, backdrop, bottom
sheet on phones), `confirm()`/`choose()` + `DialogHost`, `Menu` (anchor element or point —
context menus) and `DropdownMenu`, `Tabs` (underline/chips), `Sheet` (right panel on desktop,
full screen on phones), `ListItem`/`ListSection`, `SearchInput`, `Spinner`/`PageSpinner`,
`Skeleton`/`ListItemSkeleton`, `EmptyState`, `Tooltip`, `Toaster` + `toast`. Plus
`components/common`: `ChatAvatar` (any chat, optional presence), `UserAvatar`, `Logo`.

## PWA, notifications, push

- `public/manifest.webmanifest` + icons (SVG + PNG 192/512 + maskable + apple-touch).
- `public/sw.js`: Web Push with the shared `PushPayload` (`type: 'message' | 'call'` shows a
  notification unless a focused window exists; `dismiss` / `call_cancel` close the
  notification with that `tag`), `notificationclick` focuses/opens and posts `{ type: 'navigate', url }` (routed via
  the bus), offline app shell (network-first navigations, cache-first `/assets/*`; never
  `/api`, `/socket.io`, `/uploads`). Registered in builds (dev: `VITE_ENABLE_SW=true`).
- `lib/notify.ts`: permission helpers, `showNotification` (only when unfocused, via the SW
  registration), WebAudio sounds `playSound('message'|'sent'|'notification'|'end'|'error')`,
  `startLoop('ringtone'|'ringback')` → stop fn, `vibrate`.
- `lib/push.ts`: `enablePush()` (user gesture; asks permission, subscribes with
  `/api/config` `vapidPublicKey`, `POST /api/push/subscriptions`), `syncPushSubscription()`
  (silent, on login), `disablePush()` (on logout).
- Production builds add a CSP `<meta>` (vite.config.ts); inline scripts are allowed by hash.

## Testing

`src/**/*.test.ts(x)` with vitest + jsdom + Testing Library (`src/test/setup.ts`); build
fixtures with `src/test/factories.ts`. Existing suites cover the messages store (dedupe,
optimistic replacement, windows), chat sorting/filters/typing expiry, formatting, the API
client and core UI components.

Visual check: `scripts/screenshots.mjs` drives Playwright against a running dev server with
REST + Socket.IO mocked inside the script (no mock code in the app) and writes light/dark ×
phone/desktop screenshots to `docs/screenshots/`:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node apps/web/scripts/screenshots.mjs   # BASE, ONLY, OUT env
```

---

## Groups, communities, channels & invites (agent 3)

Routes: `/new/group` (two-step create), `/communities` (list) → `/communities/new`,
`/communities/:communityId`; `/updates/channels/discover`, `/updates/channels/new`,
`/updates/channels/:chatId` (follower feed, or a Follow preview for non-followers);
`/join/:code` (invite landing). Screenshots: `docs/screenshots/b3-*.png`.

- **Info panels**: `GroupInfoPanel` / `ChannelInfoPanel` keep the `{ chatId, onClose }`
  contract and drill into their own pages (members, add members, invite link, settings,
  media/links/docs, starred) inside the same `<Sheet>`.
- **Reusable pieces** (`features/groups/shared/`): `UserPicker` (contacts + recent chats +
  user search, chips), `EditableAvatar` + `AvatarCropModal` (crop → canvas JPEG ≤
  AVATAR_MAX_DIMENSION → upload), `InviteLinkView`, `AddResultModal` (needsInvite / failed),
  `MediaGalleryView`, `StarredView`, `UserProfileModal`, `InfoLayout` rows, mute /
  disappearing / edit dialogs, and `chatActions.ts` (REST calls that update the stores).
- **Communities store** (appended actions): `createCommunity`, `updateCommunity`,
  `deactivateCommunity`, `leaveCommunity`, `createCommunityGroup`, `linkGroups`, `unlinkGroup`,
  `joinGroup`, `fetchMembers`, `addMembers`, `removeMember`, `setRole`, `transferOwnership`,
  `getInvite`, `resetInvite`; hooks `useCommunity(id)`, `isCommunityAdmin(c)`.
- **Channel feed** (`ChannelPane`) is channel-specific rather than the chat
  `ConversationPane`: posts carry the channel identity, reactions follow
  `channelSettings.reactions` (quick / any emoji via the lazy picker / none), followers vote in
  polls, admins get a composer (text, photos/videos, documents, polls) and post edit/delete.

## Calls & status (agent 4)

### Calls — `features/calls/**`, `stores/calls.ts`, `realtime/calls.ts`

- **Engine** (`features/calls/engine/`, plain TS, unit-tested with a fake RTCPeerConnection):
  `CallEngine` (local mic/camera/screen tracks, one `PeerLink` per remote participant, remote
  audio sinks, `AudioLevelMonitor` for the speaking ring / active speaker) and `PeerLink`
  (audio + video `sendrecv` transceivers from the start, newcomer offers, perfect negotiation
  with the smaller userId polite, ordered signal chain, `restartIce()` on ICE failure or a
  stuck `disconnected`). Mute / camera / flip / screen share are `replaceTrack()` only.
  MediaStreams live in `engine/streams.ts` (`useCallStream(id)`), never in zustand. ICE
  servers come from `GET /api/calls/ice-servers`, cached until shortly before `ttlSec`.
- **Controller** (`features/calls/controller.ts`, lazy-loaded by the store actions) glues
  store ⇄ engine ⇄ socket: `call:start` (conflict → accept/join the chat's live call, or
  "already in another call"), accept/join/rejoin, `call:participant-joined/left`,
  `call:signal`, `call:media`, `call:updated/ended`; socket drop → `reconnecting` → on the
  next `ready` `GET /api/calls/active` → `call:rejoin`; a page reload rejoins the call this tab
  was in (sessionStorage); closing the tab leaves the call (`pagehide`).
- **Store** `useCalls`: `incoming`, `active` (`phase`: starting → calling/ringing →
  connecting → connected / reconnecting / ended, `connections`, `speaking`,
  `activeSpeakerId`, `connectedAt`, `endReason`, media flags…), `liveCalls` (live call per
  chatId), `log` (Calls tab), `picker`. Actions: `startCall(chatId, type, userIds?)` (groups
  with more than 8 members open the participant picker), `acceptIncoming`, `declineIncoming`,
  `joinCall(callId)`, `leaveCall`, `inviteToCall`, `toggleMute/Video/ScreenShare`,
  `flipCamera`, `setMinimized`, `setOutputDevice`, `loadLog/loadMoreLog/removeLogEntry/clearLog`.
- **UI**: `CallOverlay` (incoming full screen on phones / card on desktop, silenced and
  call-waiting variants, ringtone/ringback), `CallScreen` (1:1 video with draggable PiP, group
  grid ≤ 8, voice layout, controls, banners), `CallMiniWindow` (minimized, draggable),
  Calls tab `/calls` (ongoing calls to join + log with All/Missed, grouping, call back,
  remove/clear), `/calls/new` (contacts & groups), `/calls/:callId` (call info).
- **For other features** (`import … from '@/features/calls'`):
  - `useCalls.getState().startCall(chatId, 'audio' | 'video')` — conversation header, info panels.
  - `<OngoingCallBanner chatId={chat.id} />` — render under the group conversation header
    (live group call with Join, or "You're in this call · 1:23" with Return). Renders nothing
    otherwise. **Lead: wire it into `ConversationPane` (agent 2).**
  - `useActiveCallForChat(chatId)` → `{ call, inCallHere, inCallElsewhere, ringingMe, canJoin, joinedCount }`.
  - `useMissedCallsCount()` — missed incoming calls since the Calls tab was last opened
    (localStorage `enbox.calls.lastVisit`, cleared while the tab is open). **Lead: add
    `calls: missed ? { count: missed } : undefined` to `components/layout/useTabBadges.ts`.**

### Status — `features/status/**`, `stores/status.ts`, `realtime/status.ts`

- `StatusSection` (Updates tab): My status (add text / photo / video, posting progress, views),
  Recent updates / Viewed updates with segmented rings around the latest status preview,
  section menu → My status updates, Status privacy (`PATCH /api/me/settings` with a contacts
  picker for "except" / "only share with").
- Routes under `/updates`: `status/new` (composer: text with colors/fonts/emoji, or a photo /
  ≤ 60 s video with caption; `navigate('/updates/status/new', { state: { file } })` opens it
  with a picked file), `status/mine` (my updates with view counts, delete), `status/:userId`
  (full-screen viewer: progress bars, tap / hold / swipe / arrow keys, reply → direct message
  with `statusReplyToId`, quick reactions, own viewers list + delete).
- **Lead: wire the Updates header camera button** (`features/updates/UpdatesPane`, foundation)
  to `navigate('/updates/status/new')`.
- Store `useStatus`: `feed`, `posting`, `viewers`; `loadFeed`, `applyNew/Deleted/Viewed`
  (deduped view counts), `markViewed` (once per status), `postText`, `postMedia`,
  `deleteStatus`, `react`, `loadViewers`, `pruneExpired`; hooks `useHasUnseenStatus()`,
  `useStatusLists()`.
