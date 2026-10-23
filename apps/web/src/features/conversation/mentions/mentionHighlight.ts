/**
 * Discord's highlight of a message that mentions me: me by name (a reply's ping too), one of
 * my roles in a Space, @everyone / @here where they reach me (`mentionsMe`, the server's
 * mention counts). Never my own messages, deleted ones or system rows.
 */
import type { ChatSummary } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { mentionsMe, useSpaces } from '@/stores/spaces';

/**
 * The row's tint and its left accent bar (index.css `--mention-bg` / `--mention-bar`); on hover
 * the usual hover shade over the tint (an inset shadow, so no second background competes).
 */
export const MENTION_ROW_CLASS =
  'bg-mention-bg hover:shadow-[inset_0_0_0_100vmax_var(--hover)] before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-mention-bar';

export function useMentionsMe(m: ClientMessage, chat: ChatSummary, mine: boolean): boolean {
  const me = useAuth((s) => s.user?.id);
  const candidate = !!me && !mine && !m.deletedAt && m.type !== 'system';
  // A Space's roles and my mention settings live in its store: follow them.
  return useSpaces(() => candidate && mentionsMe(m, chat, me!));
}
