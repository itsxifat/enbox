/**
 * Channel attachments go through the same pipeline as chat media (docs/ARCHITECTURE.md
 * "Client-side processing"): photos are re-encoded through a canvas (EXIF/GPS stripped,
 * longest side ≤ IMAGE_MAX_DIMENSION) with a thumbnail, videos get a poster; documents are
 * uploaded unchanged. `enqueueMedia` shows the optimistic post (with its media, so pending
 * documents render), handles offline and registers the retry used by the post's "Retry".
 */
import { MAX_CAPTION_LENGTH, MAX_UPLOAD_BYTES, formatBytes, type ID } from '@enbox/shared';
import { toast } from '@/stores/ui';
import { isVisualMedia, prepareVisualMedia } from '@/features/conversation/lib/mediaProcessing';
import { enqueueMedia } from '@/features/conversation/lib/sendMedia';

/**
 * Post `files` to a channel in the picked order. The caption goes on the first post only.
 * Files over MAX_UPLOAD_BYTES are skipped with a toast; a photo/video the browser can't
 * process is skipped too (never uploaded raw: its metadata would reach every follower).
 * Returns once every upload + send has run.
 */
export async function postFiles(
  chatId: ID,
  files: File[],
  opts: { asDocument: boolean; caption?: string },
): Promise<void> {
  const big = files.find((f) => f.size > MAX_UPLOAD_BYTES);
  if (big) toast.error(`“${big.name}” is larger than ${formatBytes(MAX_UPLOAD_BYTES)}`);
  let caption = opts.caption?.trim().slice(0, MAX_CAPTION_LENGTH) || undefined;
  const jobs: (() => Promise<void>)[] = [];
  // Prepared one at a time (decoding several large photos at once can exhaust memory).
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) continue;
    if (!opts.asDocument && isVisualMedia(file)) {
      let prepared: Awaited<ReturnType<typeof prepareVisualMedia>>;
      try {
        prepared = await prepareVisualMedia(file);
      } catch {
        toast.error(`Couldn’t process “${file.name}”`);
        continue;
      }
      jobs.push(enqueueMedia(chatId, { ...prepared, caption }));
    } else {
      // Documents (and anything that isn't a photo/video) are uploaded unchanged.
      jobs.push(
        enqueueMedia(chatId, {
          kind: 'file',
          blob: file,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          caption,
        }),
      );
    }
    caption = undefined;
  }
  for (const job of jobs) await job();
}
