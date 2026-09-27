/**
 * "New chat" at /new (web features/contacts/NewChatPane.tsx): quick actions (new group /
 * contact / community), message yourself, my contacts (alphabetical, sticky letters) and user
 * search (GET /api/users/search). Tapping someone opens (or creates) the direct chat.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Ban,
  EllipsisVertical,
  MessageCircle,
  Pencil,
  SearchX,
  Trash2,
  UserPlus,
  UserRoundPlus,
  Users,
  UsersRound,
} from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Menu,
  Press,
  SearchInput,
  Spinner,
  T,
  measureAnchor,
  toast,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { groupByInitial, matchesUser, useContactList } from '@/stores/contacts';
import { useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { AddContactDialog, EditContactDialog } from './ContactDialogs';
import {
  confirmBlock,
  confirmUnblock,
  deleteContactFlow,
  openDirectChat,
  saveContact,
} from './contactActions';

function ActionRow({ icon, title, subtitle, onPress }) {
  const { tw, c } = useTheme();
  return (
    <Press onPress={onPress} style={tw`flex-row items-center gap-3.5 px-4 py-2.5`}>
      <View style={tw`size-12 items-center justify-center rounded-full bg-brand`}>
        <Icon icon={icon} size={22} strokeWidth={ICON_STROKE_ON_FILL} color={c['on-brand']} />
      </View>
      <View style={tw`min-w-0 flex-1`}>
        <T style={tw`text-[16px] font-medium`}>{title}</T>
        {subtitle ? <T style={tw`text-[13.5px] text-muted`}>{subtitle}</T> : null}
      </View>
    </Press>
  );
}

function PersonRow({ user, subtitle, busy, onOpen, onMenu }) {
  const { tw, c } = useTheme();
  const rowRef = useRef(null);
  const moreRef = useRef(null);
  const name = userDisplayName(user);
  const menuAt = async (ref) => onMenu((await measureAnchor(ref)) ?? { x: 0, y: 0 });
  return (
    <View style={tw`flex-row items-center`}>
      <Press
        ref={rowRef}
        onPress={onOpen}
        onLongPress={onMenu ? () => void menuAt(rowRef) : undefined}
        disabled={busy}
        accessibilityLabel={`Chat with ${name}`}
        style={tw`min-w-0 flex-1 flex-row items-center gap-3.5 px-4 py-2.5`}
      >
        <UserAvatar user={user} size="lg" />
        <View style={tw`min-w-0 flex-1 pr-8`}>
          <T numberOfLines={1} style={tw`text-[16px] font-medium`}>
            {name}
          </T>
          <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
            {subtitle ?? (user.about || `@${user.username}`)}
          </T>
        </View>
        {busy ? <Spinner size={18} color={c['brand-ink']} /> : null}
      </Press>
      {onMenu && !busy ? (
        <IconButton
          ref={moreRef}
          icon={EllipsisVertical}
          label={`More options for ${name}`}
          size="sm"
          onPress={() => void menuAt(moreRef)}
          style={tw`absolute right-3`}
        />
      ) : null}
    </View>
  );
}

function SectionTitle({ children }) {
  const { tw } = useTheme();
  return (
    <T
      style={[
        tw`bg-surface px-4 pt-3 pb-1.5 text-[13px] font-semibold text-brand-ink`,
        { letterSpacing: 0.33 },
      ]}
    >
      {children}
    </T>
  );
}

export function NewChat() {
  const { tw, c } = useTheme();
  const router = useRouter();
  const me = useMe();
  const { items, loaded, error } = useContactList();
  const [query, setQuery] = useState('');
  const q = query.trim();
  // The server ignores a leading "@"; a lone "@" is not a query.
  const term = q.replace(/^@+$/, '');
  const debounced = useDebouncedValue(term, 300);
  const [search, setSearch] = useState({ status: 'idle' });
  const [opening, setOpening] = useState(null);
  const [adding, setAdding] = useState({ open: false });
  const [editing, setEditing] = useState(null);
  const [menu, setMenu] = useState(null);

  // Server search (exact username / prefix / phone / names of people I know).
  useEffect(() => {
    if (!debounced) {
      setSearch({ status: 'idle' });
      return undefined;
    }
    const ctrl = new AbortController();
    setSearch({ status: 'loading', q: debounced });
    api
      .get('/api/users/search', { query: { q: debounced }, signal: ctrl.signal })
      .then((users) => {
        useUsers.getState().upsertUsers(users);
        setSearch({ status: 'done', q: debounced, users });
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'aborted') return;
        setSearch({ status: 'error', q: debounced, message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [debounced]);

  const filtered = useMemo(
    () => (q ? items.filter((ct) => matchesUser(ct.user, q)) : items),
    [items, q],
  );
  const groups = useMemo(
    () => groupByInitial(filtered, (ct) => userDisplayName(ct.user)),
    [filtered],
  );
  const contactIds = useMemo(() => new Set(items.map((ct) => ct.user.id)), [items]);
  const others =
    search.status === 'done' && search.q === debounced
      ? search.users.filter((u) => !contactIds.has(u.id) && u.id !== me?.id)
      : [];
  const searching = !!term && (debounced !== term || search.status === 'loading');

  const open = async (userId) => {
    if (opening) return;
    setOpening(userId);
    try {
      const chat = await openDirectChat(userId);
      router.replace(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
      setOpening(null);
    }
  };

  const menuItems = (u) => [
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
  const sections = loaded ? groups.map((g) => ({ key: g.letter, data: g.items })) : [];

  const header = (
    <>
      {!q ? (
        <View style={tw`py-1`}>
          <ActionRow
            icon={UsersRound}
            title="New group"
            onPress={() => router.push('/new/group')}
          />
          <ActionRow
            icon={UserPlus}
            title="New contact"
            onPress={() => setAdding({ open: true })}
          />
          <ActionRow
            icon={Users}
            title="New community"
            subtitle="Bring related groups together"
            onPress={() => router.push('/communities/new')}
          />
        </View>
      ) : null}

      {!q && me ? (
        <>
          <SectionTitle>Message yourself</SectionTitle>
          <Press
            onPress={() => void open(me.id)}
            disabled={!!opening}
            style={tw`flex-row items-center gap-3.5 px-4 py-2.5`}
          >
            <Avatar src={me.avatarUrl} name={me.displayName} colorSeed={me.id} size="lg" />
            <View style={tw`min-w-0 flex-1`}>
              <T numberOfLines={1} style={tw`text-[16px] font-medium`}>
                {me.displayName} (You)
              </T>
              <T numberOfLines={1} style={tw`text-[13.5px] text-muted`}>
                Message yourself
              </T>
            </View>
            {opening === me.id ? <Spinner size={18} /> : null}
          </Press>
        </>
      ) : null}

      {!loaded ? (
        error ? (
          <EmptyState compact title="Couldn't load contacts" description={error} />
        ) : (
          <ListItemSkeleton count={6} />
        )
      ) : filtered.length ? (
        <SectionTitle>{q ? 'Contacts' : 'Contacts on Enbox'}</SectionTitle>
      ) : !q ? (
        <EmptyState
          compact
          icon={UserPlus}
          title="No contacts yet"
          description="Search for people by their @username or phone number, or add them as a contact."
          action={
            <Button variant="soft" leftIcon={UserPlus} onPress={() => setAdding({ open: true })}>
              Add contact
            </Button>
          }
        />
      ) : null}
    </>
  );

  const footer = q ? (
    <View>
      {others.length ? (
        <>
          <SectionTitle>Other people on Enbox</SectionTitle>
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
        </>
      ) : null}
      {searching ? (
        <View style={tw`flex-row items-center justify-center gap-2 py-6`}>
          <Spinner size={16} color={c.muted} />
          <T style={tw`text-[14px] text-muted`}>Searching…</T>
        </View>
      ) : search.status === 'error' ? (
        <T style={tw`px-6 py-6 text-center text-[14px] text-danger`}>{search.message}</T>
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
              onPress={() => setAdding({ open: true, query: q })}
            >
              Add contact
            </Button>
          }
        />
      ) : (
        <T style={[tw`px-6 pt-4 text-center text-[12.5px] text-subtle`, { lineHeight: 20 }]}>
          Looking for someone else? Search their exact @username or phone number.
        </T>
      )}
    </View>
  ) : null;

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="New chat"
        subtitle={count === null ? undefined : `${count} contact${count === 1 ? '' : 's'}`}
        back="/chats"
        actions={
          <IconButton
            icon={UserRoundPlus}
            label="Add contact"
            onPress={() => setAdding({ open: true })}
          />
        }
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search name, @username or phone"
          accessibilityLabel="Search people"
        />
      </PaneHeader>
      <SectionList
        style={tw`min-h-0 flex-1`}
        contentContainerStyle={tw`pb-6`}
        sections={sections}
        keyExtractor={(ct) => ct.user.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={!q}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderSectionHeader={({ section }) =>
          q ? null : (
            <T
              accessibilityElementsHidden
              style={[
                tw`px-5 py-1 text-[13px] font-semibold text-subtle`,
                { backgroundColor: c.surface },
              ]}
            >
              {section.key}
            </T>
          )
        }
        renderItem={({ item: ct }) => (
          <PersonRow
            user={ct.user}
            busy={opening === ct.user.id}
            onOpen={() => void open(ct.user.id)}
            onMenu={(anchor) => setMenu({ user: ct.user, anchor })}
          />
        )}
      />

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        items={menu ? menuItems(menu.user) : []}
        align="end"
      />
      <AddContactDialog
        open={adding.open}
        initialQuery={adding.query}
        onClose={() => setAdding({ open: false })}
      />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </View>
  );
}
