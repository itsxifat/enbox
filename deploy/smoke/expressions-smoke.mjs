// Expressions and security wave smoke test, run ON the production host from
// /opt/enbox/current/apps/server: A and C on :4000, B on :4001. Stickers (create, the event
// across processes, send), a message with several files and alt text, a group DM of three
// friends, a Stage channel (audience, raised hand, invite to speak), the soundboard (upload,
// play heard across processes) and two-factor sign-in (enable, login challenge, code login,
// backup code). The Spaces and test accounts made here are deleted at the end.
import crypto from 'node:crypto';
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

const ack = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, (r) => resolve(r)));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwHwyBGMQGMgAAYZYL9ZK/7G0AAAAASUVORK5CYII=',
  'base64',
);

/** A short 8 kHz mono WAV tone. */
function wav(ms) {
  const rate = 8000;
  const n = Math.floor((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(i / 4));
  return b;
}

async function upload(base, token, kind, bytes, type, name, extra = {}) {
  const form = new FormData();
  form.append('kind', kind);
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return res.json();
}

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

let seq = 0;
const clientId = () => `esmoke-${tag}-${++seq}`;

const password = 'expressions-check-' + tag;
const reg = async (base, s) =>
  api(base, 'POST', '/api/auth/register', null, { username: `echeck${tag}${s}`, displayName: `Check ${s.toUpperCase()}`, password });
const ra = await reg(A, 'a');
const rb = await reg(B, 'b');
const rc = await reg(A, 'c');
if (ra.status >= 300 || rb.status >= 300 || rc.status >= 300) throw new Error(`register ${ra.status} ${rb.status} ${rc.status}`);
const ta = ra.body.token;
const tb = rb.body.token;
let tc = rc.body.token;
const [ida, idb, idc] = [ra.body.user.id, rb.body.user.id, rc.body.user.id];
let sa;
let sb;
const spaces = [];
try {
  sa = await connect(A, ta);
  sb = await connect(B, tb);
  const created = await api(A, 'POST', '/api/spaces', ta, { name: `Expressions smoke ${tag}` });
  const spaceId = created.body.space.id;
  spaces.push(spaceId);
  const general = created.body.channels.find((c) => c.type === 'space_text').id;
  const invite = await api(A, 'POST', `/api/spaces/${spaceId}/invites`, ta, {});
  await api(B, 'POST', `/api/invites/${invite.body.code}/join`, tb);

  // Stickers: create on :4000, B hears it on :4001, B sends it.
  const stickerMedia = await upload(A, ta, 'image', PNG, 'image/png', 'sticker.png');
  const heard = next(sb, 'space:stickers', (p) => p.spaceId === spaceId);
  const sticker = await api(A, 'POST', `/api/spaces/${spaceId}/stickers`, ta, { name: 'smoke', emoji: '🙂', mediaId: stickerMedia.id });
  results.stickerCreate = sticker.status;
  results.stickerAcross = (await heard).stickers?.some((s) => s.id === sticker.body?.id);
  results.myStickers = (await api(B, 'GET', '/api/me/stickers', tb)).body?.some((g) => g.spaceId === spaceId);
  const sent = await api(B, 'POST', `/api/chats/${general}/messages`, tb, { clientId: clientId(), type: 'sticker', stickerId: sticker.body?.id });
  results.stickerSend = sent.status === 201 && sent.body?.type === 'image' && sent.body?.sticker?.id === sticker.body?.id;

  // Several files with alt text.
  const files = [];
  for (let i = 0; i < 3; i++) files.push(await upload(A, ta, 'image', PNG, 'image/png', `f${i}.png`));
  const multi = await api(A, 'POST', `/api/chats/${general}/messages`, ta, {
    clientId: clientId(),
    type: 'image',
    mediaId: files[0].id,
    extraMediaIds: files.slice(1).map((f) => f.id),
    descriptions: ['first', null, 'third'],
    text: 'three files',
  });
  results.multiSend = multi.status;
  results.multiAttachments =
    multi.body?.attachments?.length === 3 && multi.body.attachments[2].description === 'third';

  // Group DM: A, B and C are friends of A.
  for (const [base, token, user] of [[B, tb, 'b'], [A, tc, 'c']]) {
    await api(A, 'POST', '/api/friends/requests', ta, { username: `echeck${tag}${user}` });
    await api(base, 'POST', `/api/friends/requests/${ida}/accept`, token);
  }
  const groupDm = await api(A, 'POST', '/api/chats/group-dm', ta, { userIds: [idb, idc] });
  results.groupDmCreate = groupDm.status < 300 && groupDm.body?.isGroupDm === true;
  results.groupDmSend = (
    await api(B, 'POST', `/api/chats/${groupDm.body?.id}/messages`, tb, { clientId: clientId(), type: 'text', text: 'hi all' })
  ).status;
  results.groupDmRemove = (await api(A, 'DELETE', `/api/chats/${groupDm.body?.id}/group-dm/members/${idc}`, ta)).status;

  // Stage: B joins as audience, raises a hand, A invites B to speak.
  const stage = await api(A, 'POST', `/api/spaces/${spaceId}/channels`, ta, { type: 'space_stage', name: 'stage' });
  results.stageCreate = stage.status;
  const joined = await ack(sb, 'voice:join', { channelId: stage.body?.id });
  results.stageJoin = !!joined && !joined.error;
  const states = await api(B, 'GET', `/api/spaces/${spaceId}/voice-states`, tb);
  results.stageAudience = states.body?.some((s) => s.userId === idb && s.suppressed === true);
  results.raiseHand = (await api(B, 'PATCH', `/api/spaces/${spaceId}/voice-states/@me`, tb, { requestToSpeak: true })).status;
  const up = next(sa, 'voice:state', (p) => p.userId === idb && p.state?.suppressed === false);
  results.inviteToSpeak = (await api(A, 'PATCH', `/api/spaces/${spaceId}/voice-states/${idb}/stage`, ta, { suppressed: false })).status;
  results.speakerAcross = !!(await up);

  // Soundboard: A uploads a sound, B (speaking on the stage) plays it, A hears the event.
  const soundMedia = await upload(A, ta, 'audio', wav(400), 'audio/wav', 'beep.wav', { durationMs: 400 });
  const sound = await api(A, 'POST', `/api/spaces/${spaceId}/sounds`, ta, { name: 'beep', mediaId: soundMedia.id, volume: 0.5 });
  results.soundCreate = sound.status;
  const played = next(sa, 'voice:sound', (p) => p.sound?.id === sound.body?.id);
  await ack(sa, 'voice:join', { channelId: stage.body?.id });
  results.soundPlay = (await api(B, 'POST', `/api/spaces/${spaceId}/sounds/${sound.body?.id}/play`, tb)).status;
  results.soundAcross = !!(await played);
  await ack(sa, 'voice:leave', {});
  await ack(sb, 'voice:leave', {});

  // Two-factor for C: enable, log in with the challenge, then a backup code works once.
  const setup = await api(A, 'POST', '/api/me/mfa/totp/setup', tc);
  results.mfaSetup = setup.status;
  const step = Math.floor(Date.now() / 30000);
  const enabled = await api(A, 'POST', '/api/me/mfa/totp/enable', tc, { code: totp(setup.body.secret, step) });
  results.mfaEnable = enabled.status;
  const codes = enabled.body?.codes ?? [];
  const challenge = await api(B, 'POST', '/api/auth/login', null, { identifier: `echeck${tag}c`, password });
  results.mfaChallenge = challenge.body?.mfaRequired === true && !challenge.body?.token;
  const mfaLogin = await api(B, 'POST', '/api/auth/login/mfa', null, { ticket: challenge.body?.ticket, code: totp(setup.body.secret, step + 1) });
  results.mfaLogin = mfaLogin.status === 200 && !!mfaLogin.body?.token;
  const again = await api(A, 'POST', '/api/auth/login', null, { identifier: `echeck${tag}c`, password });
  const backup = await api(A, 'POST', '/api/auth/login/mfa', null, { ticket: again.body?.ticket, code: codes[0] });
  results.mfaBackup = backup.status === 200;
  const reuse = await api(A, 'POST', '/api/auth/login', null, { identifier: `echeck${tag}c`, password });
  results.mfaBackupOnce = (await api(A, 'POST', '/api/auth/login/mfa', null, { ticket: reuse.body?.ticket, code: codes[0] })).status === 400;
  results.mfaDisable = (await api(A, 'POST', '/api/me/mfa/totp/disable', tc, { code: codes[1] })).status;
} finally {
  sa?.disconnect();
  sb?.disconnect();
  for (const id of spaces) results.deleteSpace = (await api(A, 'DELETE', `/api/spaces/${id}`, ta)).status;
  results.deletedA = (await api(A, 'DELETE', '/api/me', ta, { password })).status;
  results.deletedB = (await api(B, 'DELETE', '/api/me', tb, { password })).status;
  results.deletedC = (await api(A, 'DELETE', '/api/me', tc, { password })).status;
}
console.log(JSON.stringify(results));
process.exit(0);
