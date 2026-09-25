/**
 * Upload hardening (docs "Media"): MIME sniffing from the bytes, per-kind allowlists, file
 * name sanitising, storage keys and file moves/removal.
 *
 * Sniffing uses the `file-type` package (magic numbers + container parsing: ISO-BMFF brands,
 * EBML DocType, Ogg codecs, ID3/MPEG frames…). Its MIME names are normalised to the ones in
 * MEDIA_MIME_ALLOWLIST (e.g. `audio/x-m4a` → `audio/mp4`, parameters stripped). Text formats
 * (SVG, HTML, plain text) have no magic number: they sniff as unknown (or `application/xml`
 * with an XML declaration), so they can never pass an image/video/audio allowlist; for the
 * `file` kind they are stored as `.bin`/`.xml` and always served as attachments.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileTypeFromFile } from 'file-type';
import { MAX_FILE_NAME_LENGTH, MEDIA_MIME_ALLOWLIST, type MediaKind } from '@enbox/shared';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const MIME_ALIASES: Record<string, string> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-aac': 'audio/aac',
  'image/apng': 'image/png',
  'video/x-m4v': 'video/mp4',
};

/** Stored extension for canonical types (others use file-type's extension). */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
};

export interface SniffedType {
  mime: string;
  ext: string;
}

/** Sniff a file's type from its bytes; null when unrecognised. */
export async function sniffFile(filePath: string): Promise<SniffedType | null> {
  const t = await fileTypeFromFile(filePath);
  if (!t) return null;
  const base = t.mime.split(';')[0]!.trim().toLowerCase();
  const mime = MIME_ALIASES[base] ?? base;
  const ext = EXTENSIONS[mime] ?? t.ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  return { mime, ext: ext || 'bin' };
}

/** Whether a sniffed type (null = unrecognised) is accepted for an upload kind. */
export function isAllowedMime(kind: MediaKind, mime: string | null): boolean {
  const allow = MEDIA_MIME_ALLOWLIST[kind] as readonly string[] | null;
  if (allow === null) return true;
  return mime !== null && allow.includes(mime);
}

// Control chars, bidi marks/embeddings/overrides/isolates, BOM, line/paragraph separators.
// (ZWJ/ZWNJ are kept: they are part of emoji sequences and some scripts.)
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const UNSAFE_CHARS = new RegExp(
  `[\\p{Cc}\\p{Zl}\\p{Zp}${cp(0x061c, 0x200e, 0x200f, 0xfeff)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`,
  'gu',
);

/**
 * Sanitised display name of an upload: basename only (both separators), control/bidi/format
 * characters removed, NFC, trimmed, ≤ MAX_FILE_NAME_LENGTH code points (the extension is
 * kept when truncating). Never used for storage or in headers. Empty / "." / ".." → null.
 */
export function sanitizeFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = name.normalize('NFC').replace(UNSAFE_CHARS, '');
  s = s.split(/[\\/]/).pop() ?? '';
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s === '.' || s === '..') return null;
  const chars = Array.from(s);
  if (chars.length > MAX_FILE_NAME_LENGTH) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 ? Array.from(s.slice(dot)) : [];
    if (ext.length > 0 && ext.length <= 16) {
      s =
        chars
          .slice(0, MAX_FILE_NAME_LENGTH - ext.length)
          .join('')
          .trimEnd() + ext.join('');
    } else {
      s = chars.slice(0, MAX_FILE_NAME_LENGTH).join('').trimEnd();
    }
  }
  return s || null;
}

/** New storage key `<yyyy>/<mm>/<uuid>.<ext>` (relative to UPLOAD_DIR; also the URL path under /uploads). */
export function newStorageKey(ext: string, now: Date = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

/** Absolute path of a storage key (rejects keys escaping UPLOAD_DIR). */
export function storagePath(key: string): string {
  const root = path.resolve(config.uploadDir);
  const abs = path.resolve(root, key);
  if (!abs.startsWith(root + path.sep)) throw new Error(`Invalid storage key ${key}`);
  return abs;
}

/** Directory for in-flight multipart files (dot-dir: never served by /uploads). */
export function uploadTmpDir(): string {
  return path.join(config.uploadDir, '.tmp');
}

/** Move a temp file to its storage key (same filesystem: rename; else copy + unlink). */
export async function moveIntoStore(tmpPath: string, key: string): Promise<void> {
  const dest = storagePath(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(tmpPath, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.copyFile(tmpPath, dest);
    await fs.unlink(tmpPath);
  }
}

/** Delete files (temp paths or storage keys), ignoring missing ones. */
export async function removeFiles(paths: Iterable<string | null | undefined>): Promise<void> {
  for (const p of paths) {
    if (!p) continue;
    try {
      await fs.unlink(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        logger.warn({ err, path: p }, 'failed to remove file');
    }
  }
}

/** Delete stored files by storage key. */
export async function removeStoredFiles(keys: Iterable<string | null | undefined>): Promise<void> {
  await removeFiles([...keys].filter((k): k is string => !!k).map(storagePath));
}
