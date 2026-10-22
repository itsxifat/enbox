import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MessageCircle, MoreVertical, Users } from 'lucide-react';
import { activePresenceNote, userDisplayName, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StyledName } from '@/components/cosmetics';
import { Button, EmptyState, IconButton, Input, Menu, SearchInput, toast, type MenuAnchor } from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { openProfile } from '@/features/profile/open';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useBlockedUsers, useContactList, useContacts } from '@/stores/contacts';
import { useUsers } from '@/stores/users';

type Tab = 'online' | 'all' | 'blocked' | 'add';

const STATE_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' } as const;

function statusLine(user: UserPublic, state: keyof typeof STATE_LABEL): string {
  const note = activePresenceNote(user.presenceNote ?? null, Date.now());
  return note ? [note.emoji, note.text].filter(Boolean).join(' ') : STATE_LABEL[state];
}

export function FriendRow({
  user,
  state,
  blocked,
  onMenu,
}: {
  user: UserPublic;
  state: keyof typeof STATE_LABEL;
  blocked?: boolean;
  onMenu: (u: UserPublic, anchor: MenuAnchor) => void;
}) {
  const navigate = useNavigate();
  const message = async () => {
    try {
      const chat = await ensureDirectChat(user.id);
      void navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="group/friend mx-3 flex h-[62px] items-center gap-3 rounded-lg border-t border-line px-3 first:border-transparent hover:border-transparent hover:bg-hover lg:mx-5" data-testid="friend-row" data-animate-avatars>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={(e) => openProfile(user.id, e.currentTarget)}>
        <UserAvatar user={user} size="md" showPresence />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-baseline gap-1.5">
            <StyledName name={userDisplayName(user)} style={user.nameStyle} mode="full" className="truncate text-[16px] font-semibold text-fg" />
            <span className="hidden truncate text-[14px] text-muted group-hover/friend:inline">{user.username}</span>
          </span>
          <span className="block truncate text-[13px] text-muted">{blocked ? 'Blocked' : statusLine(user, state)}</span>
        </span>
      </button>
      {blocked ? null : (
        <IconButton icon={MessageCircle} label={`Message ${userDisplayName(user)}`} variant="solid" className="rounded-full" onClick={() => void message()} />
      )}
      <IconButton icon={MoreVertical} label="More" variant="solid" className="rounded-full" onClick={(e) => onMenu(user, e.currentTarget)} />
    </div>
  );
}

function AddFriend() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const username = value.trim().replace(/^@/, '');
    if (!username) return;
    setBusy(true);
    setResult(null);
    try {
      await useContacts.getState().addContact({ username });
      setResult({ ok: true, text: `Success! ${username} is now in your friends list.` });
      setValue('');
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err, "Hm, didn't work. Double-check that the username is correct.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-5 py-5 lg:px-8">
      <h2 className="text-[16px] font-bold text-fg uppercase">Add friend</h2>
      <p className="mt-1 text-[14px] text-muted">You can add friends with their Enbox username.</p>
      <form onSubmit={(e) => void submit(e)} className={cn('mt-4 flex items-center gap-2 rounded-xl border bg-surface-2 p-2', result ? (result.ok ? 'border-success' : 'border-danger') : 'border-line focus-within:border-brand')}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="You can add friends with their Enbox username."
          aria-label="Username"
          className="flex-1 border-0 bg-transparent shadow-none"
          autoFocus
          data-testid="add-friend-input"
        />
        <Button type="submit" size="sm" loading={busy} disabled={!value.trim()}>
          Send Friend Request
        </Button>
      </form>
      {result ? <p className={cn('mt-2 text-[14px]', result.ok ? 'text-success' : 'text-danger')}>{result.text}</p> : null}
    </div>
  );
}

/**
 * Home main view (Discord's Friends page): Online / All / Blocked / Add Friend over my
 * contacts with live presence, a message button and a menu per row.
 */
export function FriendsPage() {
  const [tab, setTab] = useState<Tab>('online');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ user: UserPublic; anchor: MenuAnchor } | null>(null);
  const { items, loaded } = useContactList();
  const blocked = useBlockedUsers();
  const presence = useUsers((s) => s.presence);

  // Presence for every friend while the page is open (batched, rate-limited by the store).
  const ids = useMemo(() => items.map((i) => i.user.id), [items]);
  useEffect(() => {
    if (!ids.length) return;
    const { subscribePresence, unsubscribePresence } = useUsers.getState();
    void subscribePresence(ids);
    return () => unsubscribePresence(ids);
  }, [ids]);

  const stateOf = (u: UserPublic): keyof typeof STATE_LABEL => {
    const p = presence[u.id];
    if (!p) return 'offline';
    return p.state ?? (p.online ? 'online' : 'offline');
  };
  const q = query.trim().toLowerCase();
  const match = (u: UserPublic) => !q || userDisplayName(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  const users =
    tab === 'blocked'
      ? blocked.users.filter(match)
      : items.map((i) => i.user).filter((u) => match(u) && (tab !== 'online' || stateOf(u) !== 'offline'));

  const tabs: { id: Tab; label: string }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'All' },
    { id: 'blocked', label: 'Blocked' },
  ];
  const heading = tab === 'online' ? 'Online' : tab === 'all' ? 'All friends' : 'Blocked';

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="friends-page">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Users size={22} className="text-muted" aria-hidden />
        <h1 className="mr-2 text-[16px] font-semibold text-fg">Friends</h1>
        <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
        <div role="tablist" aria-label="Friends" className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn('rounded-md px-2.5 py-1 text-[15px] font-medium', tab === t.id ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'add'}
            onClick={() => setTab('add')}
            className={cn('ml-1 rounded-md px-2.5 py-1 text-[15px] font-medium', tab === 'add' ? 'bg-transparent text-success' : 'bg-success text-white hover:bg-success/90')}
            data-testid="add-friend-tab"
          >
            Add Friend
          </button>
        </div>
      </header>
      {tab === 'add' ? (
        <AddFriend />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <div className="px-5 lg:px-8">
            <SearchInput value={query} onChange={setQuery} placeholder="Search" aria-label="Search friends" />
          </div>
          <h2 className="mt-5 mb-2 px-5 text-[12px] font-semibold tracking-wide text-muted uppercase lg:px-8">
            {heading} — {users.length}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
            {!loaded && tab !== 'blocked' ? null : users.length ? (
              users.map((u) => <FriendRow key={u.id} user={u} state={stateOf(u)} blocked={tab === 'blocked'} onMenu={(user, anchor) => setMenu({ user, anchor })} />)
            ) : (
              <EmptyState
                icon={Users}
                title={tab === 'online' ? 'No one’s around right now' : tab === 'blocked' ? 'You haven’t blocked anyone' : 'No friends yet'}
                description={tab === 'blocked' ? 'People you block show up here.' : 'Add a friend with their username to get started.'}
                action={tab === 'blocked' ? undefined : <Button onClick={() => setTab('add')}>Add Friend</Button>}
              />
            )}
          </div>
        </div>
      )}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        aria-label="Friend actions"
        items={
          menu
            ? tab === 'blocked'
              ? [{ label: 'Unblock', onSelect: () => void useContacts.getState().unblock(menu.user.id).catch((e: unknown) => toast.error(e)) }]
              : [
                  { label: 'View profile', onSelect: () => openProfile(menu.user.id, menu.anchor) },
                  'separator',
                  { label: 'Remove Friend', danger: true, onSelect: () => void useContacts.getState().removeContact(menu.user.id).catch((e: unknown) => toast.error(e)) },
                  { label: 'Block', danger: true, onSelect: () => void useContacts.getState().block(menu.user.id).catch((e: unknown) => toast.error(e)) },
                ]
            : []
        }
      />
    </div>
  );
}
