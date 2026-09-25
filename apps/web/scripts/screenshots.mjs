/* global process, console, URL, setTimeout, localStorage */
/**
 * Visual check of the web shell (dev tool, not shipped): screenshots at phone (390x844) and
 * desktop (1440x900) sizes in light/dark, with REST and Socket.IO mocked *in this script only*
 * (page.route + page.routeWebSocket), so it works before the server implements auth.
 *
 *   npm run dev -w @enbox/web                     # or any running dev/preview server
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node apps/web/scripts/screenshots.mjs
 *   BASE=http://localhost:5190 ONLY=chats,login OUT=/tmp/shots node apps/web/scripts/screenshots.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? new URL('../docs/screenshots', import.meta.url).pathname;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Mock data (screenshot script only)
// ---------------------------------------------------------------------------
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = id(1);
const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();
const todayAt = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const settings = {
  lastSeenVisibility: 'everyone',
  onlineVisibility: 'everyone',
  profilePhotoVisibility: 'everyone',
  aboutVisibility: 'everyone',
  groupsAddPermission: 'everyone',
  readReceipts: true,
  silenceUnknownCallers: false,
  statusPrivacy: 'contacts',
  statusExcludeUserIds: [],
  statusOnlyShareWithUserIds: [],
  defaultDisappearingSeconds: null,
  messageNotifications: true,
  groupNotifications: true,
  callNotifications: true,
  notificationPreviews: true,
};
const me = {
  id: ME,
  username: 'alex',
  displayName: 'Alex Morgan',
  avatarUrl: null,
  about: 'Building things ✨',
  phone: null,
  createdAt: ago(99999),
  settings,
};

const user = (n, displayName, extra = {}) => ({
  id: id(n),
  username: displayName.split(' ')[0].toLowerCase(),
  displayName,
  avatarUrl: null,
  about: 'Hey there! I am using Enbox.',
  phone: null,
  isContact: true,
  contactName: null,
  isBlocked: false,
  isDeleted: false,
  online: false,
  lastSeenAt: ago(42),
  ...extra,
});
const maya = user(10, 'Maya Patel', { online: true });
const leo = user(11, 'Leo Martins', { lastSeenAt: ago(180) });
const sofia = user(12, 'Sofia Rossi');
const ethan = user(13, 'Ethan Brooks');
const priya = user(14, 'Priya Shah');
const users = [maya, leo, sofia, ethan, priya];

const mountain =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs><rect width="100" height="100" fill="url(#s)"/><circle cx="70" cy="34" r="12" fill="#fff7ed"/><path d="M0 100 L30 52 L48 74 L64 50 L100 100Z" fill="#7c2d12"/><path d="M30 52 L38 64 L24 64Z" fill="#fff"/></svg>`,
  );
const teamAvatar =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0ea5e9"/><circle cx="35" cy="42" r="14" fill="#e0f2fe"/><circle cx="65" cy="42" r="14" fill="#bae6fd"/><rect x="18" y="62" width="34" height="30" rx="14" fill="#e0f2fe"/><rect x="48" y="62" width="34" height="30" rx="14" fill="#bae6fd"/></svg>`,
  );

let msgN = 1000;
const msg = (chatId, seq, senderId, text, createdAt, extra = {}) => ({
  id: id(++msgN),
  chatId,
  seq,
  clientId: null,
  senderId,
  type: 'text',
  text,
  media: null,
  location: null,
  contact: null,
  poll: null,
  system: null,
  call: null,
  statusReply: null,
  replyTo: null,
  forwardCount: 0,
  mentions: [],
  reactions: [],
  editedAt: null,
  deletedAt: null,
  expiresAt: null,
  createdAt,
  ...extra,
});

// Simplified mirror of `computeChatPermissions` (@enbox/shared) for the mocks.
const perms = (c) => {
  const active = c.membership === 'active';
  const admin = c.myRole !== 'member';
  const g = c.groupSettings ?? {};
  const group = c.type === 'group' && !c.isAnnouncement;
  const send =
    c.type === 'direct'
      ? true
      : c.type === 'channel' || c.isAnnouncement
        ? admin
        : !g.onlyAdminsCanSend || admin;
  const edit =
    c.type === 'direct'
      ? send
      : c.type === 'channel'
        ? admin
        : group && (!g.onlyAdminsCanEditInfo || admin);
  const add = group && (!g.onlyAdminsCanAddMembers || admin);
  return {
    canSend: active && send,
    canEditInfo: active && edit,
    canAddMembers: active && add,
    canRemoveMembers: active && group && admin,
    canManageAdmins: active && (c.type === 'channel' ? c.myRole === 'owner' : group && admin),
    canPin:
      active && (c.type === 'direct' || (c.type === 'group' && c.isAnnouncement) ? true : edit),
    canCall: active && send && c.type !== 'channel',
    canInvite: active && (c.type === 'channel' ? admin : add),
    canDeleteForEveryoneAsAdmin: active && admin && c.type !== 'direct',
    canLeave: active && (group || (c.type === 'channel' && c.myRole !== 'owner')),
    canViewMembers: active && (c.type === 'channel' || c.isAnnouncement ? admin : true),
  };
};

const chat = (n, p) =>
  withPerms({
    id: id(n),
    type: 'direct',
    name: null,
    description: null,
    avatarUrl: null,
    peer: null,
    communityId: null,
    isAnnouncement: false,
    memberCount: 2,
    groupSettings: null,
    channelSettings: null,
    myRole: 'member',
    membership: 'active',
    disappearingSeconds: null,
    lastMessage: null,
    lastSeq: 0,
    lastReadSeq: 0,
    unreadCount: 0,
    unreadMentionCount: 0,
    readWatermark: 0,
    deliveredWatermark: 0,
    isPinned: false,
    isArchived: false,
    mutedUntil: null,
    markedUnread: false,
    createdAt: ago(99999),
    lastActivityAt: ago(5),
    inviteCode: null,
    ...p,
  });
function withPerms(c) {
  return { ...c, permissions: perms(c) };
}
const gs = {
  onlyAdminsCanSend: false,
  onlyAdminsCanEditInfo: true,
  onlyAdminsCanAddMembers: false,
};

const C = {
  maya: id(100),
  design: id(101),
  hiking: id(102),
  leo: id(103),
  family: id(104),
  sofia: id(105),
  ethan: id(106),
  priya: id(107),
  channel: id(108),
  archived: id(109),
};
const last = (chatId, seq, sender, text, t, extra) => msg(chatId, seq, sender, text, t, extra);
const chats = [
  chat(100, {
    peer: maya,
    lastSeq: 41,
    lastReadSeq: 41,
    readWatermark: 41,
    deliveredWatermark: 41,
    lastActivityAt: ago(2),
    lastMessage: last(C.maya, 41, ME, 'Perfect, see you at 8! 🍜', ago(2)),
  }),
  chat(101, {
    type: 'group',
    name: 'Design Team',
    avatarUrl: teamAvatar,
    memberCount: 8,
    groupSettings: gs,
    isPinned: true,
    lastSeq: 230,
    lastReadSeq: 230,
    lastActivityAt: ago(95),
    lastMessage: last(C.design, 230, sofia.id, 'Pushed the new icon set to Figma', ago(95)),
  }),
  chat(102, {
    type: 'group',
    name: 'Weekend Hiking 🏔️',
    avatarUrl: mountain,
    memberCount: 12,
    groupSettings: gs,
    lastSeq: 88,
    lastReadSeq: 85,
    unreadCount: 3,
    unreadMentionCount: 1,
    lastActivityAt: ago(7),
    lastMessage: last(C.hiking, 88, leo.id, '', ago(7), {
      type: 'image',
      text: 'Trail map for Saturday',
      media: null,
    }),
  }),
  chat(103, {
    peer: leo,
    lastSeq: 12,
    lastReadSeq: 10,
    unreadCount: 2,
    lastActivityAt: ago(24),
    lastMessage: last(C.leo, 12, leo.id, '', ago(24), {
      type: 'voice',
      text: null,
      media: {
        id: id(5000),
        kind: 'voice',
        url: '/uploads/x.ogg',
        mimeType: 'audio/ogg',
        fileName: null,
        size: 1,
        width: null,
        height: null,
        durationMs: 14000,
        waveform: null,
      },
    }),
  }),
  chat(104, {
    type: 'group',
    name: 'Family ❤️',
    memberCount: 6,
    groupSettings: gs,
    lastSeq: 540,
    lastReadSeq: 528,
    unreadCount: 12,
    mutedUntil: '9999-12-31T23:59:59.000Z',
    lastActivityAt: ago(60 * 20),
    lastMessage: last(C.family, 540, priya.id, 'Who is bringing dessert on Sunday?', ago(60 * 20)),
  }),
  chat(105, {
    peer: sofia,
    lastSeq: 77,
    lastReadSeq: 77,
    readWatermark: 76,
    deliveredWatermark: 77,
    lastActivityAt: ago(60 * 26),
    lastMessage: last(C.sofia, 77, ME, 'Sent you the contract draft', ago(60 * 26)),
  }),
  chat(106, {
    peer: ethan,
    lastSeq: 5,
    lastReadSeq: 5,
    lastActivityAt: ago(60 * 24 * 3),
    lastMessage: last(C.ethan, 5, ethan.id, 'Thanks for the intro 🙌', ago(60 * 24 * 3)),
  }),
  chat(107, {
    peer: priya,
    lastSeq: 30,
    lastReadSeq: 30,
    markedUnread: true,
    lastActivityAt: ago(60 * 24 * 9),
    lastMessage: last(C.priya, 30, priya.id, 'Call me when you land', ago(60 * 24 * 9)),
  }),
  chat(108, {
    type: 'channel',
    name: 'Enbox News',
    memberCount: 18400,
    myRole: 'member',
    lastSeq: 9,
    lastReadSeq: 8,
    unreadCount: 1,
    channelSettings: { isPublic: true, reactions: 'all' },
    lastActivityAt: ago(300),
    lastMessage: last(C.channel, 9, null, 'Status updates now support video! 🎬', ago(300)),
  }),
  chat(109, {
    type: 'group',
    name: 'Old Project',
    memberCount: 4,
    groupSettings: gs,
    isArchived: true,
    lastSeq: 3,
    lastReadSeq: 3,
    lastActivityAt: ago(60 * 24 * 40),
    lastMessage: last(C.archived, 3, ethan.id, 'Archiving this for now', ago(60 * 24 * 40)),
  }),
];

const y = (h, m) => new Date(new Date(todayAt(h, m)).getTime() - 86400000).toISOString();
const mayaMessages = [
  msg(C.maya, 30, maya.id, 'Did you see the new place that opened near the station?', y(18, 2)),
  msg(C.maya, 31, ME, 'The ramen spot? Yes! Heard great things', y(18, 5)),
  msg(C.maya, 32, maya.id, 'We should try it this week 😋', y(18, 6)),
  msg(C.maya, 33, ME, 'Absolutely. Thursday or Friday?', y(18, 9)),
  msg(C.maya, 34, maya.id, 'Friday works better for me', y(21, 40)),
  msg(C.maya, 35, maya.id, 'Morning! Still on for tonight?', todayAt(9, 12)),
  msg(
    C.maya,
    36,
    ME,
    'Yes! I booked a table for two at 8pm. They only had the counter seats left but honestly those are the best ones — you get to watch them make everything.',
    todayAt(9, 30),
  ),
  msg(C.maya, 37, maya.id, 'Oh nice, even better', todayAt(9, 31)),
  msg(C.maya, 38, maya.id, 'Should I invite Leo too?', todayAt(9, 31)),
  msg(C.maya, 39, ME, 'Sure, if they can add a seat — I will ask them', todayAt(9, 40)),
  msg(C.maya, 40, maya.id, 'Dinner tonight then 🍜', ago(3)),
  msg(C.maya, 41, ME, 'Perfect, see you at 8! 🍜', ago(2)),
];

const statusFeed = {
  mine: [],
  updates: [
    {
      user: maya,
      statuses: [
        {
          id: id(700),
          userId: maya.id,
          type: 'text',
          text: 'Ramen night',
          backgroundColor: '#6D5DFC',
          font: 0,
          media: null,
          createdAt: ago(30),
          expiresAt: ago(-600),
          viewed: false,
        },
      ],
      allViewed: false,
      lastUpdatedAt: ago(30),
    },
    {
      user: leo,
      statuses: [
        {
          id: id(701),
          userId: leo.id,
          type: 'text',
          text: 'Trail day',
          backgroundColor: '#10B981',
          font: 1,
          media: null,
          createdAt: ago(140),
          expiresAt: ago(-600),
          viewed: false,
        },
      ],
      allViewed: false,
      lastUpdatedAt: ago(140),
    },
    {
      user: sofia,
      statuses: [
        {
          id: id(702),
          userId: sofia.id,
          type: 'text',
          text: 'Launch!',
          backgroundColor: '#EC4899',
          font: 2,
          media: null,
          createdAt: ago(400),
          expiresAt: ago(-600),
          viewed: true,
        },
      ],
      allViewed: true,
      lastUpdatedAt: ago(400),
    },
  ],
};

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: body === undefined ? '' : JSON.stringify(body),
  });
}

async function mockApi(page, socket = 'ok') {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    if (p === '/api/me' && m === 'GET') return json(route, 200, me);
    if (p === '/api/config')
      return json(route, 200, { vapidPublicKey: null, maxUploadBytes: 1e8, version: '0.1.0' });
    if (p === '/api/chats' && m === 'GET') return json(route, 200, chats);
    let mm = p.match(/^\/api\/chats\/([^/]+)\/messages$/);
    if (mm && m === 'GET')
      return json(route, 200, {
        messages: mm[1] === C.maya ? mayaMessages : [],
        hasMoreBefore: false,
        hasMoreAfter: false,
        users,
      });
    mm = p.match(/^\/api\/chats\/([^/]+)$/);
    if (mm && m === 'GET') {
      const c = chats.find((x) => x.id === mm[1]);
      return c
        ? json(route, 200, c)
        : json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
    }
    if (p === '/api/status/feed') return json(route, 200, statusFeed);
    if (p === '/api/communities') return json(route, 200, []);
    if (p === '/api/users/batch' && m === 'POST') {
      const ids = new Set(req.postDataJSON()?.userIds ?? []);
      return json(
        route,
        200,
        users.filter((x) => ids.has(x.id)),
      );
    }
    mm = p.match(/^\/api\/users\/([^/]+)$/);
    if (mm) {
      const u = users.find((x) => x.id === mm[1]);
      return u
        ? json(route, 200, u)
        : json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
    }
    if (m !== 'GET') return route.fulfill({ status: 204 });
    return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
  });

  // Minimal Socket.IO (Engine.IO v4) server over the mocked WebSocket.
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (socket === 'down') return; // never answers: client stays "connecting"
    ws.send(
      JSON.stringify({
        sid: 'e1',
        upgrades: [],
        pingInterval: 600000,
        pingTimeout: 600000,
        maxPayload: 1e6,
      }).replace(/^/, '0'),
    );
    ws.onMessage((raw) => {
      const data = String(raw);
      if (data.startsWith('40')) {
        ws.send('40{"sid":"s1"}');
        ws.send(
          `42${JSON.stringify(['ready', { userId: ME, sessionId: 'sess-1', serverTime: new Date().toISOString() }])}`,
        );
        setTimeout(
          () =>
            ws.send(
              `42${JSON.stringify(['chat:typing', { chatId: C.hiking, userId: sofia.id, state: 'typing' }])}`,
            ),
          300,
        );
        return;
      }
      const ack = data.match(/^42(\d+)(\[.*)$/s);
      if (ack) {
        const [event, payload] = JSON.parse(ack[2]);
        let result = { ok: true, data: null };
        if (event === 'presence:subscribe') {
          result = {
            ok: true,
            data: payload.userIds.map((u) => ({
              userId: u,
              online: u === maya.id,
              lastSeenAt: ago(42),
            })),
          };
        }
        ws.send(`43${ack[1]}${JSON.stringify([result])}`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

const browser = await chromium.launch();

async function shot(
  name,
  { theme, size, path, auth, waitFor, after, socket = 'ok', settle = 700 },
) {
  if (ONLY && !ONLY.some((o) => name.includes(o))) return;
  const context = await browser.newContext({
    viewport: VIEWPORTS[size],
    deviceScaleFactor: 1,
    colorScheme: theme,
    isMobile: size === 'phone',
    hasTouch: size === 'phone',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(
    ({ auth, theme }) => {
      localStorage.setItem('enbox.ui', JSON.stringify({ state: { theme, prefs: {} }, version: 1 }));
      if (auth) localStorage.setItem('enbox.token', 'screenshot-token');
    },
    { auth, theme },
  );
  if (auth) await mockApi(page, socket);
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 });
  if (after) await after(page);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (errors.length) console.log(`[${name}]`, errors.join('\n  '));
  console.log('saved', name);
  await context.close();
}

for (const theme of ['light', 'dark']) {
  for (const size of ['phone', 'desktop']) {
    await shot(`login-${theme}-${size}`, {
      theme,
      size,
      path: '/login',
      auth: false,
      waitFor: 'text=Welcome back',
    });
    await shot(`chats-${theme}-${size}`, {
      theme,
      size,
      path: size === 'desktop' ? `/chats/${C.maya}` : '/chats',
      auth: true,
      waitFor: 'text=Maya Patel',
    });
  }
}
await shot('register-light-phone', {
  theme: 'light',
  size: 'phone',
  path: '/register',
  auth: false,
  waitFor: 'text=Create your account',
});
await shot('conversation-light-phone', {
  theme: 'light',
  size: 'phone',
  path: `/chats/${C.maya}`,
  auth: true,
  waitFor: 'text=Dinner tonight',
});
await shot('conversation-dark-phone', {
  theme: 'dark',
  size: 'phone',
  path: `/chats/${C.maya}`,
  auth: true,
  waitFor: 'text=Dinner tonight',
});
await shot('updates-light-desktop', {
  theme: 'light',
  size: 'desktop',
  path: '/updates',
  auth: true,
  waitFor: 'text=Enbox News',
});
await shot('settings-dark-desktop', {
  theme: 'dark',
  size: 'desktop',
  path: '/settings/chats',
  auth: true,
  waitFor: 'text=Enter is send',
});
await shot('menu-light-desktop', {
  theme: 'light',
  size: 'desktop',
  path: '/chats',
  auth: true,
  waitFor: 'text=Maya Patel',
  after: async (page) => {
    await page.getByRole('button', { name: 'Menu' }).first().click();
  },
});
await shot('confirm-dark-phone', {
  theme: 'dark',
  size: 'phone',
  path: '/settings',
  auth: true,
  waitFor: 'text=Log out',
  after: async (page) => {
    await page.getByText('Log out').click();
  },
});

await shot('info-light-desktop', {
  theme: 'light',
  size: 'desktop',
  path: `/chats/${C.hiking}`,
  auth: true,
  waitFor: 'text=Weekend Hiking',
  after: async (page) => {
    await page.locator('main header button').first().click();
  },
});
await shot('info-dark-phone', {
  theme: 'dark',
  size: 'phone',
  path: `/chats/${C.maya}`,
  auth: true,
  waitFor: 'text=Dinner tonight',
  after: async (page) => {
    await page.locator('main header button').nth(1).click();
  },
});
await shot('connecting-light-phone', {
  theme: 'light',
  size: 'phone',
  path: '/chats',
  auth: true,
  waitFor: 'text=Maya Patel',
  socket: 'down',
  settle: 2600,
});
await browser.close();
