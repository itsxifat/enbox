// Community-2 wave smoke test, run ON the production host from /opt/enbox/current/apps/server
// (or locally with SMOKE_A / SMOKE_B): A on :4000, B on :4001, C (a stranger) on :4000. Text
// chat in a voice channel, moderation (member search, Mod View, pausing invites), insights,
// the Server Guide and Browse Channels, Active Now, the Space preview and an invite unfurl.
// Everything made here is deleted at the end.
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

const ack = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, (r) => resolve(r)));
let seq = 0;
const send = (base, token, chatId, text) =>
  api(base, 'POST', `/api/chats/${chatId}/messages`, token, { clientId: `c2smoke-${tag}-${++seq}`, type: 'text', text });

const password = 'community2-check-' + tag;
const reg = (base, s) =>
  api(base, 'POST', '/api/auth/register', null, { username: `c2check${tag}${s}`, displayName: `C2 ${s.toUpperCase()}`, password });
const ra = await reg(A, 'a');
const rb = await reg(B, 'b');
const rc = await reg(A, 'c');
if (ra.status >= 300 || rb.status >= 300 || rc.status >= 300) throw new Error(`register ${ra.status} ${rb.status} ${rc.status}`);
const ta = ra.body.token;
const tb = rb.body.token;
const tc = rc.body.token;
const [ida, idb] = [ra.body.user.id, rb.body.user.id];
let sb;
const spaces = [];
try {
  sb = await connect(B, tb);
  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Community2 smoke ${tag}` });
  const spaceId = created.body.space.id;
  spaces.push(spaceId);
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const voice = created.body.channels.find((c) => c.type === 'space_voice').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);

  // Text chat in a voice channel.
  results.voiceChatSend = (await send(B, tb, voice, 'hello from voice chat')).status;
  results.voiceChatRead = (await api(A, 'GET', `/api/chats/${voice}/messages`, ta)).body?.messages?.some((m) => m.text === 'hello from voice chat');

  // Moderation: member search, Mod View, invite pause.
  const posted = (await send(B, tb, general, 'a message for mod view')).body;
  const search = await api(A, 'GET', `/api/spaces/${spaceId}/members/search?sort=joined_desc`, ta);
  results.memberSearch = search.status === 200 && search.body.members?.some((m) => m.userId === idb);
  const modView = await api(A, 'GET', `/api/spaces/${spaceId}/members/${idb}/mod-view`, ta);
  results.modView = modView.status === 200 && modView.body.recentMessages?.some((m) => m.id === posted.id);
  results.modViewForbidden = (await api(B, 'GET', `/api/spaces/${spaceId}/members/${ida}/mod-view`, tb)).status;
  results.pauseInvites = (await api(A, 'PATCH', `/api/spaces/${spaceId}/security`, ta, { pauseInvitesSec: 3600 })).body?.invitesPausedUntil != null;
  const refused = await api(A, 'POST', `/api/invites/${invite.body.code}/join`, tc);
  results.joinWhilePaused = refused.status === 403 && refused.body?.error?.code === 'invites_paused';
  results.resumeInvites = (await api(A, 'PATCH', `/api/spaces/${spaceId}/security`, ta, { pauseInvitesSec: null })).body?.invitesPausedUntil === null;

  // Insights (counts flush every 15 s; the shape is what matters here).
  const insights = await api(A, 'GET', `/api/spaces/${spaceId}/insights?days=7`, ta);
  results.insights = insights.status === 200 && insights.body.days?.length === 7;
  results.insightsForbidden = (await api(B, 'GET', `/api/spaces/${spaceId}/insights?days=7`, tb)).status;

  // Server Guide and Browse Channels.
  const guide = await api(A, 'PUT', `/api/spaces/${spaceId}/guide`, ta, {
    enabled: true,
    welcome: { title: 'Welcome!', subtitle: null },
    todos: [{ channelId: general, emoji: null, description: 'Say hi' }],
    resources: [],
  });
  results.guideSave = guide.status;
  results.guideDone = (await api(B, 'POST', `/api/spaces/${spaceId}/guide/todos/${general}/done`, tb)).body?.doneChannelIds?.includes(general);
  results.channelPrefs = (await api(B, 'PUT', `/api/spaces/${spaceId}/channel-prefs`, tb, { prefs: [{ channelId: voice, shown: false }] })).status;
  const meSpace = await api(B, 'GET', `/api/spaces/${spaceId}`, tb);
  results.prefsSerialized = (meSpace.body?.space ?? meSpace.body)?.me?.channelPrefs?.some((p) => p.channelId === voice && p.shown === false);

  // Active Now: A and B are friends; B sits in the voice channel.
  await api(A, 'POST', '/api/friends/requests', ta, { username: `c2check${tag}b` });
  await api(B, 'POST', `/api/friends/requests/${ida}/accept`, tb);
  const joined = await ack(sb, 'voice:join', { channelId: voice });
  results.voiceJoin = !!joined && !joined.error;
  const activity = await api(A, 'GET', '/api/me/friends/activity', ta);
  results.activeNow = activity.status === 200 && activity.body.some((a) => a.channelId === voice && a.friendIds.includes(idb));
  await ack(sb, 'voice:leave', {});

  // Space preview for a stranger once the Space is discoverable; an invite unfurl.
  await api(A, 'PATCH', `/api/spaces/${spaceId}`, ta, { description: 'A smoke test Space.' });
  await api(A, 'PATCH', `/api/spaces/${spaceId}/community`, ta, { discoveryCategory: 'other' });
  await api(A, 'PATCH', `/api/spaces/${spaceId}/community`, ta, { isDiscoverable: true });
  const preview = await api(A, 'GET', `/api/spaces/${spaceId}/preview`, tc);
  results.preview = preview.status === 200 && preview.body.channels?.some((c) => c.id === general);
  results.previewMessages = (await api(A, 'GET', `/api/spaces/${spaceId}/preview/channels/${general}/messages`, tc)).body?.messages?.some((m) => m.id === posted.id);
  await api(A, 'PATCH', `/api/spaces/${spaceId}/community`, ta, { isDiscoverable: false });
  results.previewHidden = (await api(A, 'GET', `/api/spaces/${spaceId}/preview`, tc)).status;
  const html = await (await fetch(`${A}/join/${invite.body.code}`)).text();
  results.unfurl = html.includes('og:title') && html.includes(`Community2 smoke ${tag}`);
} finally {
  sb?.disconnect();
  for (const id of spaces) results.deleteSpace = (await api(A, 'DELETE', `/api/spaces/${id}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
  results.deletedC = (await api(A, 'DELETE', '/api/me', tc, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
