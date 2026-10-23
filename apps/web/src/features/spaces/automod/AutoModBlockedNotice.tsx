/**
 * The composer's notice for a send AutoMod blocked (blocked.ts): Discord's ephemeral system
 * message — the Space's explanation, what I wrote (to copy it back), "Only you can see this ·
 * Dismiss message".
 */
import { ShieldAlert } from 'lucide-react';
import { renderMentions, type ID } from '@enbox/shared';
import { nameOf, useUsers } from '@/stores/users';
import { useAutoModNotices } from './blocked';

export function AutoModBlockedNotice({ chatId }: { chatId: ID }) {
  const notice = useAutoModNotices((s) => s.byChat[chatId]);
  // Re-render when the names of mentioned people arrive.
  useUsers((s) => s.byId);
  if (!notice) return null;
  const text = notice.text ? renderMentions(notice.text, (id) => nameOf(id)) : null;
  return (
    <div
      role="status"
      className="mb-2 flex items-start gap-3 rounded-lg bg-danger-soft px-3 py-2.5 animate-slide-down"
      data-testid="automod-blocked-notice"
    >
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
        <p className="font-semibold text-fg">Your message was blocked</p>
        <p className="text-muted">{notice.message}</p>
        {text ? (
          <p className="mt-1.5 line-clamp-3 rounded-md bg-surface px-2 py-1 break-words whitespace-pre-wrap text-fg select-text">
            {text}
          </p>
        ) : null}
        <p className="mt-1.5 text-[12px] text-subtle">
          Only you can see this ·{' '}
          <button
            type="button"
            className="font-medium text-link hover:underline"
            onClick={() => useAutoModNotices.getState().dismiss(chatId)}
          >
            Dismiss message
          </button>
        </p>
      </div>
    </div>
  );
}
