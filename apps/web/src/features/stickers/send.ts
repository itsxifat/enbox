/**
 * Send a sticker (`{ type: 'sticker', stickerId }`) through the normal send path (the outbox:
 * offline queueing, error toasts). The optimistic bubble already shows it: an `image`
 * message whose media is the sticker's picture, with `Message.sticker` set (the store maps
 * the type; the server answers with the same shape).
 */
import type { ID, MediaAttachment, Message, MessagePreview, SpaceSticker } from '@enbox/shared';
import { sendQueued } from '@/features/conversation/lib/outbox';

export interface StickerSendOptions {
  replyToId?: ID;
  /** The quoted message for the optimistic bubble. */
  replyTo?: MessagePreview | null;
  /** Groups and Space channels: `false` = the reply doesn't ping its author ("@ OFF"). */
  mentionRepliedAuthor?: boolean;
}

/** The sticker's picture as optimistic media (the server's media row replaces it). */
export function stickerMedia(sticker: SpaceSticker): MediaAttachment {
  const ext = sticker.url.split('?')[0]!.split('.').pop()?.toLowerCase();
  return {
    id: `sticker:${sticker.id}`,
    kind: 'image',
    url: sticker.url,
    thumbnailUrl: null,
    mimeType: ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png',
    fileName: `${sticker.name}.${ext ?? 'png'}`,
    size: 0,
    width: null,
    height: null,
    animated: sticker.animated,
    frameCount: null,
    durationMs: null,
    waveform: null,
  };
}

export function sendSticker(
  chatId: ID,
  sticker: SpaceSticker,
  opts: StickerSendOptions = {},
): Promise<Message | null> {
  return sendQueued(
    chatId,
    {
      type: 'sticker',
      stickerId: sticker.id,
      ...(opts.replyToId ? { replyToId: opts.replyToId } : {}),
      ...(opts.mentionRepliedAuthor === false ? { mentionRepliedAuthor: false } : {}),
    },
    {
      optimistic: {
        media: stickerMedia(sticker),
        sticker: { id: sticker.id, name: sticker.name, spaceId: sticker.spaceId },
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      },
    },
  );
}
