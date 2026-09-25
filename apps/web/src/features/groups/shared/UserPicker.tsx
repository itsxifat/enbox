/**
 * Multi-select people picker (new group, add members, community members): selected chips on
 * top, a search box, then contacts / recent chats / search results with round checkboxes.
 */
import { useRef, type ReactNode } from 'react';
import { Check, SearchX, UserRoundSearch, X } from 'lucide-react';
import { userDisplayName, type ID, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { EmptyState, ListItemSkeleton, SearchInput, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { isRemoteQuery, useCandidates } from './candidates';

export interface UserPickerProps {
  selected: UserPublic[];
  onToggle: (user: UserPublic) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** Users that can't be picked, with the reason shown instead of their about. */
  disabled?: Map<ID, string>;
  /** Extra content above the list (e.g. an "Invite via link" row). */
  header?: ReactNode;
  autoFocus?: boolean;
}

export function UserPicker({
  selected,
  onToggle,
  query,
  onQueryChange,
  disabled,
  header,
  autoFocus,
}: UserPickerProps) {
  const { sections, loading, searching } = useCandidates(query);
  const selectedIds = new Set(selected.map((u) => u.id));
  const searchRef = useRef<HTMLInputElement>(null);
  const empty = !loading && sections.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selected.length ? (
        <div
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 pt-3 pb-2 scrollbar-none"
          aria-label="Selected people"
          role="list"
        >
          {selected.map((u) => (
            <div key={u.id} role="listitem" className="animate-pop">
              <button
                type="button"
                onClick={() => {
                  onToggle(u);
                  searchRef.current?.focus();
                }}
                className="group flex w-[68px] flex-col items-center gap-1 rounded-xl py-1 outline-none focus-visible:outline-2 focus-visible:outline-brand"
                aria-label={`Remove ${userDisplayName(u)}`}
              >
                <span className="relative">
                  <UserAvatar user={u} size="lg" />
                  <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-subtle text-surface ring-2 ring-surface transition-colors group-hover:bg-danger group-hover:text-white">
                    <X size={12} strokeWidth={3} aria-hidden />
                  </span>
                </span>
                <span className="w-full truncate text-center text-[12px] text-muted">
                  {userDisplayName(u).split(' ')[0]}
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="shrink-0 px-3 py-2">
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={onQueryChange}
          placeholder="Search name, username or phone"
          aria-label="Search people"
          autoFocus={autoFocus}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-24 scrollbar-thin">
        {header}
        {loading ? (
          <ListItemSkeleton count={6} />
        ) : empty ? (
          query.trim() ? (
            searching ? (
              <div className="flex justify-center p-8 text-brand-ink">
                <Spinner />
              </div>
            ) : (
              <EmptyState
                compact
                icon={SearchX}
                title="No results"
                description={
                  isRemoteQuery(query)
                    ? `No one matches “${query.trim()}”.`
                    : 'Type at least 3 characters of a username, or a full phone number, to find people on Enbox.'
                }
              />
            )
          ) : (
            <EmptyState
              compact
              icon={UserRoundSearch}
              title="Find people"
              description="Search by username or phone number to add people who aren't in your contacts yet."
            />
          )
        ) : (
          sections.map((section) => (
            <section key={section.id} aria-label={section.title}>
              <h3 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-brand-ink">
                {section.title}
              </h3>
              <ul>
                {section.users.map((u) => {
                  const reason = disabled?.get(u.id);
                  const checked = selectedIds.has(u.id);
                  return (
                    <li key={u.id}>
                      <PickerRow
                        user={u}
                        checked={checked || !!reason}
                        disabledReason={reason}
                        onToggle={() => onToggle(u)}
                      />
                    </li>
                  );
                })}
              </ul>
              {section.id === 'search' && searching ? (
                <div className="flex justify-center py-3 text-brand-ink">
                  <Spinner size={18} />
                </div>
              ) : null}
            </section>
          ))
        )}
        {!empty && searching && !sections.some((s) => s.id === 'search') ? (
          <div className="flex justify-center py-3 text-brand-ink">
            <Spinner size={18} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PickerRow({
  user,
  checked,
  disabledReason,
  onToggle,
}: {
  user: UserPublic;
  checked: boolean;
  disabledReason?: string;
  onToggle: () => void;
}) {
  const name = userDisplayName(user);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={!!disabledReason || undefined}
      aria-label={name}
      onClick={() => {
        if (!disabledReason) onToggle();
      }}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2 text-left outline-none transition-colors',
        'focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        disabledReason ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-hover',
      )}
    >
      <UserAvatar user={user} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15.5px] font-medium text-fg">{name}</span>
        <span className="truncate text-[13px] text-muted">
          {disabledReason ?? (user.about || `@${user.username}`)}
        </span>
      </span>
      <RoundCheck checked={checked} />
    </button>
  );
}

export function RoundCheck({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150',
        checked ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
      )}
    >
      {checked ? <Check size={14} strokeWidth={3} className="animate-pop" /> : null}
    </span>
  );
}
