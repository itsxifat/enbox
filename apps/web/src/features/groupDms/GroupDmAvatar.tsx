import type { ChatSummary } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useChatMembers } from '@/features/conversation/members';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';

/**
 * A group DM's picture: its icon when it has one, else two of its other members stacked
 * (the second behind, top right; the first in front, bottom left, cut out of the pane), or the
 * group glyph while the members load.
 */
export function GroupDmAvatar({
  chat,
  size,
  className,
}: {
  chat: ChatSummary;
  /** Pixel size of the whole square. */
  size: number;
  className?: string;
}) {
  const me = useAuth((s) => s.user?.id);
  const members = useChatMembers(chat.avatarUrl ? undefined : chat);
  const others = members?.filter((m) => m.user.id !== me) ?? [];
  const pair = (others.length >= 2 ? others : (members ?? [])).slice(0, 2);
  if (chat.avatarUrl || pair.length === 0)
    return <ChatAvatar chat={chat} size={size} className={className} />;
  if (pair.length === 1)
    return <UserAvatar user={pair[0]!.user} size={size} decorated={false} className={className} />;
  const inner = Math.round(size * 0.68);
  return (
    <span
      className={cn('relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
      data-testid="group-dm-avatar"
      aria-hidden
    >
      {/* Wrappers position them: the avatar's own root is `relative`. */}
      <span className="absolute top-0 right-0 flex">
        <UserAvatar user={pair[1]!.user} size={inner} decorated={false} />
      </span>
      <span className="absolute bottom-0 left-0 flex rounded-full ring-2 ring-surface">
        <UserAvatar user={pair[0]!.user} size={inner} decorated={false} />
      </span>
    </span>
  );
}
