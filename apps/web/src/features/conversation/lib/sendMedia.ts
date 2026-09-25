/**
 * Media sends: optimistic bubble with the local preview → upload with progress (shown in
 * the bubble) → send with the same clientId. Uploads can be cancelled from the bubble and
 * failed sends retried (re-uploading if the upload itself failed).
 *
 * Local object URLs: the thumbnail's is revoked once the server copy is confirmed, a photo's
 * once the server image is decoded (the bubble switches without a flash); others (audio,
 * video, files — possibly playing) are released with the message (see stores/messages.ts).
 */
import type { ID, MediaAttachment, MediaKind, Message, MessagePreview } from '@enbox/shared';
import { ApiError, mediaUrl } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { createObjectUrl, revokeObjectUrl } from '@/lib/media';
import { isOptimistic, useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { holdForReconnect, isOfflineError } from './outbox';
import { uploadMedia } from './upload';

export interface MediaSendInput {
  kind: MediaKind;
  blob: Blob;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  thumbnail?: Blob | null;
  caption?: string;
  replyToId?: ID;
  replyTo?: MessagePreview | null;
}

interface MediaJob {
  chatId: ID;
  run: () => Promise<void>;
  /** Set while uploading. */
  controller: AbortController | null;
}

/** clientId → media send that can still be retried/cancelled. */
const jobs = new Map<string, MediaJob>();

/**
 * Cancel a media send: aborts a running upload (its bubble is removed), or drops a send that
 * is waiting (failed, or queued for the reconnect) together with its bubble.
 */
export function cancelUpload(clientId: string): boolean {
  const job = jobs.get(clientId);
  if (!job) return false;
  if (job.controller) {
    job.controller.abort();
    return true;
  }
  jobs.delete(clientId);
  useMessages.getState().removeOptimistic(job.chatId, clientId);
  return true;
}

/** Re-run a failed media send (returns false when this client id has no media job). */
export function retryMediaSend(clientId: string): boolean {
  const job = jobs.get(clientId);
  if (!job) return false;
  void job.run();
  return true;
}

function hasOptimistic(chatId: ID, clientId: string): boolean {
  return !!useMessages
    .getState()
    .byChat[chatId]?.items.some((m) => m.clientId === clientId && isOptimistic(m));
}

/** Show the server copy of a sent photo once it is decoded, then free the local blob. */
async function swapToServerImage(chatId: ID, message: Message, localUrl: string): Promise<void> {
  const url = mediaUrl(message.media?.url);
  if (!url || typeof Image === 'undefined') return;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
  } catch {
    return; // keep the local copy (offline, not decodable…)
  }
  useMessages.getState().patchMessage(chatId, message.id, { localUrl: undefined });
  revokeObjectUrl(localUrl);
}

/**
 * Show the optimistic bubble now and return the job that uploads + sends it. Callers sending
 * several items add all bubbles first, then run the jobs in order (keeps message order).
 */
export function enqueueMedia(chatId: ID, input: MediaSendInput): () => Promise<void> {
  const clientId = newClientId();
  const localUrl = createObjectUrl(input.blob);
  const thumbUrl = input.thumbnail ? createObjectUrl(input.thumbnail) : null;
  const media: MediaAttachment = {
    id: `local-${clientId}`,
    kind: input.kind,
    url: localUrl,
    thumbnailUrl: thumbUrl,
    mimeType: input.mimeType,
    fileName: input.fileName,
    size: input.blob.size,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    waveform: input.waveform ?? null,
  };
  const caption = input.caption?.trim() || undefined;
  const store = useMessages.getState();
  store.addOptimistic(chatId, {
    clientId,
    type: input.kind,
    text: caption ?? null,
    media,
    localUrl,
    uploadProgress: 0,
    replyTo: input.replyTo ?? null,
  });

  let uploaded: MediaAttachment | null = null;
  const job: MediaJob = { chatId, run: () => Promise.resolve(), controller: null };
  const run = async () => {
    // Deleted/cancelled meanwhile (or already delivered): nothing left to send.
    if (!hasOptimistic(chatId, clientId)) {
      jobs.delete(clientId);
      return;
    }
    const s = useMessages.getState();
    const controller = new AbortController();
    job.controller = controller;
    s.patchOptimistic(chatId, clientId, {
      pending: true,
      failed: false,
      uploadProgress: uploaded ? 1 : 0,
    });
    try {
      if (!uploaded) {
        uploaded = await uploadMedia(
          input.blob,
          {
            kind: input.kind,
            width: input.width,
            height: input.height,
            durationMs: input.durationMs,
            waveform: input.waveform,
          },
          {
            fileName: input.fileName,
            thumbnail: input.thumbnail,
            signal: controller.signal,
            onProgress: (p) =>
              useMessages.getState().patchOptimistic(chatId, clientId, { uploadProgress: p }),
          },
        );
      }
      job.controller = null;
      const message = await useMessages.getState().sendMessage(chatId, {
        clientId,
        type: input.kind,
        mediaId: uploaded.id,
        text: caption,
        replyToId: input.replyToId,
      });
      jobs.delete(clientId);
      // The confirmed message carries the server's media (and thumbnail).
      revokeObjectUrl(thumbUrl);
      if (input.kind === 'image') void swapToServerImage(chatId, message, localUrl);
    } catch (e) {
      job.controller = null;
      if (e instanceof ApiError && e.code === 'aborted') {
        jobs.delete(clientId);
        useMessages.getState().removeOptimistic(chatId, clientId);
        return;
      }
      if (isOfflineError(e)) {
        holdForReconnect(chatId, clientId, run);
        return;
      }
      useMessages.getState().markFailed(chatId, clientId);
      toast.error(e);
    }
  };
  job.run = run;
  jobs.set(clientId, job);
  return run;
}

export function sendMedia(chatId: ID, input: MediaSendInput): Promise<void> {
  return enqueueMedia(chatId, input)();
}
