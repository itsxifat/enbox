/** Shared rules for file uploads in a conversation (drop overlay, composer tray). */
import {
  isVoiceChannelType,
  MAX_ATTACHMENTS_PER_MESSAGE,
  PERM,
  chatTitle,
  hasPerm,
  type ChatSummary,
} from '@enbox/shared';

export const NO_UPLOAD_PERMISSION = 'You do not have permission to upload files here';

/** Files per send: they all go in one message. */
export const MAX_ATTACHMENTS = MAX_ATTACHMENTS_PER_MESSAGE;

export const TOO_MANY_ATTACHMENTS = `You can only upload ${MAX_ATTACHMENTS} files at a time`;

/** Whether the viewer may attach files here (Space channels: the computed ATTACH_FILES bit). */
export function canAttachFiles(chat: Pick<ChatSummary, 'space' | 'spacePermissions'>): boolean {
  return !chat.space || hasPerm(chat.spacePermissions, PERM.ATTACH_FILES);
}

/** The drag carries files from the OS (not text, a link or an element of the page). */
export function dragHasFiles(e: Pick<DragEvent, 'dataTransfer'>): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

/** "#general", "@Maya" or the group's name, as the composer placeholder names the chat. */
export function uploadTargetLabel(
  chat: Pick<ChatSummary, 'space' | 'type' | 'name' | 'peer'>,
): string {
  if (chat.space) return `${isVoiceChannelType(chat.type) ? '🔊 ' : '#'}${chat.name ?? 'channel'}`;
  if (chat.type === 'direct') return `@${chatTitle(chat)}`;
  return chatTitle(chat);
}

/** Files marked as spoilers carry this prefix in their name (blurred until clicked). */
export const SPOILER_PREFIX = 'SPOILER_';

export function isSpoilerName(name: string | null | undefined): boolean {
  return !!name && name.startsWith(SPOILER_PREFIX);
}
