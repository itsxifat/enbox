/**
 * Voice channels (docs/design/discord-parity.md W8) and Stage channels (W9): who is connected
 * lives in `voice_states` (one row per account), media goes through a LiveKit server.
 *
 * - `joinVoice`: VIEW_CHANNEL + CONNECT on the channel, not timed out, the user limit (MOVE_MEMBERS
 *   bypasses) checked under the channel row lock; joining from another device or channel moves
 *   the row and disconnects the old socket. Returns a short-lived LiveKit token whose publish
 *   grants follow the bits (SPEAK → microphone, VIDEO → camera, STREAM → screen), the server
 *   mute/deafen flags and the Stage role (`mediaPermission`).
 * - `leaveVoice` / `updateVoice`: only the socket that holds the row.
 * - `moveMember`: a moderator drags someone into another voice or Stage channel of the Space;
 *   the row keeps its socket, which gets `voice:moved` with a token for the new room.
 * - Stage channels (`space_stage`): everyone joins in the audience (`suppressed`: a token that
 *   subscribes but cannot publish), moderators too. A raised hand is `request_to_speak_at`
 *   (`setStageRequest`). Stage moderators (MANAGE_CHANNELS, or MUTE_MEMBERS + MOVE_MEMBERS, in
 *   the channel) invite people up and move speakers back to the audience; anyone may step down,
 *   a moderator may step up (`setStageSpeaker`). The new grants reach the media server live
 *   (`updateParticipant`), best effort after commit: when that fails (not connected to the media
 *   server yet, LiveKit down) the next token is right anyway — a rejoin of the same channel
 *   keeps the row's role, and clients rejoin when the grant does not arrive. A speaker whose
 *   socket drops gets the seat back when they return within STAGE_REJOIN_GRACE_MS.
 * - Fan-out: `voice:state` to the channel's room (`chat:<id>`, a virtual room that only reaches
 *   those who can see the channel); leaving sends `state: null`.
 * - Cleanup: socket disconnects leave at once; `sweepVoice` (leader) drops rows of dead
 *   processes and of people no longer in the Space; `sweepLocalVoice` (every process) drops
 *   rows bound to sockets of this process that are gone.
 * - Channel status (status.ts): every way out of a channel (leave, joining another one, a
 *   move, a moderator's disconnect, the sweeps) clears its status once nobody is left.
 */
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
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
  loadSpaceMember,
  requireSpaceMember,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { clearEmptyVoiceStatuses } from './status.js';

type VoiceRow = typeof voiceStates.$inferSelect;
type MemberFlags = { serverMute: boolean; serverDeaf: boolean };

/** Channel types people connect to (Stage channels are voice channels with an audience). */
export const VOICE_CHANNEL_TYPES = ['space_voice', 'space_stage'] as const;
type VoiceChannelType = (typeof VOICE_CHANNEL_TYPES)[number];

function isVoiceChannelType(type: string): type is VoiceChannelType {
  return (VOICE_CHANNEL_TYPES as readonly string[]).includes(type);
}

/**
 * A moved member's client leaves the old media room itself on `voice:moved`; the server drops
 * it from there this much later (a client that does not, without racing the event).
 */
const MOVE_KICK_DELAY_MS = 5_000;

export function voiceEnabled(): boolean {
  return !!(config.voice.apiKey && config.voice.apiSecret);
}

function toVoiceState(row: VoiceRow, member: MemberFlags | null): VoiceState {
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
    suppressed: row.suppressed,
    requestToSpeakAt: row.requestToSpeakAt?.toISOString() ?? null,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function emitState(spaceId: string, channelId: string, userId: string, state: VoiceState | null) {
  emitToRooms([rooms.chat(channelId)], 'voice:state', { spaceId, channelId, userId, state });
}

async function memberFlags(dbx: DbOrTx, spaceId: string, userId: string): Promise<MemberFlags | null> {
  const [m] = await dbx
    .select({ serverMute: spaceMembers.serverMute, serverDeaf: spaceMembers.serverDeaf })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
  return m ?? null;
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

/** What a participant may do in the media room (LiveKit's token grant and `ParticipantPermission`). */
export interface MediaPermission {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: TrackSource[];
}

/**
 * The grant of a connection: publishing follows the bits (SPEAK → microphone unless server
 * muted, VIDEO → camera, STREAM → screen and its audio) and nothing at all in a Stage audience
 * (`suppressed`); subscribing stops while server deafened. Data stays on (in-call signalling).
 */
export function mediaPermission(bits: number, member: MemberFlags, suppressed: boolean): MediaPermission {
  const sources: TrackSource[] = [];
  if (!suppressed) {
    if (hasPerm(bits, PERM.SPEAK) && !member.serverMute) sources.push(TrackSource.MICROPHONE);
    if (hasPerm(bits, PERM.VIDEO)) sources.push(TrackSource.CAMERA);
    if (hasPerm(bits, PERM.STREAM)) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  return {
    canSubscribe: !member.serverDeaf,
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canPublishData: true,
  };
}

/** A short-lived LiveKit token for `channelId` with `permission` (see `mediaPermission`). */
async function mediaToken(userId: string, channelId: string, permission: MediaPermission): Promise<string> {
  const at = new AccessToken(config.voice.apiKey, config.voice.apiSecret, {
    identity: userId,
    ttl: VOICE_TOKEN_TTL_SEC,
  });
  at.addGrant({ room: channelId, roomJoin: true, ...permission });
  return at.toJwt();
}

/**
 * Apply new grants to a live media connection without a reconnect. Best effort, after commit:
 * the participant may not have reached the media server yet (or it is down); their next token
 * carries the same grants.
 */
function pushMediaPermission(channelId: string, userId: string, permission: MediaPermission): void {
  const lk = liveKit();
  if (!lk) return;
  let pending: Promise<unknown>;
  try {
    pending = lk.updateParticipant(channelId, userId, { permission });
  } catch (err) {
    pending = Promise.reject(err);
  }
  void pending.catch((err: unknown) =>
    logger.warn({ err, channelId, userId }, 'livekit updateParticipant failed'),
  );
}

/**
 * A Stage speaker whose socket dropped (the media connection survives short drops, the client
 * joins again after `ready`) is seated as a speaker again when they come back to the same
 * channel this soon. Per process; leaving on purpose forgets it.
 */
const STAGE_REJOIN_GRACE_MS = 30_000;
const stageRejoin = new Map<string, { channelId: string; until: number }>();

function rememberSpeaker(row: VoiceRow, now = Date.now()): void {
  for (const [id, e] of stageRejoin) if (e.until <= now) stageRejoin.delete(id);
  if (!row.suppressed) stageRejoin.set(row.userId, { channelId: row.channelId, until: now + STAGE_REJOIN_GRACE_MS });
}

/** Whether `userId` was a speaker of `channelId` until their socket dropped just now. */
function hadSpeakerSeat(userId: string, channelId: string): boolean {
  const e = stageRejoin.get(userId);
  return !!e && e.channelId === channelId && e.until > Date.now();
}

/** Stage moderators: MANAGE_CHANNELS, or both MUTE_MEMBERS and MOVE_MEMBERS, in the channel. */
export function isStageModerator(bits: number): boolean {
  return hasPerm(bits, PERM.MANAGE_CHANNELS) || hasPerm(bits, PERM.MUTE_MEMBERS | PERM.MOVE_MEMBERS);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Voice states of a Space, limited to the voice and Stage channels the viewer can see. */
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
  // Voice and Stage channels compute alike (the same type mask).
  const visible = new Set(
    channelIds.filter((id) =>
      hasPerm(channelBits(access.ctx, viewerId, access.me, 'space_voice', overwrites.get(id) ?? [], access.base), PERM.VIEW_CHANNEL),
    ),
  );
  return rows
    .filter((r) => visible.has(r.v.channelId))
    .map((r) => toVoiceState(r.v, r.serverMute === null ? null : { serverMute: r.serverMute, serverDeaf: r.serverDeaf! }));
}

/** My voice connection (null when I am not connected to a voice or Stage channel). */
export async function myVoiceConnection(dbx: DbOrTx, userId: string): Promise<VoiceRow | null> {
  const [row] = await dbx.select().from(voiceStates).where(eq(voiceStates.userId, userId)).limit(1);
  return row ?? null;
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

  const { state, previous, permission } = await db.transaction(async (tx) => {
    const access = await getChatAccess(tx, userId, channelId, { lock: true });
    if (!isVoiceChannelType(access.chat.type) || !access.space) throw notFound('Voice channel');
    const stage = access.chat.type === 'space_stage';
    const { bits: chBits, me } = access.space;
    if (!hasPerm(chBits, PERM.CONNECT)) throw forbidden('You do not have permission to connect to this voice channel');
    if (isTimedOut(me.member)) throw forbidden('You are timed out in this Space');

    const [prev] = await tx.select().from(voiceStates).where(eq(voiceStates.userId, userId)).for('update');
    const same = prev && prev.channelId === channelId ? prev : null;
    if (!same) {
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
      // Stage: everyone starts in the audience (moderators step up themselves); joining the
      // same channel again (another device, a socket reconnect) keeps the role and the hand.
      suppressed: stage ? (same?.suppressed ?? !hadSpeakerSeat(userId, channelId)) : false,
      requestToSpeakAt: stage ? (same?.requestToSpeakAt ?? null) : null,
      joinedAt: same?.joinedAt ?? now,
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
      permission: mediaPermission(chBits, me.member, row!.suppressed),
    };
  });

  if (previous && previous.socketId !== socketId)
    emitToSocket(previous.socketId, 'voice:disconnected', { channelId: previous.channelId, reason: 'moved_elsewhere' });
  if (previous && previous.channelId !== channelId) {
    emitState(previous.spaceId, previous.channelId, userId, null);
    kickFromRoom(previous.channelId, userId);
    await clearEmptyVoiceStatuses([previous.channelId]);
  }
  emitState(state.spaceId, channelId, userId, state);
  stageRejoin.delete(userId);

  const token = await mediaToken(userId, channelId, permission);
  return { url: config.voice.url, token, state, relayOnly: config.voice.relayOnly };
}

/**
 * Leave my voice channel (only the socket that holds the connection, unless `socketId` is null).
 * `socketGone`: the socket dropped rather than left — a Stage speaker may take their seat back
 * (STAGE_REJOIN_GRACE_MS).
 */
export async function leaveVoice(
  userId: string,
  socketId: string | null,
  opts: { socketGone?: boolean } = {},
): Promise<VoiceRow | null> {
  const [row] = await db
    .delete(voiceStates)
    .where(socketId ? and(eq(voiceStates.userId, userId), eq(voiceStates.socketId, socketId)) : eq(voiceStates.userId, userId))
    .returning();
  if (!row) return null;
  if (opts.socketGone) rememberSpeaker(row);
  else stageRejoin.delete(userId);
  emitState(row.spaceId, row.channelId, userId, null);
  await clearEmptyVoiceStatuses([row.channelId]);
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
  emitState(row.spaceId, row.channelId, userId, toVoiceState(row, await memberFlags(db, row.spaceId, userId)));
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
  await clearEmptyVoiceStatuses([row.channelId]);
}

/**
 * Move someone to another voice or Stage channel of the Space (Discord's drag in the channel
 * list), audited. The mover needs MOVE_MEMBERS where they are and in the target, and CONNECT on
 * the target; the moved member must be able to see it. The user limit does not apply; moved
 * into a Stage, they land in the audience. The row keeps its socket: `voice:moved` hands it a
 * token for the new room (no new `voice:join`).
 */
export async function moveMember(
  actorId: string,
  spaceId: string,
  targetId: string,
  channelId: string,
): Promise<void> {
  if (!voiceEnabled()) throw badRequest('Voice channels are not available on this server yet');

  const moved = await db.transaction(async (tx) => {
    // Lock order: the target channel row, then the voice state (as joinVoice).
    const access = await getChatAccess(tx, actorId, channelId, { lock: true });
    if (!isVoiceChannelType(access.chat.type) || !access.space || access.chat.spaceId !== spaceId)
      throw badRequest('Members can only be moved to a voice channel of this Space');
    const toType = access.chat.type;
    const { ctx, me, base, bits } = access.space;
    if (!hasPerm(bits, PERM.MOVE_MEMBERS)) throw forbidden('You cannot move members to this voice channel');
    if (!hasPerm(bits, PERM.CONNECT)) throw forbidden('You do not have permission to connect to this voice channel');

    const [row] = await tx
      .select()
      .from(voiceStates)
      .where(and(eq(voiceStates.userId, targetId), eq(voiceStates.spaceId, spaceId)))
      .for('update');
    if (!row) throw notFound('Voice connection');
    if (row.channelId === channelId) return null;

    const overwrites = await loadChannelOverwrites(tx, [row.channelId, channelId]);
    // Voice and Stage channels compute alike (the same type mask).
    const fromBits = channelBits(ctx, actorId, me, 'space_voice', overwrites.get(row.channelId) ?? [], base);
    if (!hasPerm(fromBits, PERM.MOVE_MEMBERS)) throw forbidden('You cannot move members out of that voice channel');
    const target = targetId === actorId ? me : await loadSpaceMember(tx, spaceId, targetId);
    if (!target) throw notFound('Voice connection');
    const targetBits = channelBits(ctx, targetId, target, toType, overwrites.get(channelId) ?? []);
    if (!hasPerm(targetBits, PERM.VIEW_CHANNEL)) throw forbidden('They cannot see that voice channel');

    const now = new Date();
    const [updated] = await tx
      .update(voiceStates)
      // Camera and screen start off in the new room (as on every join); a Stage seats them in
      // the audience.
      .set({
        channelId,
        selfVideo: false,
        selfStream: false,
        suppressed: toType === 'space_stage',
        requestToSpeakAt: null,
        joinedAt: now,
        updatedAt: now,
      })
      .where(eq(voiceStates.userId, targetId))
      .returning();
    await audit(tx, {
      spaceId,
      actorId,
      action: 'member.voice_move',
      targetType: 'member',
      targetId,
      changes: { from: row.channelId, to: channelId },
    });
    return { from: row.channelId, row: updated!, bits: targetBits, member: target.member };
  });
  if (!moved) return;

  const state = toVoiceState(moved.row, moved.member);
  emitState(spaceId, moved.from, targetId, null);
  emitState(spaceId, channelId, targetId, state);
  const token = await mediaToken(targetId, channelId, mediaPermission(moved.bits, moved.member, moved.row.suppressed));
  emitToSocket(moved.row.socketId, 'voice:moved', {
    from: moved.from,
    result: { url: config.voice.url, token, state, relayOnly: config.voice.relayOnly },
  });
  const kick = setTimeout(() => void kickIfStillMoved(targetId, moved.from), MOVE_KICK_DELAY_MS);
  kick.unref?.();
  await clearEmptyVoiceStatuses([moved.from]);
}

/** After a move: drop the member from the old room, unless they went back there meanwhile. */
async function kickIfStillMoved(userId: string, from: string): Promise<void> {
  try {
    const [row] = await db
      .select({ channelId: voiceStates.channelId })
      .from(voiceStates)
      .where(eq(voiceStates.userId, userId));
    if (row?.channelId !== from) kickFromRoom(from, userId);
  } catch (err) {
    logger.debug({ err, userId }, 'voice move cleanup failed');
  }
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
  await clearEmptyVoiceStatuses(rows.map((r) => r.channelId), dbx);
}

// ---------------------------------------------------------------------------
// Stage channels
// ---------------------------------------------------------------------------

/**
 * Raise (`true`) or lower my hand in my Stage channel of the Space: 400 unless I am in one.
 * Raising needs SPEAK in the channel; a speaker's hand stays down, and a raised hand keeps its
 * first time (the moderators' list is in that order). `voice:state` when it changed.
 */
export async function setStageRequest(userId: string, spaceId: string, requestToSpeak: boolean): Promise<VoiceState> {
  const out = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(voiceStates)
      .where(and(eq(voiceStates.userId, userId), eq(voiceStates.spaceId, spaceId)))
      .for('update');
    const [chat] = row
      ? await tx.select({ type: chats.type }).from(chats).where(eq(chats.id, row.channelId))
      : [];
    if (!row || chat?.type !== 'space_stage') throw badRequest('You are not in a Stage channel of this Space');
    const member = await memberFlags(tx, spaceId, userId);
    let next = row.requestToSpeakAt;
    if (!requestToSpeak) next = null;
    else if (row.suppressed && !next) {
      const access = await getChatAccess(tx, userId, row.channelId);
      if (!hasPerm(access.space?.bits, PERM.SPEAK)) throw forbidden('You do not have permission to speak on this Stage');
      next = new Date();
    }
    if (next === row.requestToSpeakAt) return { row, member, changed: false };
    const [updated] = await tx
      .update(voiceStates)
      .set({ requestToSpeakAt: next, updatedAt: new Date() })
      .where(eq(voiceStates.userId, userId))
      .returning();
    return { row: updated!, member, changed: true };
  });
  const state = toVoiceState(out.row, out.member);
  if (out.changed) emitState(spaceId, out.row.channelId, userId, state);
  return state;
}

/**
 * Seat someone on a Stage: `suppressed: false` makes them a speaker (a moderator inviting
 * them up, at once; or a moderator stepping up), `true` moves them to the audience (anyone
 * may step down; a moderator moves others). Either way their hand goes down. 404 when they
 * are not connected in this Space (or I cannot see their channel), 400 when that is not a
 * Stage, 403 without moderator rights. The DB change and `voice:state` come first; the media
 * server learns the new grants after commit, best effort (`pushMediaPermission`).
 */
export async function setStageSpeaker(
  actorId: string,
  spaceId: string,
  targetId: string,
  suppressed: boolean,
): Promise<VoiceState> {
  const out = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(voiceStates)
      .where(and(eq(voiceStates.userId, targetId), eq(voiceStates.spaceId, spaceId)))
      .for('update');
    if (!row) throw notFound('Voice connection');
    // My view of their channel: 404 unless I am a member who can see it.
    const access = await getChatAccess(tx, actorId, row.channelId);
    if (access.chat.type !== 'space_stage' || !access.space) throw badRequest('They are not in a Stage channel');
    const self = targetId === actorId;
    if (!isStageModerator(access.space.bits) && !(self && suppressed))
      throw forbidden(
        self ? 'Only Stage moderators can make themselves speakers' : 'Only Stage moderators can move people on a Stage',
      );
    const target = self ? access.space.me : await loadSpaceMember(tx, spaceId, targetId);
    if (!target) throw notFound('Voice connection');
    if (row.suppressed === suppressed && row.requestToSpeakAt === null)
      return { row, member: target.member, bits: 0, changed: false, roleChanged: false };
    const [updated] = await tx
      .update(voiceStates)
      .set({ suppressed, requestToSpeakAt: null, updatedAt: new Date() })
      .where(eq(voiceStates.userId, targetId))
      .returning();
    const bits = self
      ? access.space.bits
      : channelBits(access.space.ctx, targetId, target, 'space_stage', access.space.overwrites);
    return { row: updated!, member: target.member, bits, changed: true, roleChanged: row.suppressed !== suppressed };
  });
  const state = toVoiceState(out.row, out.member);
  if (out.changed) emitState(spaceId, out.row.channelId, targetId, state);
  if (out.roleChanged)
    pushMediaPermission(out.row.channelId, targetId, mediaPermission(out.bits, out.member, out.row.suppressed));
  return state;
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
  // Channels that stopped being voice (or Stage) channels; deleted ones go by the FK cascade.
  const stale = await db
    .select({ id: voiceStates.channelId })
    .from(voiceStates)
    .innerJoin(chats, eq(chats.id, voiceStates.channelId))
    .where(notInArray(chats.type, [...VOICE_CHANNEL_TYPES]))
    .limit(500);
  const emptied = [...dead, ...gone].map((r) => r.channelId);
  if (stale.length) {
    const rows = await db.delete(voiceStates).where(inArray(voiceStates.channelId, stale.map((s) => s.id))).returning();
    for (const r of rows) endConnection(r, 'channel_deleted');
  }
  await clearEmptyVoiceStatuses(emptied);
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
  for (const r of mine)
    if (!io.sockets.sockets.has(r.socketId)) await leaveVoice(r.userId, r.socketId, { socketGone: true });
}
