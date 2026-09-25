import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import {
  callLogQuerySchema,
  callOutcome,
  idParamSchema,
  type CallLogEntry,
  type CallParticipantStatus,
  type IceServerConfig,
  type UserPublic,
} from '@enbox/shared';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { callParticipants, calls, chatMembers, chats, media } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { conflict, notFound } from '../../lib/errors.js';
import { parse, storableDate } from '../../lib/validate.js';
import { mediaUrl } from '../../services/media.js';
import { uniq } from '../../services/sql.js';
import { toUserPublicMap } from '../../services/users.js';
import { LIVE_CALL_STATUSES, isLive, loadCallRows, toCall } from './service.js';

/**
 * Calls module — owns: /calls/* (history, active calls, ICE servers). Signaling lives in
 * socket.ts (state machine in service.ts). Literal paths are registered before `/:callId`.
 *
 * - GET /calls: my call log (participant rows not hidden), newest first, `before` cursor
 *   (ISO, exclusive), direction/outcome from the shared `callOutcome(call, me, myStatus)`.
 * - GET /calls/:callId: one entry of that log (same serialization); 404 unless I have a
 *   participant row that is not hidden.
 * - GET /calls/active: live calls in chats where I'm an active member (incl. calls ringing
 *   me), except calls where my participant row is hidden (a callee who blocked the caller).
 * - GET /calls/ice-servers: STUN + TURN; with TURN_SECRET, coturn REST credentials
 *   (username `<expiry>:<userId>`, credential base64(HMAC-SHA1(secret, username))).
 * - DELETE /calls/:callId, DELETE /calls: hide ended calls from my log (live → 409).
 */
export const router = Router();

/** A row of my call log: one of my (not hidden) participant rows. */
interface LogRow {
  callId: string;
  chatId: string;
  myStatus: CallParticipantStatus;
}

/** `CallLogEntry[]` for my log rows (input order; a fixed number of queries). */
async function toCallLogEntries(me: string, rows: LogRow[]): Promise<CallLogEntry[]> {
  if (rows.length === 0) return [];
  const loaded = await loadCallRows(
    db,
    rows.map((r) => r.callId),
  );
  const chatIds = uniq(rows.map((r) => r.chatId));
  const chatRows = await db
    .select({ id: chats.id, type: chats.type, name: chats.name, avatarKey: media.storageKey })
    .from(chats)
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(inArray(chats.id, chatIds));
  const chatById = new Map(chatRows.map((c) => [c.id, c]));
  const directIds = chatRows.filter((c) => c.type === 'direct').map((c) => c.id);
  const peerRows = directIds.length
    ? await db
        .select({ chatId: chatMembers.chatId, userId: chatMembers.userId })
        .from(chatMembers)
        .where(and(inArray(chatMembers.chatId, directIds), ne(chatMembers.userId, me)))
    : [];
  const peerIdOf = new Map(peerRows.map((r) => [r.chatId, r.userId]));
  const peers = await toUserPublicMap(db, me, peerIdOf.values());

  const out: CallLogEntry[] = [];
  for (const r of rows) {
    const entry = loaded.get(r.callId);
    const chat = chatById.get(r.chatId);
    if (!entry || !chat) continue;
    const call = toCall(entry.call, entry.parts);
    const { direction, outcome } = callOutcome(call, me, r.myStatus);
    const peerId = peerIdOf.get(chat.id);
    const peer: UserPublic | null =
      chat.type === 'direct' && peerId ? (peers.get(peerId) ?? null) : null;
    out.push({
      call,
      direction,
      outcome,
      chat: {
        id: chat.id,
        type: chat.type,
        name: chat.type === 'direct' ? null : chat.name,
        avatarUrl: chat.type !== 'direct' && chat.avatarKey ? mediaUrl(chat.avatarKey) : null,
        peer,
      },
    });
  }
  return out;
}

const logRowFields = { callId: calls.id, chatId: calls.chatId, myStatus: callParticipants.status };

router.get('/calls', async (req, res) => {
  const me = authUserId(req);
  const q = parse(callLogQuerySchema, req.query);
  const rows = await db
    .select(logRowFields)
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.userId, me),
        isNull(callParticipants.hiddenAt),
        q.before ? lt(calls.createdAt, storableDate(q.before, 'before')) : undefined,
      ),
    )
    .orderBy(desc(calls.createdAt), desc(calls.id))
    .limit(q.limit);
  res.json(await toCallLogEntries(me, rows));
});

router.get('/calls/active', async (req, res) => {
  const me = authUserId(req);
  const rows = await db
    .select({ id: calls.id })
    .from(calls)
    .innerJoin(
      chatMembers,
      and(
        eq(chatMembers.chatId, calls.chatId),
        eq(chatMembers.userId, me),
        isNull(chatMembers.leftAt),
      ),
    )
    .where(
      and(
        inArray(calls.status, LIVE_CALL_STATUSES),
        sql`not exists (select 1 from ${callParticipants} where ${callParticipants.callId} = ${calls.id}
              and ${callParticipants.userId} = ${me} and ${callParticipants.hiddenAt} is not null)`,
      ),
    )
    .orderBy(desc(calls.createdAt));
  const loaded = await loadCallRows(
    db,
    rows.map((r) => r.id),
  );
  res.json(
    rows.flatMap((r) =>
      loaded.has(r.id) ? [toCall(loaded.get(r.id)!.call, loaded.get(r.id)!.parts)] : [],
    ),
  );
});

router.get('/calls/ice-servers', (req, res) => {
  const me = authUserId(req);
  const ice = config.ice;
  const iceServers: IceServerConfig[] = [];
  if (ice.stunUrls.length) iceServers.push({ urls: ice.stunUrls });
  if (ice.turnUrls.length) {
    if (ice.turnSecret) {
      const expiry = Math.floor(Date.now() / 1000) + ice.turnTtlSec;
      const username = `${expiry}:${me}`;
      const credential = createHmac('sha1', ice.turnSecret).update(username).digest('base64');
      iceServers.push({ urls: ice.turnUrls, username, credential });
    } else if (ice.turnUsername && ice.turnCredential) {
      iceServers.push({
        urls: ice.turnUrls,
        username: ice.turnUsername,
        credential: ice.turnCredential,
      });
    } else {
      iceServers.push({ urls: ice.turnUrls });
    }
  }
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers, ttlSec: ice.turnTtlSec });
});

// After the literal `/calls/active` and `/calls/ice-servers` (docs "Routes").
router.get('/calls/:callId', async (req, res) => {
  const me = authUserId(req);
  const { callId } = parse(idParamSchema('callId'), req.params);
  const rows = await db
    .select(logRowFields)
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.callId, callId),
        eq(callParticipants.userId, me),
        isNull(callParticipants.hiddenAt),
      ),
    )
    .limit(1);
  const [entry] = await toCallLogEntries(me, rows);
  if (!entry) throw notFound('Call');
  res.json(entry);
});

router.delete('/calls', async (req, res) => {
  const me = authUserId(req);
  await db
    .update(callParticipants)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        eq(callParticipants.userId, me),
        isNull(callParticipants.hiddenAt),
        inArray(
          callParticipants.callId,
          db
            .select({ id: calls.id })
            .from(calls)
            .where(notInArray(calls.status, LIVE_CALL_STATUSES)),
        ),
      ),
    );
  res.status(204).end();
});

router.delete('/calls/:callId', async (req, res) => {
  const me = authUserId(req);
  const { callId } = parse(idParamSchema('callId'), req.params);
  const [row] = await db
    .select({ status: calls.status, hiddenAt: callParticipants.hiddenAt })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, me)))
    .limit(1);
  if (!row || row.hiddenAt) throw notFound('Call');
  if (isLive(row.status)) throw conflict('This call is still in progress');
  await db
    .update(callParticipants)
    .set({ hiddenAt: new Date() })
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, me)));
  res.status(204).end();
});
