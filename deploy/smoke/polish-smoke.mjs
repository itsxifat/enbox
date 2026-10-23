// Polish wave smoke test, run ON the production host from /opt/enbox/current/apps/server
// (or locally with SMOKE_A / SMOKE_B): A on :4000, B on :4001. Super reactions (delta across
// processes), timed polls with End Poll Now and the result message, forwarding with a comment
// and its source, server tags, following and pinning forum posts, and a media channel.
// Everything made here is deleted at the end.
import { io } from 'socket.io-client';

const A = process.env.SMOKE_A ?? 'http://127.0.0.1:4000';
const B = process.env.SMOKE_B ?? 'http://127.0.0.1:4001';
const tag = Math.random().toString(36).slice(2, 8);
const results = {};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwHwyBGMQGMgAAYZYL9ZK/7G0AAAAASUVORK5CYII=',
  'base64',
);

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

async function upload(base, token, kind, bytes, type, name) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return res.json();
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
const clientId = () => `polsmoke-${tag}-${++seq}`;
const send = (base, token, chatId, body) =>
  api(base, 'POST', `/api/chats/${chatId}/messages`, token, { clientId: clientId(), ...body });

const password = 'polish-check-' + tag;
const reg = (base, s) =>
  api(base, 'POST', '/api/auth/register', null, { username: `polcheck${tag}${s}`, displayName: `Pol ${s.toUpperCase()}`, password });
const ra = await reg(A, 'a');
const rb = await reg(B, 'b');
if (ra.status >= 300 || rb.status >= 300) throw new Error(`register ${ra.status} ${rb.status}`);
const ta = ra.body.token;
const tb = rb.body.token;
const [ida, idb] = [ra.body.user.id, rb.body.user.id];
let sa;
const spaces = [];
try {
  sa = await connect(A, ta);
  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Polish smoke ${tag}` });
  const spaceId = created.body.space.id;
  spaces.push(spaceId);
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);

  // Super reactions: B (on :4001) super-reacts; A (on :4000) gets the delta.
  const post = (await send(A, ta, general, { type: 'text', text: 'react to me' })).body;
  const fire = encodeURIComponent('🔥');
  const delta = waitFor(sa, 'message:reaction-add', (p) => p.messageId === post.id && p.burst === true);
  results.superAdd = (await api(B, 'PUT', `/api/messages/${post.id}/reactions/${fire}/@me?burst=true`, tb)).status;
  results.superDelta = !!(await delta);
  await api(B, 'PUT', `/api/messages/${post.id}/reactions/${fire}/@me`, tb);
  const reacted = (await api(A, 'GET', `/api/messages/${post.id}`, ta)).body;
  const fireRow = reacted?.reactions?.find((r) => r.emoji === '🔥');
  results.superCounts = fireRow?.count === 2 && fireRow?.burstCount === 1;
  const superReactors = await api(A, 'GET', `/api/messages/${post.id}/reactions/${fire}?burst=true`, ta);
  results.superReactors = superReactors.status === 200 && superReactors.body.some((u) => u.id === idb);
  results.superRemove = (await api(B, 'DELETE', `/api/messages/${post.id}/reactions/${fire}/@me?burst=true`, tb)).status;

  // Timed poll: emoji answers, a vote, End Poll Now, the result message, no votes after.
  const poll = (
    await send(A, ta, general, {
      type: 'poll',
      poll: { question: `Lunch ${tag}?`, options: ['Pizza', 'Sushi'], emojis: ['🍕', null], durationHours: 24 },
    })
  ).body;
  results.pollEnds = !!poll?.poll?.endsAt && poll.poll.options[0].emoji === '🍕';
  const pizza = poll.poll.options[0].id;
  results.vote = (await api(B, 'PUT', `/api/messages/${poll.id}/vote`, tb, { optionIds: [pizza] })).status;
  results.endForbidden = (await api(B, 'POST', `/api/messages/${poll.id}/poll/end`, tb)).status;
  const ended = await api(A, 'POST', `/api/messages/${poll.id}/poll/end`, ta);
  results.pollEnd = ended.status === 200 && !!ended.body?.poll?.closedAt;
  results.voteAfterEnd = (await api(B, 'PUT', `/api/messages/${poll.id}/vote`, tb, { optionIds: [pizza] })).status;
  const history = (await api(A, 'GET', `/api/chats/${general}/messages`, ta)).body?.messages ?? [];
  const resultMsg = history.find((m) => m.system?.kind === 'poll_result' && m.system.pollMessageId === poll.id);
  results.pollResult = !!resultMsg && resultMsg.system.winners?.[0]?.optionId === pizza;

  // Forward with a comment: the copy points at the original; the comment follows it.
  const second = (await api(A, 'POST', `/api/spaces/${spaceId}/channels`, ta, { type: 'space_text', name: 'second' })).body;
  const fwd = await api(A, 'POST', '/api/messages/forward', ta, {
    clientId: clientId(),
    messageIds: [post.id],
    chatIds: [second.id],
    comment: 'look at this',
  });
  results.forward = fwd.status;
  const secondMsgs = (await api(A, 'GET', `/api/chats/${second.id}/messages`, ta)).body?.messages ?? [];
  results.forwardSource = secondMsgs.some((m) => m.forwardedFrom?.messageId === post.id && m.forwardedFrom?.chatId === general);
  results.forwardComment = secondMsgs.some((m) => m.text === 'look at this' && m.senderId === ida);

  // Server tags: A sets one, B wears it, A sees it on B.
  results.tagSet = (await api(A, 'PUT', `/api/spaces/${spaceId}/tag`, ta, { tag: 'SMK', badge: 'star', color: '#7c6cf8' })).status;
  results.tagBad = (await api(A, 'PUT', `/api/spaces/${spaceId}/tag`, ta, { tag: 'TOOLONG', badge: 'star', color: '#7c6cf8' })).status;
  const worn = await api(B, 'PUT', '/api/me/space-tag', tb, { spaceId });
  results.tagWear = worn.status === 200 && worn.body?.spaceTag?.tag === 'SMK';
  const seen = (await api(A, 'POST', '/api/users/batch', ta, { userIds: [idb] })).body;
  results.tagSeen = seen?.[0]?.spaceTag?.spaceId === spaceId;
  results.tagRemove = (await api(A, 'DELETE', `/api/spaces/${spaceId}/tag`, ta)).status;
  const after = (await api(A, 'POST', '/api/users/batch', ta, { userIds: [idb] })).body;
  results.tagGone = !after?.[0]?.spaceTag;

  // Forum: B's post is followed automatically; A pins it; the pinned post lists first.
  const forum = (await api(A, 'POST', `/api/spaces/${spaceId}/channels`, ta, { type: 'space_forum', name: 'ideas' })).body;
  const p1 = (await api(B, 'POST', `/api/chats/${forum.id}/posts`, tb, { name: 'First idea', text: 'one', clientId: clientId() })).body;
  const p2 = (await api(B, 'POST', `/api/chats/${forum.id}/posts`, tb, { name: 'Second idea', text: 'two', clientId: clientId() })).body;
  const firstId = p1?.thread?.id ?? p1?.id;
  const secondId = p2?.thread?.id ?? p2?.id;
  const followed = (await api(B, 'GET', `/api/spaces/${spaceId}/followed-threads`, tb)).body?.threads ?? [];
  results.autoFollow = followed.some((t) => t.id === firstId) && followed.some((t) => t.id === secondId);
  results.unfollow = (await api(B, 'DELETE', `/api/threads/${firstId}/follow`, tb)).status;
  results.follow = (await api(A, 'PUT', `/api/threads/${firstId}/follow`, ta)).status;
  results.pin = (await api(A, 'PATCH', `/api/threads/${firstId}`, ta, { pinned: true })).status;
  results.pinForbidden = (await api(B, 'PATCH', `/api/threads/${secondId}`, tb, { pinned: true })).status;
  const listed = (await api(A, 'GET', `/api/chats/${forum.id}/posts?sort=created`, ta)).body?.posts ?? [];
  results.pinnedFirst = listed[0]?.thread?.id === firstId && listed[0]?.thread?.thread?.pinned === true;

  // Media channel: a post needs a picture.
  const media = (
    await api(A, 'POST', `/api/spaces/${spaceId}/channels`, ta, { type: 'space_forum', name: 'photos', forumSettings: { media: true } })
  ).body;
  results.mediaLayout = media?.space?.forum?.settings?.layout ?? media?.forum?.settings?.layout ?? null;
  results.mediaNeedsFile = (await api(B, 'POST', `/api/chats/${media.id}/posts`, tb, { name: 'No pic', text: 'x', clientId: clientId() })).status;
  const pics = [await upload(B, tb, 'image', PNG, 'image/png', 'a.png'), await upload(B, tb, 'image', PNG, 'image/png', 'b.png')];
  const withPics = await api(B, 'POST', `/api/chats/${media.id}/posts`, tb, {
    name: 'Two pics',
    text: '',
    mediaId: pics[0].id,
    extraMediaIds: [pics[1].id],
    descriptions: ['first', 'second'],
    clientId: clientId(),
  });
  results.mediaPost = withPics.status;
  const picsFirst = (await api(B, 'GET', `/api/chats/${withPics.body?.id}/messages`, tb)).body?.messages?.[0];
  results.mediaFiles = (picsFirst?.attachments ?? []).length;
} finally {
  sa?.disconnect();
  for (const id of spaces) results.deleteSpace = (await api(A, 'DELETE', `/api/spaces/${id}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
