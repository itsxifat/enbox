/** @mention suggestions above the composer (group members). */
import { userDisplayName, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/cn';

export function MentionSuggestions({
  users,
  active,
  onPick,
  onHover,
  id,
}: {
  users: UserPublic[];
  active: number;
  onPick: (u: UserPublic) => void;
  onHover: (i: number) => void;
  id: string;
}) {
  if (!users.length) return null;
  return (
    <div className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-2xl border border-line bg-elevated shadow-elevated sm:inset-x-3">
      <ul
        id={id}
        role="listbox"
        aria-label="Mention someone"
        className="max-h-64 overflow-y-auto py-1 scrollbar-thin"
      >
        {users.map((u, i) => (
          <li
            key={u.id}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(u);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              'flex cursor-pointer items-center gap-3 px-3 py-2',
              i === active && 'bg-hover',
            )}
          >
            <UserAvatar user={u} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[15px] text-fg">
              {userDisplayName(u)}
            </span>
            <span className="shrink-0 text-[13px] text-subtle">@{u.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
