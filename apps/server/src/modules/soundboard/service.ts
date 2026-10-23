/**
 * The soundboard (docs/design/discord-parity.md W9): up to SPACE_SOUND_LIMIT short clips per
 * Space, free for every Space, managed with MANAGE_EMOJI and played into the voice channel I am
 * connected to. Mirrors custom emoji (services/spaceEmojis.ts).
 *
 * - Clips are uploaded first (`POST /media`, kind audio) and must be mine: MP3, OGG or WAV, at
 *   most MAX_SOUND_BYTES and — when the upload recorded one — at most MAX_SOUND_DURATION_MS
 *   long (the server does not decode audio; the web client measures clips before uploading).
 *   Names are 2-32 characters (not unique: Discord's are not either), volume 0..1.
 * - Mutations lock the Space row (the cap holds), write an audit entry and send the whole list
 *   as `space:sounds` to the Space room after commit.
 * - Playing (`playSound`): a member of the sound's Space, connected to a voice or Stage channel
 *   of any Space with SPEAK there, not in a Stage audience, not muted or deafened (by
 *   themselves or a moderator), at most once per PLAY_COOLDOWN_MS. `voice:sound` goes to that
 *   channel's room, whose clients that are connected there play it.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import {
  MAX_SOUND_BYTES,
  MAX_SOUND_DURATION_MS,
  PERM,
  SPACE_SOUND_LIMIT,
  hasPerm,
  rooms,
  type CreateSpaceSoundRequest,
  type SpaceSound,
  type UpdateSpaceSoundRequest,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { media, spaceSounds } from '../../db/schema.js';
import { badRequest, forbidden, limitReached, notFound, rateLimited } from '../../lib/errors.js';
import { emitToRooms } from '../../realtime/emit.js';
import { getChatAccess } from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { mediaUrl, requireOwnedMedia } from '../../services/media.js';
import { lockSpace, requireSpaceMember, requireSpacePermission } from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { myVoiceConnection } from '../voice/service.js';

export type SpaceSoundRow = typeof spaceSounds.$inferSelect;

/** Clip types a sound may be (sniffed at upload: MP3, OGG — Vorbis or Opus — and WAV). */
export const SOUND_MIME_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav'] as const;

/** One play per user this often (Discord's soundboard cooldown). */
export const PLAY_COOLDOWN_MS = 1_500;

export function toSpaceSound(row: SpaceSoundRow, storageKey: string): SpaceSound {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    emoji: row.emoji,
    volume: row.volume,
    url: mediaUrl(storageKey),
    createdBy: row.createdBy,
  };
}

/** A Space's sounds, in upload order. */
export async function loadSpaceSounds(dbx: DbOrTx, spaceId: string): Promise<SpaceSound[]> {
  const rows = await dbx
    .select({ sound: spaceSounds, storageKey: media.storageKey })
    .from(spaceSounds)
    .innerJoin(media, eq(media.id, spaceSounds.mediaId))
    .where(eq(spaceSounds.spaceId, spaceId))
    .orderBy(asc(spaceSounds.createdAt), asc(spaceSounds.id));
  return rows.map((r) => toSpaceSound(r.sound, r.storageKey));
}

/** One sound of a Space with its file (404 when it is not that Space's). */
async function requireSound(
  dbx: DbOrTx,
  spaceId: string,
  soundId: string,
): Promise<{ sound: SpaceSoundRow; storageKey: string }> {
  const [row] = await dbx
    .select({ sound: spaceSounds, storageKey: media.storageKey })
    .from(spaceSounds)
    .innerJoin(media, eq(media.id, spaceSounds.mediaId))
    .where(and(eq(spaceSounds.id, soundId), eq(spaceSounds.spaceId, spaceId)))
    .limit(1);
  if (!row) throw notFound('Sound');
  return row;
}

/** The list as of the end of the transaction → `space:sounds` to the Space room. */
export function fxSpaceSoundsChanged(fx: Effects, spaceId: string): void {
  let sounds: SpaceSound[] = [];
  fx.add(
    () => emitToRooms([rooms.space(spaceId)], 'space:sounds', { spaceId, sounds }),
    async (dbx) => {
      sounds = await loadSpaceSounds(dbx, spaceId);
    },
  );
}

/** '' and blanks mean no emoji. */
const emojiOrNull = (emoji: string | null | undefined) => (emoji ? emoji : null);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Any member reads a Space's sounds (404 for everyone else). */
export async function listSounds(userId: string, spaceId: string): Promise<SpaceSound[]> {
  await requireSpaceMember(db, spaceId, userId);
  return loadSpaceSounds(db, spaceId);
}

/** A parsed `createSpaceSoundSchema` body (the volume defaulted). */
export type NewSound = Omit<CreateSpaceSoundRequest, 'volume'> & { volume: number };

/** MANAGE_EMOJI adds a sound (409 `limit_reached` once the Space has SPACE_SOUND_LIMIT). */
export async function createSound(userId: string, spaceId: string, body: NewSound): Promise<SpaceSound> {
  return transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, userId, PERM.MANAGE_EMOJI);
    const [n] = await tx.select({ n: count() }).from(spaceSounds).where(eq(spaceSounds.spaceId, spaceId));
    if (Number(n?.n ?? 0) >= SPACE_SOUND_LIMIT)
      throw limitReached(`A Space can have at most ${SPACE_SOUND_LIMIT} sounds`);
    const clip = await requireOwnedMedia(tx, body.mediaId, userId, {
      kinds: ['audio'],
      mimeTypes: SOUND_MIME_TYPES,
      maxBytes: MAX_SOUND_BYTES,
    });
    if (clip.durationMs != null && clip.durationMs > MAX_SOUND_DURATION_MS)
      throw badRequest(`Sounds can be at most ${MAX_SOUND_DURATION_MS / 1000} seconds long`);
    const [row] = await tx
      .insert(spaceSounds)
      .values({
        spaceId,
        name: body.name,
        emoji: emojiOrNull(body.emoji),
        volume: body.volume,
        mediaId: clip.id,
        createdBy: userId,
      })
      .returning();
    await audit(tx, {
      spaceId,
      actorId: userId,
      action: 'sound.create',
      targetId: row!.id,
      changes: { name: row!.name },
    });
    fxSpaceSoundsChanged(fx, spaceId);
    return toSpaceSound(row!, clip.storageKey);
  });
}

/** MANAGE_EMOJI renames a sound, changes its emoji or volume (only the given fields). */
export async function updateSound(
  userId: string,
  spaceId: string,
  soundId: string,
  patch: UpdateSpaceSoundRequest,
): Promise<SpaceSound> {
  return transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, userId, PERM.MANAGE_EMOJI);
    const current = await requireSound(tx, spaceId, soundId);
    const set: Partial<typeof spaceSounds.$inferInsert> = {};
    const changes: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name !== current.sound.name) {
      set.name = patch.name;
      changes.name = [current.sound.name, patch.name];
    }
    if (patch.emoji !== undefined && emojiOrNull(patch.emoji) !== current.sound.emoji) {
      set.emoji = emojiOrNull(patch.emoji);
      changes.emoji = [current.sound.emoji, set.emoji];
    }
    if (patch.volume !== undefined && patch.volume !== current.sound.volume) {
      set.volume = patch.volume;
      changes.volume = [current.sound.volume, patch.volume];
    }
    if (Object.keys(set).length === 0) return toSpaceSound(current.sound, current.storageKey);
    const [row] = await tx.update(spaceSounds).set(set).where(eq(spaceSounds.id, soundId)).returning();
    await audit(tx, { spaceId, actorId: userId, action: 'sound.update', targetId: soundId, changes });
    fxSpaceSoundsChanged(fx, spaceId);
    return toSpaceSound(row!, current.storageKey);
  });
}

/** MANAGE_EMOJI deletes a sound (its file goes with the media GC). */
export async function deleteSound(userId: string, spaceId: string, soundId: string): Promise<void> {
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, userId, PERM.MANAGE_EMOJI);
    const current = await requireSound(tx, spaceId, soundId);
    await tx.delete(spaceSounds).where(eq(spaceSounds.id, soundId));
    await audit(tx, {
      spaceId,
      actorId: userId,
      action: 'sound.delete',
      targetId: soundId,
      changes: { name: current.sound.name },
    });
    fxSpaceSoundsChanged(fx, spaceId);
  });
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/** userId → when they last played a sound (this process; one play per PLAY_COOLDOWN_MS). */
const lastPlay = new Map<string, number>();
let lastSweep = 0;

function takeCooldown(userId: string, now = Date.now()): void {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [id, at] of lastPlay) if (now - at >= PLAY_COOLDOWN_MS) lastPlay.delete(id);
  }
  const last = lastPlay.get(userId);
  if (last !== undefined && now - last < PLAY_COOLDOWN_MS)
    throw rateLimited('You’re playing sounds too fast. Wait a moment.');
  lastPlay.set(userId, now);
}

/** Forget the cooldowns (tests). */
export function resetSoundCooldowns(): void {
  lastPlay.clear();
  lastSweep = 0;
}

/**
 * Play a sound of `spaceId` into the voice channel I am connected to (see the header): 404
 * unless I am a member of the sound's Space and it is that Space's; 400 when I am not in
 * voice, in a Stage audience, muted or deafened; 403 without SPEAK there; 429 within the
 * cooldown. `voice:sound` → that channel's room.
 */
export async function playSound(userId: string, spaceId: string, soundId: string): Promise<void> {
  await requireSpaceMember(db, spaceId, userId);
  const { sound, storageKey } = await requireSound(db, spaceId, soundId);
  const row = await myVoiceConnection(db, userId);
  if (!row) throw badRequest('Join a voice channel to play sounds');
  // My view of that channel: its bits and my member row there (moderator mute and deafen).
  const access = await getChatAccess(db, userId, row.channelId);
  if (!access.space) throw badRequest('Join a voice channel to play sounds');
  if (!hasPerm(access.space.bits, PERM.SPEAK))
    throw forbidden('You do not have permission to speak in this voice channel');
  if (row.suppressed) throw badRequest('You are in the audience. Become a speaker to play sounds.');
  const member = access.space.me.member;
  if (row.selfDeaf || member.serverDeaf) throw badRequest('You can’t play sounds while deafened');
  if (member.serverMute) throw badRequest('You can’t play sounds while a moderator has muted you');
  if (row.selfMute) throw badRequest('Unmute yourself to play sounds');
  takeCooldown(userId);
  emitToRooms([rooms.chat(row.channelId)], 'voice:sound', {
    spaceId: row.spaceId,
    channelId: row.channelId,
    userId,
    sound: toSpaceSound(sound, storageKey),
  });
}
