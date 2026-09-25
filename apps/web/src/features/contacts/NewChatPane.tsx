/**
 * "New chat" at /new (agent 1): quick actions (new group / contact / community, message
 * yourself), my contacts (alphabetical, sticky letters) and user search
 * (GET /api/users/search). Tapping someone opens (or creates) the direct chat.
 */
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  Ban,
  EllipsisVertical,
  MessageCircle,
  Pencil,
  SearchX,
  Trash2,
  UserPlus,
  UsersRound,
  UserRoundPlus,
  Users,
} from 'lucide-react';
import { userDisplayName, type ID, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Menu,
  SearchInput,
  Spinner,
  toast,
  type IconType,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { groupByInitial, matchesUser, useContactList } from '@/stores/contacts';
import { useUsers } from '@/stores/users';
import { AddContactDialog, EditContactDialog } from './ContactDialogs';
import {
  confirmBlock,
  confirmUnblock,
  deleteContactFlow,
  openDirectChat,
  saveContact,
} from './contactActions';

function ActionRow({
  icon: Icon,
  title,
  subtitle,
  onClick,
  testId,
}: {
  icon: IconType;
  title: string;
  subtitle?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
        <Icon size={22} strokeWidth={ICON_STROKE_ON_FILL} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[16px] font-medium text-fg">{title}</span>
        {subtitle ? <span className="text-[13.5px] text-muted">{subtitle}</span> : null}
      </span>
    </button>
  );
}

function PersonRow({
  user,
  subtitle,
  busy,
  onOpen,
  onMenu,
}: {
  user: UserPublic;
  subtitle?: string;
  busy?: boolean;
  onOpen: () => void;
  onMenu?: (anchor: MenuAnchor) => void;
}) {
  const name = userDisplayName(user);
  const onContextMenu = (e: MouseEvent) => {
    if (!onMenu) return;
    e.preventDefault();
    onMenu({ x: e.clientX, y: e.clientY });
  };
  return (
    <li className="group/row relative flex items-center" onContextMenu={onContextMenu}>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        aria-label={`Chat with ${name}`}
      >
        <UserAvatar user={user} size="lg" />
        <span className="flex min-w-0 flex-1 flex-col pr-8">
          <span className="truncate text-[16px] font-medium text-fg">{name}</span>
          <span className="truncate text-[13.5px] text-muted">
            {subtitle ?? (user.about || `@${user.username}`)}
          </span>
        </span>
        {busy ? <Spinner size={18} label={null} className="text-brand-ink" /> : null}
      </button>
      {onMenu && !busy ? (
        <IconButton
          icon={EllipsisVertical}
          label={`More options for ${name}`}
          size="sm"
          onClick={(e) => onMenu(e.currentTarget)}
          className="absolute right-3 opacity-100 transition-opacity lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-visible:opacity-100"
        />
      ) : null}
    </li>
  );
}

function SectionTitle({ children, sticky }: { children: string; sticky?: boolean }) {
  return (
    <h3
      className={cn(
        'px-4 pt-3 pb-1.5 text-[13px] font-semibold tracking-wide text-brand-ink',
        sticky && 'sticky top-0 z-[1] bg-surface/95 backdrop-blur-sm',
      )}
    >
      {children}
    </h3>
  );
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; q: string }
  | { status: 'done'; q: string; users: UserPublic[] }
  | { status: 'error'; q: string; message: string };

export function NewChatPane() {
  const navigate = useNavigate();
  const me = useMe();
  const { items, loaded, error } = useContactList();
  const [query, setQuery] = useState('');
  const q = query.trim();
  // The server ignores a leading "@"; a lone "@" is not a query.
  const term = q.replace(/^@+$/, '');
  const debounced = useDebouncedValue(term, 300);
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [opening, setOpening] = useState<ID | null>(null);
  const [adding, setAdding] = useState<{ open: boolean; query?: string }>({ open: false });
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const [menu, setMenu] = useState<{ user: UserPublic; anchor: MenuAnchor } | null>(null);

  // Server search (exact username / prefix / phone / names of people I know).
  useEffect(() => {
    if (!debounced) {
      setSearch({ status: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setSearch({ status: 'loading', q: debounced });
    api
      .get<UserPublic[]>('/api/users/search', { query: { q: debounced }, signal: ctrl.signal })
      .then((users) => {
        useUsers.getState().upsertUsers(users);
        setSearch({ status: 'done', q: debounced, users });
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'aborted') return;
        setSearch({ status: 'error', q: debounced, message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [debounced]);

  const filtered = useMemo(
    () => (q ? items.filter((c) => matchesUser(c.user, q)) : items),
    [items, q],
  );
  const groups = useMemo(
    () => groupByInitial(filtered, (c) => userDisplayName(c.user)),
    [filtered],
  );
  const contactIds = useMemo(() => new Set(items.map((c) => c.user.id)), [items]);
  const others =
    search.status === 'done' && search.q === debounced
      ? search.users.filter((u) => !contactIds.has(u.id) && u.id !== me?.id)
      : [];
  const searching = !!term && (debounced !== term || search.status === 'loading');

  const open = async (userId: ID) => {
    if (opening) return;
    setOpening(userId);
    try {
      const chat = await openDirectChat(userId);
      void navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
      setOpening(null);
    }
  };

  const menuItems = (u: UserPublic): MenuEntry[] => [
    { label: 'Message', icon: MessageCircle, onSelect: () => void open(u.id) },
    u.isContact
      ? { label: 'Edit name', icon: Pencil, onSelect: () => setEditing(u) }
      : { label: 'Add to contacts', icon: UserPlus, onSelect: () => void saveContact(u) },
    'separator',
    u.isBlocked
      ? {
          label: `Unblock ${userDisplayName(u)}`,
          icon: Ban,
          onSelect: () => void confirmUnblock(u),
        }
      : { label: 'Block', icon: Ban, danger: true, onSelect: () => void confirmBlock(u) },
    u.isContact && {
      label: 'Delete contact',
      icon: Trash2,
      danger: true,
      onSelect: () => void deleteContactFlow(u),
    },
  ];

  const count = loaded ? items.length : null;

  return (
    <>
      <PaneHeader
        title="New chat"
        subtitle={count === null ? undefined : `${count} contact${count === 1 ? '' : 's'}`}
        back="/chats"
        actions={
          <IconButton
            icon={UserRoundPlus}
            label="Add contact"
            onClick={() => setAdding({ open: true })}
          />
        }
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search name, @username or phone"
          aria-label="Search people"
          autoFocus
        />
      </PaneHeader>
      <div
        className="min-h-0 flex-1 overflow-y-auto pb-6 scrollbar-thin"
        data-testid="new-chat-list"
      >
        {!q ? (
          <div className="flex flex-col py-1">
            <ActionRow
              icon={UsersRound}
              title="New group"
              onClick={() => void navigate('/new/group')}
            />
            <ActionRow
              icon={UserPlus}
              title="New contact"
              onClick={() => setAdding({ open: true })}
              testId="new-contact"
            />
            <ActionRow
              icon={Users}
              title="New community"
              subtitle="Bring related groups together"
              onClick={() => void navigate('/communities/new')}
            />
          </div>
        ) : null}

        {!q && me ? (
          <>
            <SectionTitle>Message yourself</SectionTitle>
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => void open(me.id)}
                  disabled={!!opening}
                  className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                >
                  <Avatar src={me.avatarUrl} name={me.displayName} colorSeed={me.id} size="lg" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[16px] font-medium text-fg">
                      {me.displayName} (You)
                    </span>
                    <span className="truncate text-[13.5px] text-muted">Message yourself</span>
                  </span>
                  {opening === me.id ? <Spinner size={18} label={null} /> : null}
                </button>
              </li>
            </ul>
          </>
        ) : null}

        {!loaded ? (
          error ? (
            <EmptyState compact title="Couldn't load contacts" description={error} />
          ) : (
            <ListItemSkeleton count={6} />
          )
        ) : filtered.length ? (
          <div aria-label="Contacts on Enbox" role="group">
            {!q ? (
              <SectionTitle>Contacts on Enbox</SectionTitle>
            ) : (
              <SectionTitle>Contacts</SectionTitle>
            )}
            {groups.map((g) => (
              <section key={g.letter} aria-label={g.letter}>
                {!q ? (
                  <div
                    className="sticky top-0 z-[1] bg-surface/95 px-5 py-1 text-[13px] font-semibold text-subtle backdrop-blur-sm"
                    aria-hidden
                  >
                    {g.letter}
                  </div>
                ) : null}
                <ul>
                  {g.items.map((c) => (
                    <PersonRow
                      key={c.user.id}
                      user={c.user}
                      busy={opening === c.user.id}
                      onOpen={() => void open(c.user.id)}
                      onMenu={(anchor) => setMenu({ user: c.user, anchor })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : !q ? (
          <EmptyState
            compact
            icon={UserPlus}
            title="No contacts yet"
            description="Search for people by their @username or phone number, or add them as a contact."
            action={
              <Button variant="soft" leftIcon={UserPlus} onClick={() => setAdding({ open: true })}>
                Add contact
              </Button>
            }
          />
        ) : null}

        {q ? (
          <div aria-live="polite">
            {others.length ? (
              <>
                <SectionTitle>Other people on Enbox</SectionTitle>
                <ul>
                  {others.map((u) => (
                    <PersonRow
                      key={u.id}
                      user={u}
                      subtitle={`@${u.username}`}
                      busy={opening === u.id}
                      onOpen={() => void open(u.id)}
                      onMenu={(anchor) => setMenu({ user: u, anchor })}
                    />
                  ))}
                </ul>
              </>
            ) : null}
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[14px] text-muted">
                <Spinner size={16} label={null} /> Searching…
              </div>
            ) : search.status === 'error' ? (
              <p className="px-6 py-6 text-center text-[14px] text-danger">{search.message}</p>
            ) : !filtered.length && !others.length ? (
              <EmptyState
                compact
                icon={SearchX}
                title={`No results for “${q}”`}
                description="Search finds people by their exact @username (or its first 3+ letters) or full phone number with country code. Names only match your contacts and people you chat with."
                action={
                  <Button
                    variant="soft"
                    leftIcon={UserPlus}
                    onClick={() => setAdding({ open: true, query: q })}
                  >
                    Add contact
                  </Button>
                }
              />
            ) : (
              <p className="px-6 pt-4 text-center text-[12.5px] leading-relaxed text-subtle">
                Looking for someone else? Search their exact @username or phone number.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        items={menu ? menuItems(menu.user) : []}
        align="end"
        aria-label="Contact options"
      />
      <AddContactDialog
        open={adding.open}
        initialQuery={adding.query}
        onClose={() => setAdding({ open: false })}
      />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}
