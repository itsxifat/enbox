/**
 * A `#{id}` channel mention in message text: a "#name" pill with the channel type's icon that
 * opens the channel (or the thread or post beside its parent); "#unknown" for a channel I
 * can't see. `plain` (inside a link): the pill's look without its own link.
 */
import { memo } from 'react';
import { Hash } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';
import { useChats } from '@/stores/chats';
import { isPlainClick } from '../bubbles/cards/internalLinks';
import { channelMentionTarget } from './target';

const PILL =
  'inline-flex items-baseline gap-0.5 rounded-[3px] bg-brand/20 px-0.5 font-medium text-brand-ink [&>svg]:self-center';

export const ChannelMention = memo(function ChannelMention({
  chatId,
  plain = false,
}: {
  chatId: ID;
  plain?: boolean;
}) {
  const chat = useChats((s) => s.byId[chatId]);
  const parent = useChats((s) => (chat?.thread ? s.byId[chat.thread.parentId] : undefined));
  const target = channelMentionTarget(chat, parent);
  if (!target || plain) {
    const Icon = target?.icon ?? Hash;
    return (
      <span className={PILL} data-channel-mention={target ? chatId : 'unknown'}>
        <Icon size={14} aria-hidden />
        {target?.name ?? 'unknown'}
      </span>
    );
  }
  const Icon = target.icon;
  return (
    <a
      href={target.path}
      data-channel-mention={chatId}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPlainClick(e)) return;
        e.preventDefault();
        bus.emit('navigate', { to: target.path });
      }}
      className={cn(PILL, 'hover:bg-brand hover:text-on-brand focus-visible:outline-2 focus-visible:outline-brand')}
    >
      <Icon size={14} aria-hidden />
      {target.name}
    </a>
  );
});
