// Everyday wave smoke test, run ON the production host from /opt/enbox/current/apps/server
// (or locally with SMOKE_A / SMOKE_B): A on :4000, B on :4001. @silent and the Space message
// limit, channel mentions, synced preferences across processes, bookmarks with a reminder,
// friend invite links and the reaction notification setting. Everything made here is deleted.
import { io } from 'socket.io-client';

const A = process.env.SMOKE_A ?? 'http://127.0.0.1:4000';
const B = process.env.SMOKE_B ?? 'http://127.0.0.1:4001';
const tag = Math.random().toString(36).slice(2, 8);
const results = {};

async function api(base, method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function connect(base, token) {
  return new Promise((resolve, reject) => {
    const s = io(base, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('ready', () => resolve(s));
    s.once('connect_error', reject);
    setTimeout(() => reject(new Error('ready timeout')), 10000);
  });
}

const waitFor = (socket, event, pred = () => true, ms = 5000) =>
  new Promise((resolve) => {
    const on = (p) => {
      if (!pred(p)) return;
      socket.off(event, on);
      resolve(p);
    };
    socket.on(event, on);
    setTimeout(() => {
      socket.off(event, on);
      resolve(null);
    }, ms);
  });

let seq = 0;
const clientId = () => `evsmoke-${tag}-${++seq}`;
const send = (base, token, chatId, body) =>
  api(base, 'POST', `/api/chats/${chatId}/messages`, token, { clientId: clientId(), type: 'text', ...body });

const password = 'everyday-check-' + tag;
const reg = (base, s) =>
  api(base, 'POST', '/api/auth/register', null, { username: `evcheck${tag}${s}`, displayName: `Ev ${s.toUpperCase()}`, password });
const ra = await reg(A, 'a');
const rb = await reg(B, 'b');
if (ra.status >= 300 || rb.status >= 300) throw new Error(`register ${ra.status} ${rb.status}`);
const ta = ra.body.token;
const tb = rb.body.token;
const [ida, idb] = [ra.body.user.id, rb.body.user.id];
let sa2;
const spaces = [];
try {
  // A second session of A, on the other process, sees A's preference changes.
  const login2 = await api(B, 'POST', '/api/auth/login', null, { identifier: `evcheck${tag}a`, password });
  sa2 = await connect(B, login2.body.token);
  const prefEvent = waitFor(sa2, 'me:preferences', (p) => p?.prefs?.messageDisplay === 'compact');
  const patched = await api(A, 'PATCH', '/api/me/preferences', ta, { messageDisplay: 'compact', zoom: 1.1 });
  results.prefsPatch = patched.status === 200 && patched.body?.prefs?.messageDisplay === 'compact';
  results.prefsAcross = !!(await prefEvent);
  const read = await api(B, 'GET', '/api/me/preferences', login2.body.token);
  results.prefsRead = read.body?.prefs?.zoom === 1.1;
  results.prefsDelete = (await api(A, 'PATCH', '/api/me/preferences', ta, { zoom: null })).body?.prefs?.zoom === undefined;

  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Everyday smoke ${tag}` });
  const spaceId = created.body.space.id;
  spaces.push(spaceId);
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);

  // @silent and the Space message limit; a channel mention is stored as its token.
  const silent = await send(A, ta, general, { text: 'quiet please', silent: true });
  results.silentFlag = silent.status === 201 && (silent.body.flags & 16) === 16;
  results.limitOk = (await send(A, ta, general, { text: 'x'.repeat(4000) })).status;
  results.limitOver = (await send(A, ta, general, { text: 'x'.repeat(4001) })).status;
  const mention = await send(B, tb, general, { text: `see #{${general}} for details` });
  results.channelMention = mention.body?.text === `see #{${general}} for details`;

  // Bookmarks with a reminder a second away: the leader's job fires it within ~30 s.
  const remindAt = new Date(Date.now() + 1000).toISOString();
  const bm = await api(B, 'PUT', `/api/messages/${silent.body.id}/bookmark`, tb, { remindAt });
  results.bookmark = bm.status === 200 && bm.body?.messageId === silent.body.id;
  const list = await api(B, 'GET', '/api/me/bookmarks', tb);
  results.bookmarkListed = list.body?.bookmarks?.some((x) => x.messageId === silent.body.id && x.message?.text === 'quiet please');
  let fired = false;
  for (let i = 0; i < 25 && !fired; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const rem = await api(B, 'GET', '/api/me/bookmarks?filter=reminders', tb);
    fired = rem.body?.bookmarks?.some((x) => x.messageId === silent.body.id && x.remindedAt);
  }
  results.reminderFired = fired;
  results.bookmarkDelete = (await api(B, 'DELETE', `/api/messages/${silent.body.id}/bookmark`, tb)).status;

  // Friend invite links.
  const fi = await api(A, 'POST', '/api/me/friend-invites', ta);
  results.friendInvite = fi.status === 200 || fi.status === 201;
  results.friendPreview = (await api(B, 'GET', `/api/friend-invites/${fi.body.code}`, tb)).body?.inviter?.id === ida;
  results.friendOwn = (await api(A, 'POST', `/api/friend-invites/${fi.body.code}/accept`, ta)).status;
  const accepted = await api(B, 'POST', `/api/friend-invites/${fi.body.code}/accept`, tb);
  results.friendAccept = accepted.body?.status === 'friends' && accepted.body?.userId === ida;
  results.friendRevoke = (await api(A, 'DELETE', '/api/me/friend-invites', ta)).status;
  results.friendGone = (await api(B, 'GET', `/api/friend-invites/${fi.body.code}`, tb)).status;

  // The reaction notification setting.
  const settings = await api(A, 'PATCH', '/api/me/settings', ta, { reactionNotifications: 'off' });
  results.reactionSetting = settings.status === 200 && settings.body?.reactionNotifications === 'off';
  void idb;
} finally {
  sa2?.disconnect();
  for (const id of spaces) results.deleteSpace = (await api(A, 'DELETE', `/api/spaces/${id}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
