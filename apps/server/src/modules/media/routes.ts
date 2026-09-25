import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_THUMBNAIL_BYTES, MAX_UPLOAD_BYTES, THUMBNAIL_MIME_TYPES, uploadMediaMetaSchema } from '@enbox/shared';
import { db } from '../../db/index.js';
import { media } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { HttpError, badRequest } from '../../lib/errors.js';
import { uploadLimiter } from '../../lib/rateLimit.js';
import { parse } from '../../lib/validate.js';
import { toMediaAttachment } from '../../services/media.js';
import {
  isAllowedMime,
  moveIntoStore,
  newStorageKey,
  removeFiles,
  removeStoredFiles,
  sanitizeFileName,
  sniffFile,
  uploadTmpDir,
} from '../../services/uploads.js';

/**
 * Media module — owns: POST /media (multipart upload). Reference module for conventions:
 * - one exported `router` (mounted under /api behind requireAuth); `authUserId(req)`;
 * - every input parsed with the shared zod schema (`parse()` → 400 validation_error);
 * - errors thrown as HttpError helpers (Express 5 forwards async throws);
 * - no I/O inside DB transactions; cleanup in `finally`.
 *
 * POST /media: multipart `file` (+ optional `thumbnail`) + `uploadMediaMetaSchema` fields.
 * The type is sniffed from the bytes and must be in MEDIA_MIME_ALLOWLIST[kind] (SVG/HTML
 * never pass as images); the stored extension comes from the sniffed type (unknown → .bin);
 * `fileName` is the sanitised client basename (display only). Thumbnail: JPEG/WebP ≤
 * MAX_THUMBNAIL_BYTES. 201 → MediaAttachment. Files land in UPLOAD_DIR/<yyyy>/<mm>/<uuid>.<ext>.
 */
export const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = uploadTmpDir();
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 10, fieldSize: 8 * 1024, parts: 12 },
  // Browsers send UTF-8 file names; multer's default (latin1) would mangle them.
  defParamCharset: 'utf8',
});

/**
 * Run multer, mapping its errors to API errors: 413 for oversize files, 400 for limit
 * violations and malformed multipart bodies (busboy parse errors); filesystem errors
 * (errno codes) stay 500.
 */
function receiveMultipart(req: Request, res: Response, next: NextFunction) {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ])(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'payload_too_large', `${err.field ?? 'file'}: file too large`));
      return next(badRequest(`${err.field ? `${err.field}: ` : ''}${err.message}`));
    }
    const errno = (err as NodeJS.ErrnoException).errno;
    if (err instanceof Error && errno === undefined) return next(badRequest(`Malformed multipart body: ${err.message}`));
    next(err);
  });
}

router.post('/media', uploadLimiter, receiveMultipart, async (req, res) => {
  const userId = authUserId(req);
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
  const file = files.file?.[0];
  const thumb = files.thumbnail?.[0];
  try {
    if (!file) throw badRequest('file: Required');
    const meta = parse(uploadMediaMetaSchema, req.body ?? {});
    if (file.size === 0) throw badRequest('file: Empty file');

    const sniffed = await sniffFile(file.path);
    if (!isAllowedMime(meta.kind, sniffed?.mime ?? null)) {
      throw badRequest(`file: ${sniffed ? `${sniffed.mime} is` : 'unrecognised content is'} not allowed for ${meta.kind} uploads`);
    }

    let thumbExt: string | null = null;
    if (thumb) {
      if (thumb.size > MAX_THUMBNAIL_BYTES) throw new HttpError(413, 'payload_too_large', 'thumbnail: file too large');
      const t = await sniffFile(thumb.path);
      if (!t || !(THUMBNAIL_MIME_TYPES as readonly string[]).includes(t.mime)) throw badRequest('thumbnail: must be a JPEG or WebP image');
      thumbExt = t.ext;
    }

    const key = newStorageKey(sniffed?.ext ?? 'bin');
    const thumbKey = thumbExt ? newStorageKey(thumbExt) : null;
    // Both moves and the row in one try: a failure anywhere (e.g. ENOSPC on the thumbnail)
    // removes what was already stored — the GC only knows files through media rows.
    try {
      await moveIntoStore(file.path, key);
      if (thumb && thumbKey) await moveIntoStore(thumb.path, thumbKey);
      const [row] = await db
        .insert(media)
        .values({
          uploaderId: userId,
          kind: meta.kind,
          mimeType: sniffed?.mime ?? 'application/octet-stream',
          fileName: sanitizeFileName(file.originalname),
          size: file.size,
          width: meta.width ?? null,
          height: meta.height ?? null,
          durationMs: meta.durationMs ?? null,
          waveform: meta.kind === 'voice' ? (meta.waveform ?? null) : null,
          storageKey: key,
          thumbnailKey: thumbKey,
        })
        .returning();
      res.status(201).json(toMediaAttachment(row!));
    } catch (err) {
      await removeStoredFiles([key, thumbKey]);
      throw err;
    }
  } finally {
    // Temp files that were not moved into the store (validation failures).
    await removeFiles([file?.path, thumb?.path]);
  }
});
