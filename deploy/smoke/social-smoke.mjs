// Social wave smoke test, run ON the production host from /opt/enbox/current/apps/server:
// A on :4000, B on :4001. Reactions (deltas across processes), friend request + accept,
// Inbox mention, a thread with a message, Space search, a custom emoji. Everything made here
// (the Space and both test accounts) is deleted at the end.
import { io } from 'socket.io-client';

const A = 'http://127.0.0.1:4000';
const B = 'http://127.0.0.1:4001';
const tag = Math.random().toString(36).slice(2, 8);
const results = {};

async function api(base, method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function connect(base, token) {
  return new Promise((resolve, reject) => {
    const s = io(base, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('ready', () => resolve(s));
    s.once('connect_error', reject);
    setTimeout(() => reject(new Error('ready timeout')), 10000);
  });
}

function next(socket, event, filter = () => true, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, on);
      reject(new Error(`timeout ${event}`));
    }, ms);
    const on = (p) => {
      if (!filter(p)) return;
      clearTimeout(t);
      socket.off(event, on);
      resolve(p);
    };
    socket.on(event, on);
  });
}

// A 2x2 PNG (pink).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwHwyBGMQGMgAAYZYL9ZK/7G0AAAAASUVORK5CYII=',
  'base64',
);

let seq = 0;
const send = (base, token, chatId, text) =>
  api(base, 'POST', `/api/chats/${chatId}/messages`, token, { clientId: `ssmoke-${tag}-${++seq}`, type: 'text', text });

const password = 'social-check-' + tag;
const a = await api(A, 'POST', '/api/auth/register', null, { username: `scheck${tag}a`, displayName: 'Social check A', password });
const b = await api(B, 'POST', '/api/auth/register', null, { username: `scheck${tag}b`, displayName: 'Social check B', password });
if (a.status >= 300 || b.status >= 300) throw new Error(`register ${a.status} ${b.status}`);
const ta = a.body.token;
const tb = b.body.token;
const ida = a.body.user.id;
let sa;
let sb;
let spaceId;
try {
  sa = await connect(A, ta);
  sb = await connect(B, tb);

  // Friend request A → B, accepted by B; A hears friends:changed across processes.
  const req = next(sb, 'friends:request');
  results.friendSend = (await api(A, 'POST', '/api/friends/requests', ta, { username: `scheck${tag}b` })).body?.status;
  results.friendRequestAcross = (await req).request?.user?.id === ida;
  const changed = next(sa, 'friends:changed');
  results.friendAccept = (await api(B, 'POST', `/api/friends/requests/${ida}/accept`, tb)).status;
  results.friendChangedAcross = !!(await changed);

  // Space with both; B mentions A; reactions as deltas.
  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Social smoke ${tag}` });
  spaceId = created.body.space.id;
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);
  const m = (await send(B, tb, general, `hello @{${ida}} smoke-${tag}`)).body;
  const delta = next(sb, 'message:reaction-add', (p) => p.messageId === m.id);
  results.react = (await api(A, 'PUT', `/api/messages/${m.id}/reactions/${encodeURIComponent('🔥')}/@me`, ta)).status;
  await api(A, 'PUT', `/api/messages/${m.id}/reactions/${encodeURIComponent('🎉')}/@me`, ta);
  results.reactionDeltaAcross = (await delta).emoji === '🔥';
  const page = await api(B, 'GET', `/api/chats/${general}/messages?limit=10`, tb);
  const msg = page.body?.messages?.find((x) => x.id === m.id);
  results.twoReactions = msg?.reactions?.length === 2;

  // Inbox.
  const inbox = await api(A, 'GET', '/api/me/mentions', ta);
  results.inbox = inbox.body?.items?.some((i) => i.message.id === m.id);

  // Thread from the message, a message in it, starter ref.
  const thread = await api(A, 'POST', `/api/chats/${general}/threads`, ta, { name: 'smoke thread', messageId: m.id });
  results.threadCreate = thread.status;
  results.threadMessage = (await send(B, tb, thread.body.id, 'in the thread')).status;
  const threads = await api(B, 'GET', `/api/chats/${general}/threads`, tb);
  results.threadListed = threads.body?.threads?.some((t) => t.id === thread.body.id);

  // Search the Space.
  const found = await api(A, 'GET', `/api/spaces/${spaceId}/messages/search?q=smoke-${tag}`, ta);
  results.search = found.body?.total === 1;

  // Custom emoji: upload, create, image redirect.
  const form = new FormData();
  form.append('kind', 'image');
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'dot.png');
  const up = await fetch(`${A}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${ta}` }, body: form });
  const media = await up.json();
  const emoji = await api(A, 'POST', `/api/spaces/${spaceId}/emojis`, ta, { name: 'smoke_dot', mediaId: media.id });
  results.emojiCreate = emoji.status;
  const img = await fetch(`${B}/api/emojis/${emoji.body?.id}`, { redirect: 'manual' });
  results.emojiRedirect = img.status === 302;
} finally {
  sa?.disconnect();
  sb?.disconnect();
  if (spaceId) results.deleteSpace = (await api(A, 'DELETE', `/api/spaces/${spaceId}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
