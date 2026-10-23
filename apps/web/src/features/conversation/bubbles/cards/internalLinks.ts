/**
 * Links to this app — its own origin, or the canonical public one (`publicOrigin`) — open
 * in-app with react-router instead of in a new tab, and message links and invites get a
 * card under the message. `internalLinkOf` is pure (unit-tested); `openInternalLink` acts.
 *
 *   /spaces/<spaceId>/<chatId>?m=<seq>&mid=<messageId>   a message (Copy Message Link; also
 *   /chats|starred|archived/<chatId>?m=…&mid=…           DMs and groups, and broadcast
 *   /updates/channels/<chatId>?m=…&mid=…                 channel posts)
 *   /join/<code>, /invite/<code>                         an invite (a Space's vanity code too)
 *   anything else on the origin                          a page: opened in-app, no card
 */
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, type ID } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { publicOrigin } from '@/lib/serverConfig';
import { useChats } from '@/stores/chats';
import { useConversationUi } from '../../state';

export type InternalLink =
  | { kind: 'message'; path: string; messageId: ID; chatId: ID; seq: number; spaceId: ID | null }
  | { kind: 'invite'; path: string; code: string }
  | { kind: 'page'; path: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_CODE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);
/** A Space's vanity code (`/join/my-space`). */
const VANITY_CODE = /^[a-z0-9-]{3,32}$/i;

/** The origins that are this app: the page's own and the configured public one. */
export function ownOrigins(): Set<string> {
  const out = new Set<string>();
  if (typeof window !== 'undefined') out.add(window.location.origin);
  const pub = publicOrigin();
  if (pub) {
    try {
      out.add(new URL(pub).origin);
    } catch {
      // not a URL: only the page's origin counts
    }
  }
  return out;
}

/** The in-app path (path, query and hash) of a link to this app, else null. */
export function internalPath(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !ownOrigins().has(u.origin))
    return null;
  return `${u.pathname}${u.search}${u.hash}`;
}

/** What a link to this app is (a message, an invite or another page), else null. */
export function internalLinkOf(href: string): InternalLink | null {
  const path = internalPath(href);
  if (path === null) return null;
  const u = new URL(path, 'http://app.invalid');
  const parts = u.pathname.split('/').filter(Boolean);
  if ((parts[0] === 'join' || parts[0] === 'invite') && parts.length === 2) {
    let code = parts[1]!;
    try {
      code = decodeURIComponent(code);
    } catch {
      // keep it encoded: it won't match a code
    }
    if (INVITE_CODE.test(code) || VANITY_CODE.test(code))
      return { kind: 'invite', code, path: `/join/${code}` };
  }
  const messageId = u.searchParams.get('mid');
  const seq = Number(u.searchParams.get('m'));
  if (messageId && UUID.test(messageId) && Number.isInteger(seq) && seq > 0) {
    let chatId: string | undefined;
    let spaceId: string | null = null;
    if (parts[0] === 'spaces' && parts.length === 3)
      [, spaceId, chatId] = parts as [string, string, string];
    else if (['chats', 'starred', 'archived'].includes(parts[0] ?? '') && parts.length === 2)
      chatId = parts[1];
    else if (parts[0] === 'updates' && parts[1] === 'channels' && parts.length === 3)
      chatId = parts[2];
    if (chatId && UUID.test(chatId) && (!spaceId || UUID.test(spaceId)))
      return { kind: 'message', path, messageId, chatId, seq, spaceId };
  }
  return { kind: 'page', path };
}

/**
 * Follow a link to this app: a message of the chat already open scrolls there (loading
 * around it when needed), anything else navigates in-app (the router listens on the bus).
 */
export function openInternalLink(link: InternalLink): void {
  if (link.kind === 'message' && useChats.getState().openChatId === link.chatId) {
    useConversationUi.getState().requestJump(link.chatId, link.seq, link.messageId);
    return;
  }
  bus.emit('navigate', { to: link.path });
}

/** A plain left click (no modifier, main button): links opened by it stay in the app. */
export function isPlainClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
