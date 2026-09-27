/**
 * New call (web features/calls/NewCallPane.tsx): pick a contact (voice/video) or a group to
 * call. Contacts without a chat yet get one via `POST /api/chats/direct` first.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { UserRoundSearch } from 'lucide-react-native';
import { chatTitle, userDisplayName } from '@enbox/shared';
import { ChatAvatar, UserAvatar } from '@/components/common/avatars';
import { Icon, PhoneIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  ListItem,
  ListItemSkeleton,
  ListSection,
  Press,
  SearchInput,
  T,
  toast,
} from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { useBus } from '@/hooks/useBus';
import { api, errorMessage } from '@/lib/api';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useTheme } from '@/theme';

function CallIcons({ label, onCall, disabled }) {
  const { tw, c } = useTheme();
  const btn = (type, icon, text) => (
    <Press
      accessibilityLabel={`${text} ${label}`}
      disabled={disabled}
      onPress={() => onCall(type)}
      pressedStyle={tw`bg-brand-soft`}
      style={[tw`size-10 items-center justify-center rounded-full`, disabled && { opacity: 0.4 }]}
    >
      <Icon icon={icon} size={20} color={c['brand-ink']} />
    </Press>
  );
  return (
    <View style={tw`flex-row items-center gap-1`}>
      {btn('audio', PhoneIcon, 'Voice call')}
      {btn('video', VideoIcon, 'Video call')}
    </View>
  );
}

export default function NewCallScreen() {
  const { tw } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const chats = useChats((s) => s.byId);

  useEffect(() => {
    let alive = true;
    api
      .get('/api/contacts')
      .then((c) => alive && setContacts(c))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [reload]);
  useBus('contacts:changed', () => setReload((n) => n + 1));

  const q = query.trim().toLowerCase();
  const people = useMemo(
    () =>
      (contacts ?? [])
        .filter((c) => !c.user.isDeleted && !c.user.isBlocked)
        .filter(
          (c) =>
            !q || userDisplayName(c.user).toLowerCase().includes(q) || c.user.username.includes(q),
        )
        .sort((a, b) => userDisplayName(a.user).localeCompare(userDisplayName(b.user))),
    [contacts, q],
  );
  const groups = useMemo(
    () =>
      Object.values(chats)
        .filter((c) => c.type === 'group' && c.membership === 'active' && c.permissions.canCall)
        .filter((c) => !q || chatTitle(c).toLowerCase().includes(q))
        .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1)),
    [chats, q],
  );

  const callUser = async (userId, type) => {
    try {
      const chat = await ensureDirectChat(userId);
      await useCalls.getState().startCall(chat.id, type);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="New call" back="/calls">
        <SearchInput value={query} onChange={setQuery} placeholder="Search contacts and groups" />
      </PaneHeader>
      <ScrollView
        style={tw`min-h-0 flex-1`}
        contentContainerStyle={tw`pb-6`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {groups.length ? (
          <ListSection title="Groups">
            {groups.slice(0, q ? 50 : 6).map((g) => (
              <ListItem
                key={g.id}
                leading={<ChatAvatar chat={g} />}
                title={chatTitle(g)}
                subtitle={`${g.memberCount} members`}
                end={
                  <CallIcons
                    label={chatTitle(g)}
                    onCall={(t) => void useCalls.getState().startCall(g.id, t)}
                  />
                }
              />
            ))}
          </ListSection>
        ) : null}
        <ListSection title="Contacts">
          {error ? (
            <EmptyState title="Couldn't load contacts" description={error} compact />
          ) : !contacts ? (
            <ListItemSkeleton count={6} />
          ) : people.length === 0 ? (
            <EmptyState
              icon={UserRoundSearch}
              title={q ? 'No matches' : 'No contacts yet'}
              description={
                q ? `Nobody matches "${query.trim()}".` : 'Add contacts to call them from here.'
              }
              compact
              action={
                q ? undefined : (
                  <Press feedback={false} onPress={() => router.push('/new')}>
                    <T style={tw`text-[14px] font-semibold text-brand-ink`}>Find people</T>
                  </Press>
                )
              }
            />
          ) : (
            people.map((c) => (
              <ListItem
                key={c.user.id}
                leading={<UserAvatar user={c.user} size="lg" />}
                title={userDisplayName(c.user)}
                subtitle={c.user.about ?? `@${c.user.username}`}
                end={
                  <CallIcons
                    label={userDisplayName(c.user)}
                    onCall={(t) => void callUser(c.user.id, t)}
                  />
                }
              />
            ))
          )}
        </ListSection>
      </ScrollView>
    </View>
  );
}
