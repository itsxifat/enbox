/**
 * Media sends: optimistic bubble with the local preview → upload with progress (shown in
 * the bubble) → send with the same clientId. Uploads can be cancelled from the bubble and
 * failed sends retried (re-uploading if the upload itself failed).
 *
 * Local object URLs: the thumbnail's is revoked once the server copy is confirmed, a photo's
 * once the server image is decoded (the bubble switches without a flash); others (audio,
 * video, files — possibly playing) are released with the message (see stores/messages.ts).
 *
 * Messages with several files (the composer's tray, up to MAX_ATTACHMENTS_PER_MESSAGE):
 * `uploadAll` uploads them with per-file progress (the tray's tiles show it), then
 * `sendAttachments` sends ONE message of them: `mediaId` + `extraMediaIds` + alt text.
 */
import type {
  ID,
  MediaAttachment,
  MediaKind,
  Message,
  MessageAttachment,
  MessagePreview,
} from '@enbox/shared';
import { ApiError, mediaUrl } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { createObjectUrl, readAudioDuration, revokeObjectUrl } from '@/lib/media';
import { isOptimistic, useMessages, type SendInput } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { isVisualFile } from '../bubbles/attachments';
import { prepareVisualMedia } from './mediaProcessing';
import { holdForReconnect, isOfflineError, sendQueued } from './outbox';
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
  /** Animated image (GIF / WebP / APNG): the bubble shows `thumbnail` as its poster. */
  animated?: boolean;
  caption?: string;
  replyToId?: ID;
  replyTo?: MessagePreview | null;
  /** "@ OFF" on a reply: don't mention the replied author. */
  mentionRepliedAuthor?: boolean;
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
    animated: input.animated ?? false,
    frameCount: null,
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
        ...(input.mentionRepliedAuthor === false ? { mentionRepliedAuthor: false } : {}),
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

// ---------------------------------------------------------------------------
// Messages with several files
// ---------------------------------------------------------------------------

/** One file of a message with several (a tile of the composer's tray). */
export interface AttachmentFile {
  /** The tile's id (for the callbacks). */
  id: string;
  /** The file as it is uploaded (renamed and marked, see `trayFile`). */
  file: File;
  /** Photos and videos are re-encoded and get a poster; audio gets its duration. */
  kind: 'visual' | 'audio' | 'file';
  /** Already uploaded (an earlier attempt): not sent again. */
  media?: MediaAttachment;
}

export interface UploadAllCallbacks {
  onProgress(id: string, fraction: number): void;
  onUploaded(id: string, media: MediaAttachment): void;
  onFailed(id: string, error: unknown): void;
}

/** What goes with the files: the caption (the message's text) and the reply. */
export interface AttachmentLead {
  caption?: string;
  replyToId?: ID;
  replyTo?: MessagePreview | null;
  /** "@ OFF" on a reply: don't mention the replied author. */
  mentionRepliedAuthor?: boolean;
  /** @silent: no push or desktop notification. */
  silent?: boolean;
}

async function prepareAttachment(f: AttachmentFile): Promise<MediaSendInput> {
  if (f.kind === 'visual') return prepareVisualMedia(f.file);
  return {
    kind: f.kind,
    blob: f.file,
    fileName: f.file.name,
    mimeType: f.file.type || 'application/octet-stream',
    durationMs:
      f.kind === 'audio' ? await readAudioDuration(f.file).catch(() => undefined) : undefined,
  };
}

/**
 * Upload the files of one message in order, with progress. One file is prepared at a time
 * (decoding several photos at once runs phones out of memory) while the one before it
 * uploads. Resolves with every file's server copy, in order — or null when one failed
 * (`onFailed`; the others still go up, so a retry only sends the failed ones again) or
 * `signal` aborted (the upload in flight is cancelled).
 */
export async function uploadAll(
  files: AttachmentFile[],
  signal: AbortSignal,
  cb: UploadAllCallbacks,
): Promise<MediaAttachment[] | null> {
  const out = files.map((f) => f.media);
  let failed = false;
  let uploads = Promise.resolve();
  for (const [i, f] of files.entries()) {
    if (f.media) continue;
    if (signal.aborted) break;
    let input: MediaSendInput;
    try {
      input = await prepareAttachment(f);
    } catch (e) {
      failed = true;
      cb.onFailed(f.id, e);
      continue;
    }
    uploads = uploads.then(async () => {
      if (signal.aborted) return;
      try {
        const media = await uploadMedia(
          input.blob,
          {
            kind: input.kind,
            width: input.width,
            height: input.height,
            durationMs: input.durationMs,
          },
          {
            fileName: input.fileName,
            thumbnail: input.thumbnail,
            signal,
            onProgress: (p) => cb.onProgress(f.id, p),
          },
        );
        out[i] = media;
        cb.onUploaded(f.id, media);
      } catch (e) {
        if (signal.aborted) return;
        failed = true;
        cb.onFailed(f.id, e);
      }
    });
  }
  await uploads;
  if (signal.aborted || failed || out.some((m) => !m)) return null;
  return out as MediaAttachment[];
}

/**
 * Send ONE message of uploaded files: the photos and videos first (they lead the mosaic, and
 * the first file's kind is the message's type — old clients show `media`), then the others,
 * each with its alt text (blank = none); the caption belongs to the whole message. The
 * optimistic bubble shows the server copies; offline queueing and errors as `sendQueued`.
 */
export function sendAttachments(
  chatId: ID,
  files: { media: MediaAttachment; description?: string | null }[],
  lead: AttachmentLead = {},
): Promise<Message | null> {
  const ordered = [
    ...files.filter((f) => isVisualFile(f.media)),
    ...files.filter((f) => !isVisualFile(f.media)),
  ];
  const [first, ...rest] = ordered;
  if (!first) return Promise.resolve(null);
  const alt = ordered.map((f) => f.description?.trim() || null);
  const described = alt.some((d) => d !== null);
  const req: SendInput = {
    type: first.media.kind,
    mediaId: first.media.id,
    ...(rest.length ? { extraMediaIds: rest.map((f) => f.media.id) } : {}),
    ...(described ? { descriptions: alt } : {}),
    text: lead.caption?.trim() || undefined,
    replyToId: lead.replyToId,
    ...(lead.mentionRepliedAuthor === false ? { mentionRepliedAuthor: false } : {}),
    ...(lead.silent ? { silent: true } : {}),
  };
  // Like the server: `attachments` only for several files or some alt text.
  const attachments: MessageAttachment[] | undefined =
    rest.length || described
      ? ordered.map((f, i) => ({ ...f.media, description: alt[i] ?? null }))
      : undefined;
  return sendQueued(chatId, req, {
    optimistic: {
      media: first.media,
      ...(attachments ? { attachments } : {}),
      replyTo: lead.replyTo ?? null,
    },
  });
}
