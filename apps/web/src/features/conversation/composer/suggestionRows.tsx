/** Rows of the "#channel" and ":emoji:" lists (SuggestionList). */
import {
  Hash,
  Images,
  Megaphone,
  MessagesSquare,
  Podcast,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { CustomEmoji } from '@/components/emoji/CustomEmoji';
import type { ChannelSuggestion } from './channelMentions';
import type { EmojiSuggestion } from './emojiSuggestions';
import type { SuggestionRow } from './SuggestionList';

/** The sidebar's icon of a channel. */
export function channelIcon(chat: Pick<ChatSummary, 'type' | 'space'>): LucideIcon {
  if (chat.type === 'space_stage') return Podcast;
  if (chat.type === 'space_voice') return Volume2;
  if (chat.type === 'space_forum')
    return chat.space?.forum?.settings.media ? Images : MessagesSquare;
  return chat.space?.isNews ? Megaphone : Hash;
}

export function channelRows(items: ChannelSuggestion[]): SuggestionRow[] {
  return items.map(({ chat, category }) => {
    const Icon = channelIcon(chat);
    return {
      key: chat.id,
      icon: <Icon size={18} />,
      label: chat.name,
      sub: category,
    };
  });
}

export function emojiRows(items: EmojiSuggestion[]): SuggestionRow[] {
  return items.map((s) => ({
    key: s.key,
    icon: s.custom ? (
      <CustomEmoji id={s.custom.id} name={s.custom.name} animated={s.custom.animated} size={22} />
    ) : (
      <span className="text-[20px] leading-none">{s.emoji}</span>
    ),
    label: `:${s.name}:`,
    sub: s.spaceName,
  }));
}
