// Safety and integrations wave smoke test, run ON the production host from
// /opt/enbox/current/apps/server (or locally with SMOKE_A / SMOKE_B): A on :4000, B on :4001.
// Message requests (a stranger's DM), ignore, reports (Space moderators see one), webhooks (a
// public post heard across processes), announcement Publish + Follow into another Space,
// templates (starter and from a Space), GET /messages/:id, suppress-embeds, voice status.
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

const ack = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, (r) => resolve(r)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
const send = (base, token, chatId, text) =>
  api(base, 'POST', `/api/chats/${chatId}/messages`, token, { clientId: `psmoke-${tag}-${++seq}`, type: 'text', text });

const password = 'platform-check-' + tag;
const reg = (base, s) =>
  api(base, 'POST', '/api/auth/register', null, { username: `pcheck${tag}${s}`, displayName: `Platform ${s.toUpperCase()}`, password });
const ra = await reg(A, 'a');
const rb = await reg(B, 'b');
if (ra.status >= 300 || rb.status >= 300) throw new Error(`register ${ra.status} ${rb.status}`);
const ta = ra.body.token;
const tb = rb.body.token;
const [ida, idb] = [ra.body.user.id, rb.body.user.id];
let sa;
let sb;
const spaces = [];
try {
  sa = await connect(A, ta);
  sb = await connect(B, tb);

  // Message request: a stranger's DM lands in B's requests, not B's chat list.
  const heardRequest = next(sb, 'chat:request');
  const dm = await api(A, 'POST', '/api/chats/direct', ta, { userId: idb });
  results.dmOpen = dm.status;
  results.dmSend = (await send(A, ta, dm.body.id, 'hello stranger')).status;
  results.requestEvent = (await heardRequest).chat?.id === dm.body.id;
  results.notInList = !(await api(B, 'GET', '/api/chats', tb)).body?.some((c) => c.id === dm.body.id);
  results.inRequests = (await api(B, 'GET', '/api/chats/requests', tb)).body?.some((c) => c.id === dm.body.id);
  results.accept = (await api(B, 'POST', `/api/chats/${dm.body.id}/request/accept`, tb)).status;
  results.inListAfter = (await api(B, 'GET', '/api/chats', tb)).body?.some((c) => c.id === dm.body.id);

  // Ignore.
  results.ignore = (await api(B, 'PUT', `/api/users/${ida}/ignore`, tb)).status;
  results.ignored = (await api(B, 'GET', '/api/me/ignores', tb)).body?.some((u) => u.id === ida);
  results.unignore = (await api(B, 'DELETE', `/api/users/${ida}/ignore`, tb)).status;

  // A Space with B; A posts, B reports it, A (owner) sees the report.
  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Platform smoke ${tag}` });
  const spaceId = created.body.space.id;
  spaces.push(spaceId);
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);
  const posted = (await send(A, ta, general, 'report me')).body;
  results.report = (await api(B, 'POST', '/api/reports', tb, { targetType: 'message', targetId: posted.id, category: 'spam' })).status;
  results.modSeesReport = (await api(A, 'GET', `/api/spaces/${spaceId}/reports`, ta)).body?.reports?.some((r) => r.targetId === posted.id);
  results.messageById = (await api(B, 'GET', `/api/messages/${posted.id}`, tb)).body?.id === posted.id;
  results.suppress = (await api(A, 'PATCH', `/api/messages/${posted.id}/suppress-embeds`, ta, { suppress: true })).status;

  // Webhook: created on :4000, executed on :4001 without a session, B hears it.
  const hook = await api(A, 'POST', `/api/chats/${general}/webhooks`, ta, { name: 'Smoke Hook' });
  results.webhookCreate = hook.status;
  const secret = hook.body.url.split('/').at(-1);
  const heardHook = next(sb, 'message:new', (p) => p.message.chatId === general && p.message.authorOverride?.name === 'Smoke Bot');
  const executed = await api(B, 'POST', `/api/webhooks/${hook.body.id}/${secret}?wait=true`, null, {
    content: 'from a webhook',
    username: 'Smoke Bot',
    embeds: [{ title: 'Smoke embed', description: 'rich', color: 0x6d5dfc, fields: [{ name: 'a', value: 'b', inline: true }] }],
  });
  results.webhookExecute = executed.status;
  const hookMsg = (await heardHook).message;
  results.webhookAcross = hookMsg.authorOverride?.kind === 'webhook' && hookMsg.embeds?.[0]?.title === 'Smoke embed';
  results.webhookBadToken = (await api(B, 'POST', `/api/webhooks/${hook.body.id}/wrong-token`, null, { content: 'x' })).status;
  results.webhookDelete = (await api(A, 'DELETE', `/api/webhooks/${hook.body.id}`, ta)).status;

  // Announcements: #news in Space 1, followed into Space 2's #general, a publish crossposts there.
  const news = await api(A, 'POST', `/api/spaces/${spaceId}/channels`, ta, { type: 'space_text', name: 'news', isNews: true });
  results.newsCreate = news.status === 201 && news.body.space?.isNews === true;
  const other = await api(A, 'POST', '/api/spaces', ta, { name: `Platform follower ${tag}` });
  spaces.push(other.body.space.id);
  const otherGeneral = other.body.channels.find((c) => c.type === 'space_text').id;
  const follow = await api(A, 'POST', `/api/chats/${news.body.id}/followers`, ta, { targetChannelId: otherGeneral });
  results.follow = follow.status;
  const update = (await send(A, ta, news.body.id, `big news ${tag}`)).body;
  results.publish = (await api(A, 'POST', `/api/messages/${update.id}/crosspost`, ta)).status;
  let copied = false;
  for (let i = 0; i < 20 && !copied; i++) {
    await sleep(250);
    const page = await api(A, 'GET', `/api/chats/${otherGeneral}/messages`, ta);
    copied = page.body?.messages?.some((m) => m.text === `big news ${tag}` && m.authorOverride?.kind === 'crosspost');
  }
  results.crosspostDelivered = copied;

  // Templates: a starter, and one made from Space 1.
  const starter = await api(A, 'POST', '/api/spaces', ta, { name: `Platform gaming ${tag}`, template: 'gaming' });
  if (starter.body?.space?.id) spaces.push(starter.body.space.id);
  results.starterTemplate = starter.status === 201 && starter.body.channels.some((c) => c.name === 'clips-and-highlights');
  const tpl = await api(A, 'POST', `/api/spaces/${spaceId}/templates`, ta, { name: 'Smoke template' });
  results.templateCreate = tpl.status;
  results.templatePreview = (await api(B, 'GET', `/api/templates/${tpl.body?.code}`, tb)).body?.name === 'Smoke template';
  const fromTpl = await api(B, 'POST', '/api/spaces', tb, { name: `From template ${tag}`, template: tpl.body?.code });
  results.spaceFromTemplate = fromTpl.status === 201 && fromTpl.body.channels.some((c) => c.name === 'news');
  if (fromTpl.body?.space?.id) results.deleteTemplateSpace = (await api(B, 'DELETE', `/api/spaces/${fromTpl.body.space.id}`, tb)).status;

  // Voice channel status: set while connected, cleared when the channel empties.
  const voice = created.body.channels.find((c) => c.type === 'space_voice').id;
  await ack(sb, 'voice:join', { channelId: voice });
  results.voiceStatus = (await api(B, 'PUT', `/api/chats/${voice}/voice-status`, tb, { status: 'playing chess' })).status;
  await ack(sb, 'voice:leave', {});
  await sleep(500);
  const info = await api(A, 'GET', `/api/chats/${voice}`, ta);
  results.voiceStatusCleared = !info.body?.space?.voiceStatus;
} finally {
  sa?.disconnect();
  sb?.disconnect();
  for (const id of spaces) results[`deleteSpace_${id.slice(0, 4)}`] = (await api(A, 'DELETE', `/api/spaces/${id}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
