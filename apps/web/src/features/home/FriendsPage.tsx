import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, Inbox, MessageCircle, MoreVertical, SearchX, ShieldBan, Users, X } from 'lucide-react';
import { activePresenceNote, userDisplayName, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StyledName } from '@/components/cosmetics';
import { Badge, Button, EmptyState, IconButton, Input, Menu, SearchInput, toast, type MenuAnchor } from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { confirmBlock } from '@/features/contacts/contactActions';
import { InboxButton } from '@/features/inbox/InboxButton';
import { openProfile } from '@/features/profile/open';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { matchesUser, useBlockedUsers, useContactList, useContacts } from '@/stores/contacts';
import { useFriendRequests, useFriends, useIncomingFriendRequestCount, type PendingItem } from '@/stores/friends';
import { useUsers } from '@/stores/users';
import { acceptFriend, cancelFriendRequest, confirmRemoveFriend, ignoreFriend } from './friendActions';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';
const TABS: readonly Tab[] = ['online', 'all', 'pending', 'blocked', 'add'];
/** `?friends=<tab>` opens a tab (a friend request push or toast links to Pending). */
const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);

const STATE_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' } as const;

/** The server's answer for every username it can't send to (also our fallback text). */
const CANT_ADD = "Hm, didn't work. Double check the username.";

function statusLine(user: UserPublic, state: keyof typeof STATE_LABEL): string {
  const note = activePresenceNote(user.presenceNote ?? null, Date.now());
  return note ? [note.emoji, note.text].filter(Boolean).join(' ') : STATE_LABEL[state];
}

const ROW = 'group/friend mx-3 flex h-[62px] items-center gap-3 rounded-lg px-3 hover:bg-hover lg:mx-5';

/** Avatar, name (username on hover) and a second line; opens the profile card. */
function RowIdentity({ user, presence, sub }: { user: UserPublic; presence?: boolean; sub: ReactNode }) {
  return (
    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={(e) => openProfile(user.id, e.currentTarget)}>
      <UserAvatar user={user} size="md" showPresence={presence} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-baseline gap-1.5">
          <StyledName name={userDisplayName(user)} style={user.nameStyle} mode="full" className="truncate text-[16px] font-semibold text-fg" />
          <span className="hidden truncate text-[14px] text-muted group-hover/friend:inline">{user.username}</span>
        </span>
        <span className="block truncate text-[13px] text-muted">{sub}</span>
      </span>
    </button>
  );
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
    <div className={ROW} data-testid="friend-row" data-animate-avatars>
      <RowIdentity user={user} presence sub={blocked ? 'Blocked' : statusLine(user, state)} />
      {blocked ? null : (
        <IconButton icon={MessageCircle} label={`Message ${userDisplayName(user)}`} variant="solid" className="rounded-full" onClick={() => void message()} />
      )}
      <IconButton icon={MoreVertical} label="More" variant="solid" className="rounded-full" onClick={(e) => onMenu(user, e.currentTarget)} />
    </div>
  );
}

/** A pending request: Accept ✓ and Ignore ✕ when it is theirs, Cancel ✕ when it is mine. */
export function PendingRow({ item, direction }: { item: PendingItem; direction: 'incoming' | 'outgoing' }) {
  const { user } = item;
  const [busy, setBusy] = useState(false);
  const act = (fn: typeof acceptFriend) => async () => {
    setBusy(true);
    // The row goes away on success; it stays (and toasts) on failure.
    if (!(await fn(user))) setBusy(false);
  };
  return (
    <div className={ROW} data-testid="pending-row" data-direction={direction} data-animate-avatars>
      <RowIdentity user={user} sub={direction === 'incoming' ? 'Incoming Friend Request' : 'Outgoing Friend Request'} />
      {direction === 'incoming' ? (
        <>
          <IconButton icon={Check} label="Accept" variant="solid" className="rounded-full hover:text-success" disabled={busy} onClick={() => void act(acceptFriend)()} />
          <IconButton icon={X} label="Ignore" variant="solid" className="rounded-full hover:text-danger" disabled={busy} onClick={() => void act(ignoreFriend)()} />
        </>
      ) : (
        <IconButton icon={X} label="Cancel" variant="solid" className="rounded-full hover:text-danger" disabled={busy} onClick={() => void act(cancelFriendRequest)()} />
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mt-5 mb-2 px-5 text-[12px] font-semibold tracking-wide text-muted uppercase lg:px-8">{children}</h2>;
}

function AddFriend() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: ReactNode } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const username = value.trim().replace(/^@/, '');
    if (!username || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const status = await useFriends.getState().send({ username });
      const who = <strong className="font-semibold">{username}</strong>;
      setResult({
        ok: true,
        text: status === 'accepted' ? <>Success! You and {who} are now friends.</> : <>Success! Your friend request to {who} was sent.</>,
      });
      setValue('');
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err, CANT_ADD) });
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
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
          }}
          placeholder="You can add friends with their Enbox username."
          aria-label="Username"
          className="flex-1 border-0 bg-transparent shadow-none"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          data-testid="add-friend-input"
        />
        <Button type="submit" size="sm" loading={busy} disabled={!value.trim()}>
          Send Friend Request
        </Button>
      </form>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} className={cn('mt-2 text-[14px]', result.ok ? 'text-success' : 'text-danger')} data-testid="add-friend-result">
          {result.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Home main view (Discord's Friends page): Online / All / Pending / Blocked / Add Friend. Friends
 * are my contacts, with live presence, a message button and a menu per row; Pending lists the
 * requests both ways. Every list has a search box and a "NAME — N" header.
 */
export function FriendsPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('friends');
  const [tab, setTab] = useState<Tab>(() => (isTab(asked) ? asked : 'online'));
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ user: UserPublic; anchor: MenuAnchor } | null>(null);
  const { items, loaded } = useContactList();
  const blocked = useBlockedUsers();
  const requests = useFriendRequests();
  const pendingCount = useIncomingFriendRequestCount();
  const presence = useUsers((s) => s.presence);

  // `?friends=pending` (a push or a toast) switches tabs, then leaves the URL.
  useEffect(() => {
    if (!isTab(asked)) return;
    setTab(asked);
    setQuery('');
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('friends');
        return next;
      },
      { replace: true },
    );
  }, [asked, setParams]);

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
  const match = (u: UserPublic) => matchesUser(u, query);
  const select = (t: Tab) => {
    setTab(t);
    setQuery('');
  };
  const openMenu = (user: UserPublic, anchor: MenuAnchor) => setMenu({ user, anchor });

  const tabs: { id: Exclude<Tab, 'add'>; label: string }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'blocked', label: 'Blocked' },
  ];

  const addAction = <Button onClick={() => select('add')}>Add Friend</Button>;
  const nobodyFound = <EmptyState icon={SearchX} title="No one with that name" description="We looked, but couldn’t find anyone with that name." />;

  let body: ReactNode;
  if (tab === 'pending') {
    const incoming = requests.incoming.filter((r) => match(r.user));
    const outgoing = requests.outgoing.filter((r) => match(r.user));
    body = !requests.loaded ? null : incoming.length || outgoing.length ? (
      <>
        {incoming.length ? (
          <section aria-label="Incoming friend requests">
            <SectionHeading>Incoming — {incoming.length}</SectionHeading>
            {incoming.map((r) => <PendingRow key={r.user.id} item={r} direction="incoming" />)}
          </section>
        ) : null}
        {outgoing.length ? (
          <section aria-label="Sent friend requests">
            <SectionHeading>Sent — {outgoing.length}</SectionHeading>
            {outgoing.map((r) => <PendingRow key={r.user.id} item={r} direction="outgoing" />)}
          </section>
        ) : null}
      </>
    ) : query.trim() && (requests.incoming.length || requests.outgoing.length) ? (
      nobodyFound
    ) : (
      <EmptyState icon={Inbox} title="No pending friend requests" description="Friend requests you send or receive show up here." action={addAction} />
    );
  } else if (tab !== 'add') {
    const all = tab === 'blocked' ? blocked.users : items.map((i) => i.user);
    const users = all.filter((u) => match(u) && (tab !== 'online' || stateOf(u) !== 'offline'));
    const heading = tab === 'online' ? 'Online' : tab === 'all' ? 'All friends' : 'Blocked';
    const ready = tab === 'blocked' ? blocked.loaded : loaded;
    body = !ready ? null : users.length ? (
      <>
        <SectionHeading>
          {heading} — {users.length}
        </SectionHeading>
        {users.map((u) => <FriendRow key={u.id} user={u} state={stateOf(u)} blocked={tab === 'blocked'} onMenu={openMenu} />)}
      </>
    ) : query.trim() && all.length ? (
      nobodyFound
    ) : tab === 'blocked' ? (
      <EmptyState icon={ShieldBan} title="You haven’t blocked anyone" description="People you block show up here." />
    ) : tab === 'online' && all.length ? (
      <EmptyState icon={Users} title="No one’s around right now" description="Friends who are online show up here." action={addAction} />
    ) : (
      <EmptyState icon={Users} title="No friends yet" description="Add a friend with their username to get started." action={addAction} />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="friends-page">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Users size={22} className="text-muted" aria-hidden />
        <h1 className="text-[16px] font-semibold text-fg">Friends</h1>
        <span className="mx-1 size-1 rounded-full bg-subtle" aria-hidden />
        <div role="tablist" aria-label="Friends" className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => select(t.id)}
              className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[15px] font-medium', tab === t.id ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
              data-testid={`friends-tab-${t.id}`}
            >
              {t.label}
              {t.id === 'pending' && pendingCount ? <Badge count={pendingCount} size="sm" tone="danger" /> : null}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'add'}
            onClick={() => select('add')}
            className={cn('ml-1 rounded-md px-2.5 py-1 text-[15px] font-medium', tab === 'add' ? 'bg-transparent text-success' : 'bg-success text-white hover:bg-success/90')}
            data-testid="add-friend-tab"
          >
            Add Friend
          </button>
        </div>
        <div className="ml-auto flex items-center"><InboxButton /></div>
      </header>
      {tab === 'add' ? (
        <AddFriend />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <div className="px-5 lg:px-8">
            <SearchInput value={query} onChange={setQuery} placeholder="Search" aria-label={`Search ${tab === 'blocked' ? 'blocked users' : tab === 'pending' ? 'friend requests' : 'friends'}`} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">{body}</div>
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
                  { label: 'Profile', onSelect: () => openProfile(menu.user.id, menu.anchor) },
                  'separator',
                  { label: 'Remove Friend', danger: true, onSelect: () => void confirmRemoveFriend(menu.user) },
                  { label: 'Block', danger: true, onSelect: () => void confirmBlock(menu.user) },
                ]
            : []
        }
      />
    </div>
  );
}
