/**
 * Media rows → wire attachments, and ownership checks for client-supplied media ids.
 * Upload handling lives in modules/media (route) + services/uploads.ts (sniffing, storage).
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  type MediaAttachment,
  type MediaKind,
} from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import { media, type MediaRow } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uniq } from './sql.js';

/** Public URL path of a stored file (served by app.ts under /uploads). */
export function mediaUrl(key: string): string {
  return `/uploads/${key}`;
}

export function toMediaAttachment(row: MediaRow): MediaAttachment {
  return {
    id: row.id,
    kind: row.kind,
    url: mediaUrl(row.storageKey),
    thumbnailUrl: row.thumbnailKey ? mediaUrl(row.thumbnailKey) : null,
    mimeType: row.mimeType,
    fileName: row.fileName,
    size: Number(row.size),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    waveform: row.waveform ?? null,
  };
}

/** Media rows keyed by id (one query). */
export async function loadMediaMap(
  dbx: DbOrTx,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, MediaRow>> {
  const list = uniq([...ids].filter((x): x is string => !!x));
  const out = new Map<string, MediaRow>();
  if (list.length === 0) return out;
  for (const row of await dbx.select().from(media).where(inArray(media.id, list)))
    out.set(row.id, row);
  return out;
}

export interface OwnedMediaOptions {
  /** Allowed kinds (e.g. `[message.type]`); mismatch → 400. */
  kinds?: readonly MediaKind[];
  /** Allowed sniffed MIME types; mismatch → 400. */
  mimeTypes?: readonly string[];
  /** Max size in bytes; larger → 400. */
  maxBytes?: number;
}

/**
 * The media row for a client-supplied id: 404 unless uploaded by `userId` (docs "Media":
 * never reveal other users' uploads); 400 when the kind/MIME/size doesn't fit. Inside a
 * transaction the row is locked `FOR KEY SHARE` so the media GC (which deletes with
 * `FOR UPDATE SKIP LOCKED`) can never delete it before the referencing row commits.
 */
export async function requireOwnedMedia(
  dbx: DbOrTx,
  mediaId: string,
  userId: string,
  opts: OwnedMediaOptions = {},
): Promise<MediaRow> {
  const [row] = await dbx
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.uploaderId, userId)))
    .limit(1)
    .for('key share');
  if (!row) throw notFound('Media');
  if (opts.kinds && !opts.kinds.includes(row.kind)) {
    throw badRequest(`Media must be of kind ${opts.kinds.join(' or ')} (got ${row.kind})`);
  }
  if (opts.mimeTypes && !opts.mimeTypes.includes(row.mimeType))
    throw badRequest(`Unsupported media type ${row.mimeType}`);
  if (opts.maxBytes !== undefined && Number(row.size) > opts.maxBytes)
    throw badRequest('Media is too large');
  return row;
}

/** Avatars (user, group, community, channel): kind image, AVATAR_MIME_TYPES, ≤ MAX_AVATAR_BYTES, uploaded by the caller. */
export function requireAvatarMedia(
  dbx: DbOrTx,
  mediaId: string,
  userId: string,
): Promise<MediaRow> {
  return requireOwnedMedia(dbx, mediaId, userId, {
    kinds: ['image'],
    mimeTypes: AVATAR_MIME_TYPES,
    maxBytes: MAX_AVATAR_BYTES,
  });
}
