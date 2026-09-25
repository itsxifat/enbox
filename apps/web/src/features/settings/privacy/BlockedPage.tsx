import { useMemo, useState } from 'react';
import { ShieldBan, UserRoundPlus } from 'lucide-react';
import { userDisplayName, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, EmptyState, ListItemSkeleton, Modal, Spinner } from '@/components/ui';
import { ContactPickerList } from '@/features/contacts/ContactPickerList';
import { confirmBlock, confirmUnblock } from '@/features/contacts/contactActions';
import { useBlockedUsers } from '@/stores/contacts';
import { SettingsGroup, SettingsNote, SettingsScroller } from '../ui';

/** Settings → Privacy → Blocked contacts. */
export function BlockedPage() {
  const { users, loaded } = useBlockedUsers();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const exclude = useMemo(() => new Set(users.map((u) => u.id)), [users]);

  const unblock = async (u: UserPublic) => {
    setBusy(u.id);
    await confirmUnblock(u);
    setBusy(null);
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title={loaded ? `Blocked (${users.length})` : 'Blocked'}
        footer="Blocked contacts can't call you or send you messages. Tap a contact to unblock them."
      >
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex min-h-14 w-full items-center gap-4 px-4 py-3 text-left outline-none hover:bg-hover focus-visible:bg-hover lg:px-5"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <UserRoundPlus size={20} aria-hidden />
          </span>
          <span className="text-[16px] text-brand-ink">Block a contact</span>
        </button>
        {!loaded ? (
          <ListItemSkeleton count={2} />
        ) : users.length === 0 ? (
          <EmptyState
            compact
            icon={ShieldBan}
            title="No blocked contacts"
            description="People you block will be listed here."
          />
        ) : (
          <ul aria-label="Blocked contacts" data-testid="blocked-list">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => void unblock(u)}
                  disabled={busy === u.id}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover lg:px-5"
                  aria-label={`Unblock ${userDisplayName(u)}`}
                >
                  <UserAvatar user={u} size="md" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15.5px] text-fg">{userDisplayName(u)}</span>
                    <span className="truncate text-[13px] text-muted">@{u.username}</span>
                  </span>
                  {busy === u.id ? (
                    <Spinner size={16} label={null} />
                  ) : (
                    <span className="text-[13px] font-semibold text-brand-ink">Unblock</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>
      <SettingsNote>You can also block someone from their contact info in a chat.</SettingsNote>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Block a contact"
        size="md"
        bodyClassName="px-0 py-0"
      >
        <div className="max-h-[60dvh] overflow-y-auto pb-3 scrollbar-thin">
          <ContactPickerList
            mode="single"
            exclude={exclude}
            autoFocus
            emptyText="Only saved contacts can be picked here."
            onToggle={(u) => {
              setPicking(false);
              void confirmBlock(u);
            }}
          />
        </div>
        <div className="flex justify-end px-6 pb-4">
          <Button variant="ghost" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </SettingsScroller>
  );
}
