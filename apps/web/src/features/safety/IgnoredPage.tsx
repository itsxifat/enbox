/**
 * Settings ▸ Privacy ▸ Ignored users: everyone I ignore (newest first), searchable, each with
 * Unignore. Ignoring itself happens from a profile's ⋯ menu.
 */
import { useMemo, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { userDisplayName, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, EmptyState, ListItemSkeleton, SearchInput, toast } from '@/components/ui';
import { SettingsGroup, SettingsNote, SettingsScroller } from '@/features/settings/ui';
import { matchesUser } from '@/stores/contacts';
import { useIgnoredUsers, useIgnores } from '@/stores/ignores';

export function IgnoredPage() {
  const { users, loaded } = useIgnoredUsers();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = query.trim();
  const shown = useMemo(() => (q ? users.filter((u) => matchesUser(u, q)) : users), [users, q]);

  const unignore = async (u: UserPublic) => {
    setBusy(u.id);
    try {
      await useIgnores.getState().unignore(u.id);
      toast.success(`${userDisplayName(u)} is no longer ignored`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsScroller>
      <SettingsNote>
        Messages from people you ignore are hidden behind “Ignored message”, their typing isn’t
        shown and they don’t notify you. They aren’t told.
      </SettingsNote>
      {users.length > 0 ? (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search ignored users"
          aria-label="Search ignored users"
        />
      ) : null}
      <SettingsGroup title={loaded ? `Ignored (${users.length})` : 'Ignored'}>
        {!loaded ? (
          <ListItemSkeleton count={2} />
        ) : users.length === 0 ? (
          <EmptyState
            compact
            icon={EyeOff}
            title="No ignored users"
            description="Ignore someone from the ⋯ menu on their profile."
          />
        ) : shown.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-muted">No one matches “{q}”.</p>
        ) : (
          <ul aria-label="Ignored users" data-testid="ignored-list">
            {shown.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 lg:px-4">
                <UserAvatar user={u} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15.5px] text-fg">{userDisplayName(u)}</span>
                  <span className="truncate text-[13px] text-muted">@{u.username}</span>
                </span>
                <Button
                  size="sm"
                  variant="soft"
                  loading={busy === u.id}
                  onClick={() => void unignore(u)}
                  aria-label={`Unignore ${userDisplayName(u)}`}
                >
                  Unignore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>
    </SettingsScroller>
  );
}
