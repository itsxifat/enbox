// Community wave smoke test, run ON the production host from /opt/enbox/current/apps/server:
// A on :4000, B on :4001. Events (create, interested, event across processes), a forum post,
// an AutoMod block, discovery join, mark unread, pins. The Spaces and test accounts made here
// are deleted at the end.
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

let seq = 0;
const send = (base, token, chatId, text) =>
  api(base, 'POST', `/api/chats/${chatId}/messages`, token, { clientId: `csmoke-${tag}-${++seq}`, type: 'text', text });

const password = 'community-check-' + tag;
const a = await api(A, 'POST', '/api/auth/register', null, { username: `ccheck${tag}a`, displayName: 'Community check A', password });
const b = await api(B, 'POST', '/api/auth/register', null, { username: `ccheck${tag}b`, displayName: 'Community check B', password });
if (a.status >= 300 || b.status >= 300) throw new Error(`register ${a.status} ${b.status}`);
const ta = a.body.token;
const tb = b.body.token;
let sb;
const spaces = [];
try {
  sb = await connect(B, tb);
  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Community smoke ${tag}` });
  const spaceId = created.body.space.id;
  spaces.push(spaceId);
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);

  // Events.
  const seen = next(sb, 'space:event', (p) => p.spaceId === spaceId);
  const startAt = new Date(Date.now() + 3600_000).toISOString();
  const endAt = new Date(Date.now() + 7200_000).toISOString();
  const ev = await api(A, 'POST', `/api/spaces/${spaceId}/events`, ta, { name: 'Smoke party', entityType: 'external', location: 'Here', startAt, endAt });
  results.eventCreate = ev.status;
  results.eventAcross = (await seen).event.name === 'Smoke party';
  results.interested = (await api(B, 'PUT', `/api/spaces/${spaceId}/events/${ev.body.id}/interested`, tb)).body?.interestedCount === 2;

  // Forum post.
  const forum = await api(A, 'POST', `/api/spaces/${spaceId}/channels`, ta, { type: 'space_forum', name: 'ideas' });
  results.forumCreate = forum.status;
  const post = await api(B, 'POST', `/api/chats/${forum.body.id}/posts`, tb, { name: 'Idea', text: 'first post', clientId: `p-${tag}` });
  results.forumPost = post.status;
  results.forumList = (await api(A, 'GET', `/api/chats/${forum.body.id}/posts`, ta)).body?.posts?.length === 1;

  // AutoMod.
  results.automodRule = (
    await api(A, 'POST', `/api/spaces/${spaceId}/automod/rules`, ta, {
      name: 'Words',
      triggerType: 'keyword',
      triggerMetadata: { keywords: [`badword${tag}`] },
      actions: [{ type: 'block' }],
    })
  ).status;
  const blocked = await send(B, tb, general, `this has badword${tag} in it`);
  results.automodBlocked = blocked.status === 403 && blocked.body?.error?.code === 'automod_blocked';
  results.automodClean = (await send(B, tb, general, 'clean message')).status === 201;

  // Pins + mark unread.
  const m = (await send(B, tb, general, 'pin this')).body;
  results.pin = (await api(A, 'POST', `/api/chats/${general}/pins`, ta, { messageId: m.id })).status;
  results.unread = (await api(A, 'POST', `/api/chats/${general}/unread`, ta, { messageId: m.id })).status;

  // Discovery.
  await api(A, 'PATCH', `/api/spaces/${spaceId}`, ta, { description: 'A smoke test Space.' });
  await api(A, 'PATCH', `/api/spaces/${spaceId}/community`, ta, { discoveryCategory: 'other' });
  results.discoverable = (await api(A, 'PATCH', `/api/spaces/${spaceId}/community`, ta, { isDiscoverable: true })).status;
  const found = await api(B, 'GET', `/api/discover/spaces?q=${encodeURIComponent(`Community smoke ${tag}`)}`, tb);
  results.discoverFound = found.body?.spaces?.some((s) => s.id === spaceId && s.joined === true);
  await api(A, 'PATCH', `/api/spaces/${spaceId}/community`, ta, { isDiscoverable: false });
} finally {
  sb?.disconnect();
  for (const id of spaces) results.deleteSpace = (await api(A, 'DELETE', `/api/spaces/${id}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
