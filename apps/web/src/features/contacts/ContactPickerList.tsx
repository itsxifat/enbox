import { useMemo, useState } from 'react';
import { Check, Contact as ContactIcon } from 'lucide-react';
import { userDisplayName, type ID, type UserPublic } from '@enbox/shared';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { EmptyState, ListItemSkeleton, SearchInput } from '@/components/ui';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/cn';
import { matchesUser, useContactList } from '@/stores/contacts';

export interface ContactPickerListProps {
  /** Multi-select with round checkboxes (default) or single tap. */
  mode?: 'multi' | 'single';
  selected?: ReadonlySet<ID>;
  onToggle: (user: UserPublic, selected: boolean) => void;
  /** Hide some users (e.g. already blocked). */
  exclude?: ReadonlySet<ID>;
  emptyText?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Searchable list of my contacts with checkboxes (status privacy, block picker…). */
export function ContactPickerList({
  mode = 'multi',
  selected,
  onToggle,
  exclude,
  emptyText = 'Contacts you save appear here.',
  className,
  autoFocus,
}: ContactPickerListProps) {
  const { items, loaded, error } = useContactList();
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      items
        .filter((c) => !exclude?.has(c.user.id) && matchesUser(c.user, query))
        .map((c) => c.user),
    [items, exclude, query],
  );

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="px-3 pt-1 pb-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search contacts"
          autoFocus={autoFocus}
          aria-label="Search contacts"
        />
      </div>
      {!loaded ? (
        error ? (
          <EmptyState
            compact
            icon={ContactIcon}
            title="Couldn't load contacts"
            description={error}
          />
        ) : (
          <ListItemSkeleton count={5} />
        )
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={ContactIcon}
          title={query ? 'No matching contacts' : 'No contacts yet'}
          description={query ? `Nothing matches “${query}”.` : emptyText}
        />
      ) : (
        <ul aria-label="Contacts" className="flex flex-col">
          {visible.map((u) => {
            const isSel = !!selected?.has(u.id);
            const row = (
              <>
                <UserAvatar user={u} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15.5px] text-fg">{userDisplayName(u)}</span>
                  <span className="truncate text-[13px] text-muted">
                    {u.about || `@${u.username}`}
                  </span>
                </span>
              </>
            );
            return (
              <li key={u.id}>
                {mode === 'multi' ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSel}
                    onClick={() => onToggle(u, !isSel)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    {row}
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        isSel ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
                      )}
                      aria-hidden
                    >
                      {isSel ? <Check size={14} strokeWidth={ICON_STROKE_BOLD} /> : null}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggle(u, true)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    {row}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
