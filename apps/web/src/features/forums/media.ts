/**
 * Media channels: forums whose settings say `media` (every post leads with a picture or a
 * video, shown as a grid of tiles) and may hide the viewer's download buttons.
 */
import type { ChatSummary, ID, MediaAttachment, Message, MessageAttachment } from '@enbox/shared';
import { visualFiles } from '@/features/conversation/bubbles/attachments';
import { mediaUrl } from '@/lib/api';
import { useChats } from '@/stores/chats';

/** Whether a forum is a media channel. */
export function isMediaForum(forum: Pick<ChatSummary, 'space'> | undefined): boolean {
  return !!forum?.space?.forum?.settings.media;
}

/** The picture or video a post leads with (its first message's first one). */
export function postCover(first: Message | null): MessageAttachment | null {
  if (!first || first.deletedAt) return null;
  return visualFiles(first)[0] ?? null;
}

/** What a cover shows: a picture's thumbnail or itself, a video's poster (none: no picture). */
export function coverSrc(
  cover: Pick<MediaAttachment, 'kind' | 'url' | 'thumbnailUrl'> | null,
): string | undefined {
  if (!cover) return undefined;
  return mediaUrl(cover.thumbnailUrl ?? (cover.kind === 'image' ? cover.url : null));
}

/** A post's first file: what its card's Download saves. */
export function postFile(first: Message | null): MediaAttachment | null {
  if (!first || first.deletedAt || first.sticker) return null;
  return first.attachments?.[0] ?? first.media ?? null;
}

/**
 * Whether the media viewer of `chatId` hides its download button: a post of a forum that
 * hides downloads (a courtesy, not protection).
 */
export function useHideDownloads(chatId: ID | undefined): boolean {
  return useChats((s) => {
    const parentId = chatId ? s.byId[chatId]?.thread?.parentId : undefined;
    return !!parentId && !!s.byId[parentId]?.space?.forum?.settings.hideDownloads;
  });
}

/** Save a file (the browser's download, under its own name). */
export function downloadFile(file: Pick<MediaAttachment, 'url' | 'fileName' | 'kind'>): void {
  const a = document.createElement('a');
  a.href = mediaUrl(file.url) ?? '';
  a.download = file.fileName ?? file.kind;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
