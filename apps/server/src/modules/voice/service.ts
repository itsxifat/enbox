/**
 * Voice channels (docs/design/discord-parity.md W8): who is connected lives in `voice_states`
 * (one row per account), media goes through a LiveKit server.
 *
 * - `joinVoice`: VIEW_CHANNEL + CONNECT on the channel, not timed out, the user limit (MOVE_MEMBERS
 *   bypasses) checked under the channel row lock; joining from another device or channel moves
 *   the row and disconnects the old socket. Returns a short-lived LiveKit token whose publish
 *   grants follow the bits (SPEAK → microphone, VIDEO → camera, STREAM → screen) and the server
 *   mute/deafen flags.
 * - `leaveVoice` / `updateVoice`: only the socket that holds the row.
 * - Fan-out: `voice:state` to the channel's room (`chat:<id>`, a virtual room that only reaches
 *   those who can see the channel); leaving sends `state: null`.
 * - Cleanup: socket disconnects leave at once; `sweepVoice` (leader) drops rows of dead
 *   processes and of people no longer in the Space; `sweepLocalVoice` (every process) drops
 *   rows bound to sockets of this process that are gone.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import {
  PERM,
  VOICE_MAX_PARTICIPANTS,
  VOICE_TOKEN_TTL_SEC,
  hasPerm,
  rooms,
  type VoiceDisconnectReason,
  type VoiceJoinResult,
  type VoiceState,
  type VoiceUpdatePayload,
} from '@enbox/shared';
import { NODE_ID } from '../../cluster/node.js';
import { deadNodeSql } from '../../cluster/nodes.js';
import { config } from '../../config.js';
import { db, type DbOrTx } from '../../db/index.js';
import { chats, spaceMembers, voiceStates } from '../../db/schema.js';
import { badRequest, forbidden, limitReached, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { emitToRooms, emitToSocket, getIo } from '../../realtime/emit.js';
import { getChatAccess } from '../../services/chats.js';
import {
  channelBits,
  isTimedOut,
  loadChannelOverwrites,
  requireSpaceMember,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';

type VoiceRow = typeof voiceStates.$inferSelect;

export function voiceEnabled(): boolean {
  return !!(config.voice.apiKey && config.voice.apiSecret);
}

function toVoiceState(row: VoiceRow, member: { serverMute: boolean; serverDeaf: boolean } | null): VoiceState {
  return {
    userId: row.userId,
    spaceId: row.spaceId,
    channelId: row.channelId,
    selfMute: row.selfMute,
    selfDeaf: row.selfDeaf,
    selfVideo: row.selfVideo,
    selfStream: row.selfStream,
    serverMute: member?.serverMute ?? false,
    serverDeaf: member?.serverDeaf ?? false,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function emitState(spaceId: string, channelId: string, userId: string, state: VoiceState | null) {
  emitToRooms([rooms.chat(channelId)], 'voice:state', { spaceId, channelId, userId, state });
}

let roomService: RoomServiceClient | null = null;
function liveKit(): RoomServiceClient | null {
  if (!voiceEnabled()) return null;
  roomService ??= new RoomServiceClient(config.voice.apiUrl, config.voice.apiKey, config.voice.apiSecret);
  return roomService;
}

/** Drop someone from the media room (best effort: the room may already be gone). */
function kickFromRoom(channelId: string, userId: string) {
  void liveKit()
    ?.removeParticipant(channelId, userId)
    .catch((err: unknown) => logger.debug({ err, channelId, userId }, 'livekit removeParticipant failed'));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Voice states of a Space, limited to the voice channels the viewer can see. */
export async function listSpaceVoiceStates(viewerId: string, spaceId: string): Promise<VoiceState[]> {
  const access = await requireSpaceMember(db, spaceId, viewerId);
  const rows = await db
    .select({ v: voiceStates, serverMute: spaceMembers.serverMute, serverDeaf: spaceMembers.serverDeaf })
    .from(voiceStates)
    .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, voiceStates.spaceId), eq(spaceMembers.userId, voiceStates.userId)))
    .where(eq(voiceStates.spaceId, spaceId))
    .limit(5_000);
  if (!rows.length) return [];
  const channelIds = [...new Set(rows.map((r) => r.v.channelId))];
  const overwrites = await loadChannelOverwrites(db, channelIds);
  const visible = new Set(
    channelIds.filter((id) =>
      hasPerm(channelBits(access.ctx, viewerId, access.me, 'space_voice', overwrites.get(id) ?? [], access.base), PERM.VIEW_CHANNEL),
    ),
  );
  return rows
    .filter((r) => visible.has(r.v.channelId))
    .map((r) => toVoiceState(r.v, r.serverMute === null ? null : { serverMute: r.serverMute, serverDeaf: r.serverDeaf! }));
}

// ---------------------------------------------------------------------------
// Join / leave / update
// ---------------------------------------------------------------------------

export async function joinVoice(
  userId: string,
  socketId: string,
  channelId: string,
  flags: { selfMute?: boolean; selfDeaf?: boolean } = {},
): Promise<VoiceJoinResult> {
  if (!voiceEnabled()) throw badRequest('Voice channels are not available on this server yet');

  const { state, previous, bits, member } = await db.transaction(async (tx) => {
    const access = await getChatAccess(tx, userId, channelId, { lock: true });
    if (access.chat.type !== 'space_voice' || !access.space) throw notFound('Voice channel');
    const { bits: chBits, me } = access.space;
    if (!hasPerm(chBits, PERM.CONNECT)) throw forbidden('You do not have permission to connect to this voice channel');
    if (isTimedOut(me.member)) throw forbidden('You are timed out in this Space');

    const [prev] = await tx.select().from(voiceStates).where(eq(voiceStates.userId, userId)).for('update');
    if (prev?.channelId !== channelId) {
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(voiceStates)
        .where(and(eq(voiceStates.channelId, channelId), ne(voiceStates.userId, userId)))) as [{ n: number }];
      const limit = access.chat.userLimit ?? VOICE_MAX_PARTICIPANTS;
      if (n >= Math.min(limit, VOICE_MAX_PARTICIPANTS) && !hasPerm(chBits, PERM.MOVE_MEMBERS))
        throw limitReached('This voice channel is full');
    }

    const now = new Date();
    const values = {
      userId,
      spaceId: access.chat.spaceId!,
      channelId,
      socketId,
      nodeId: NODE_ID,
      selfMute: flags.selfMute ?? prev?.selfMute ?? false,
      selfDeaf: flags.selfDeaf ?? prev?.selfDeaf ?? false,
      // Camera and screen start off on every (re)join.
      selfVideo: false,
      selfStream: false,
      joinedAt: prev?.channelId === channelId ? prev.joinedAt : now,
      updatedAt: now,
    };
    const { userId: _key, ...set } = values;
    const [row] = await tx
      .insert(voiceStates)
      .values(values)
      .onConflictDoUpdate({ target: voiceStates.userId, set })
      .returning();
    return {
      state: toVoiceState(row!, me.member),
      previous: prev ?? null,
      bits: chBits,
      member: me.member,
    };
  });

  if (previous && previous.socketId !== socketId)
    emitToSocket(previous.socketId, 'voice:disconnected', { channelId: previous.channelId, reason: 'moved_elsewhere' });
  if (previous && previous.channelId !== channelId) {
    emitState(previous.spaceId, previous.channelId, userId, null);
    kickFromRoom(previous.channelId, userId);
  }
  emitState(state.spaceId, channelId, userId, state);

  const sources: TrackSource[] = [];
  if (hasPerm(bits, PERM.SPEAK) && !member.serverMute) sources.push(TrackSource.MICROPHONE);
  if (hasPerm(bits, PERM.VIDEO)) sources.push(TrackSource.CAMERA);
  if (hasPerm(bits, PERM.STREAM)) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  const at = new AccessToken(config.voice.apiKey, config.voice.apiSecret, {
    identity: userId,
    ttl: VOICE_TOKEN_TTL_SEC,
  });
  at.addGrant({
    room: channelId,
    roomJoin: true,
    canSubscribe: !member.serverDeaf,
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canPublishData: true,
  });
  return { url: config.voice.url, token: await at.toJwt(), state, relayOnly: config.voice.relayOnly };
}

/** Leave my voice channel (only the socket that holds the connection, unless `socketId` is null). */
export async function leaveVoice(
  userId: string,
  socketId: string | null,
): Promise<VoiceRow | null> {
  const [row] = await db
    .delete(voiceStates)
    .where(socketId ? and(eq(voiceStates.userId, userId), eq(voiceStates.socketId, socketId)) : eq(voiceStates.userId, userId))
    .returning();
  if (!row) return null;
  emitState(row.spaceId, row.channelId, userId, null);
  return row;
}

export async function updateVoice(userId: string, socketId: string, patch: VoiceUpdatePayload): Promise<void> {
  if (!Object.keys(patch).length) return;
  const [row] = await db
    .update(voiceStates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(voiceStates.userId, userId), eq(voiceStates.socketId, socketId)))
    .returning();
  if (!row) return;
  const [m] = await db
    .select({ serverMute: spaceMembers.serverMute, serverDeaf: spaceMembers.serverDeaf })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, row.spaceId), eq(spaceMembers.userId, userId)));
  emitState(row.spaceId, row.channelId, userId, toVoiceState(row, m ?? null));
}

/** Disconnect someone from voice (MOVE_MEMBERS in the Space), audited. */
export async function disconnectMember(actorId: string, spaceId: string, targetId: string): Promise<void> {
  await requireSpacePermission(db, spaceId, actorId, PERM.MOVE_MEMBERS, 'You cannot disconnect members from voice');
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .delete(voiceStates)
      .where(and(eq(voiceStates.userId, targetId), eq(voiceStates.spaceId, spaceId)))
      .returning();
    if (!r) throw notFound('Voice connection');
    await audit(tx, { spaceId, actorId, action: 'member.voice_disconnect', targetType: 'member', targetId });
    return r;
  });
  endConnection(row, 'disconnected_by_moderator');
}

function endConnection(row: VoiceRow, reason: VoiceDisconnectReason) {
  emitToSocket(row.socketId, 'voice:disconnected', { channelId: row.channelId, reason });
  emitState(row.spaceId, row.channelId, row.userId, null);
  kickFromRoom(row.channelId, row.userId);
}

/** End every voice connection of a user in a Space (they left or were removed). */
export async function endVoiceInSpace(dbx: DbOrTx, spaceId: string, userId: string, reason: VoiceDisconnectReason) {
  const rows = await dbx
    .delete(voiceStates)
    .where(and(eq(voiceStates.spaceId, spaceId), eq(voiceStates.userId, userId)))
    .returning();
  for (const r of rows) endConnection(r, reason);
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

/** Leader: rows of dead processes, and of people who are no longer members of the Space. */
export async function sweepVoice(): Promise<void> {
  const dead = await db.delete(voiceStates).where(deadNodeSql(voiceStates.nodeId)).returning();
  for (const r of dead) endConnection(r, 'server_restart');
  const gone = await db
    .delete(voiceStates)
    .where(
      sql`not exists (select 1 from ${spaceMembers} where ${spaceMembers.spaceId} = ${voiceStates.spaceId} and ${spaceMembers.userId} = ${voiceStates.userId})`,
    )
    .returning();
  for (const r of gone) endConnection(r, 'lost_access');
  // Channels that stopped being voice channels or were deleted are removed by the FK cascade.
  const stale = await db
    .select({ id: voiceStates.channelId })
    .from(voiceStates)
    .innerJoin(chats, eq(chats.id, voiceStates.channelId))
    .where(ne(chats.type, 'space_voice'))
    .limit(500);
  if (stale.length) {
    const rows = await db.delete(voiceStates).where(inArray(voiceStates.channelId, stale.map((s) => s.id))).returning();
    for (const r of rows) endConnection(r, 'channel_deleted');
  }
}

/** Every process: rows bound to sockets of this process that no longer exist. */
export async function sweepLocalVoice(): Promise<void> {
  const io = getIo();
  if (!io) return;
  const mine = await db
    .select({ userId: voiceStates.userId, socketId: voiceStates.socketId })
    .from(voiceStates)
    .where(eq(voiceStates.nodeId, NODE_ID))
    .limit(5_000);
  for (const r of mine) if (!io.sockets.sockets.has(r.socketId)) await leaveVoice(r.userId, r.socketId);
}
