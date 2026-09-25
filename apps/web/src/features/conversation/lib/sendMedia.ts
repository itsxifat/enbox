/**
 * Media sends: optimistic bubble with the local preview → upload with progress (shown in
 * the bubble) → send with the same clientId. Uploads can be cancelled from the bubble and
 * failed sends retried (re-uploading if the upload itself failed).
 */
import type { ID, MediaAttachment, MediaKind, MessagePreview } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { createObjectUrl } from '@/lib/media';
import { useMessages } from '@/stores/messages';
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

const controllers = new Map<string, AbortController>();
const retries = new Map<string, () => Promise<void>>();

export function cancelUpload(clientId: string): boolean {
  const c = controllers.get(clientId);
  if (!c) return false;
  c.abort();
  return true;
}

/** Re-run a failed media send (returns false when this client id has no media job). */
export function retryMediaSend(clientId: string): boolean {
  const job = retries.get(clientId);
  if (!job) return false;
  void job();
  return true;
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
  const run = async () => {
    const s = useMessages.getState();
    const controller = new AbortController();
    controllers.set(clientId, controller);
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
      controllers.delete(clientId);
      await useMessages.getState().sendMessage(chatId, {
        clientId,
        type: input.kind,
        mediaId: uploaded.id,
        text: caption,
        replyToId: input.replyToId,
      });
      retries.delete(clientId);
    } catch (e) {
      controllers.delete(clientId);
      if (e instanceof ApiError && e.code === 'aborted') {
        retries.delete(clientId);
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
  retries.set(clientId, run);
  return run;
}

export function sendMedia(chatId: ID, input: MediaSendInput): Promise<void> {
  return enqueueMedia(chatId, input)();
}
