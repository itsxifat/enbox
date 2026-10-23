/**
 * Under a message of mine in an announcement channel: a "Publish" pill until it is published
 * (Discord's inline button), then a small "Published" check for a moment. Others' messages
 * are published from the message menu (MANAGE_MESSAGES).
 */
import { useState } from 'react';
import { CircleCheck, Megaphone } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { canPublish, isAnnouncementChannel, publishMessage, usePublished } from './actions';

export function PublishPill({ chat, m }: { chat: ChatSummary; m: ClientMessage }) {
  // Hooks live below: a channel converted while the row is mounted swaps the component.
  return isAnnouncementChannel(chat) ? <Pill chat={chat} m={m} /> : null;
}

function Pill({ chat, m }: { chat: ChatSummary; m: ClientMessage }) {
  const me = useAuth((s) => s.user?.id ?? null);
  const justPublished = usePublished((s) => !!s.ids[m.id]);
  const [busy, setBusy] = useState(false);
  if (justPublished)
    return (
      <span
        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-success"
        data-testid="published-hint"
      >
        <CircleCheck size={14} aria-hidden />
        Published
      </span>
    );
  if (!me || m.senderId !== me || !canPublish(chat, m, me)) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void publishMessage(chat, m).finally(() => setBusy(false));
      }}
      className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-semibold text-fg transition-colors hover:bg-brand-soft hover:text-brand-ink disabled:opacity-60"
      data-testid="publish-pill"
    >
      <Megaphone size={14} aria-hidden />
      Publish
    </button>
  );
}
