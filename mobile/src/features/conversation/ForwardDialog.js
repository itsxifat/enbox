/** Forward messages to up to MAX_FORWARD_TARGETS chats (web ForwardDialog.tsx). */
import { useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MAX_FORWARD_TARGETS, chatTitle } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { SendIcon } from '@/components/icons';
import {
  CheckCircle,
  EmptyState,
  IconButton,
  ListItem,
  Modal,
  SearchInput,
  T,
  toast,
} from '@/components/ui';
import { chatPath } from '@/features/chats/links';
import { api } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { useAuth } from '@/stores/auth';
import { useChats, useSortedChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useTheme } from '@/theme';
import { useConversationUi } from './state';

export function ForwardDialog() {
  const messages = useConversationUi((s) => s.forward);
  const close = () => useConversationUi.getState().openForward(null);
  if (!messages) return null;
  return (
    <ForwardDialogInner
      key={messages.map((m) => m.id).join(',')}
      messageIds={messages.map((m) => m.id)}
      onClose={close}
    />
  );
}

function ForwardDialogInner({ messageIds, onClose }) {
  const { tw } = useTheme();
  const { height } = useWindowDimensions();
  const me = useAuth((s) => s.user?.id);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const all = useSortedChats({ kind: 'all', query });
  const archived = useSortedChats({ kind: 'chats', archived: true, query });
  const chats = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of [...all, ...archived]) {
      if (seen.has(c.id) || !c.permissions.canSend || c.membership !== 'active') continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [all, archived]);
  const byId = useChats((s) => s.byId);

  const toggle = (id) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_FORWARD_TARGETS) {
        toast.info(`You can forward to up to ${MAX_FORWARD_TARGETS} chats`, { id: 'fwd-limit' });
        return cur;
      }
      return [...cur, id];
    });

  const send = async () => {
    if (!selected.length) return;
    setSending(true);
    try {
      const copies = await api.post('/api/messages/forward', {
        clientId: newClientId().slice(0, 36),
        messageIds,
        chatIds: selected,
      });
      for (const c of copies) useMessages.getState().upsertMessage(c);
      toast.success(
        messageIds.length > 1 ? `${messageIds.length} messages forwarded` : 'Message forwarded',
        {
          id: 'forwarded',
        },
      );
      const target = selected.length === 1 ? selected[0] : null;
      useConversationUi
        .getState()
        .clearSelect(useConversationUi.getState().forward?.[0]?.chatId ?? '');
      onClose();
      const targetChat = target ? useChats.getState().byId[target] : undefined;
      if (targetChat) router.push(chatPath(targetChat));
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  };

  const names = selected.map((id) => (byId[id] ? chatTitle(byId[id], me) : '')).filter(Boolean);

  return (
    <Modal
      open
      onClose={onClose}
      scroll={false}
      title={
        messageIds.length > 1 ? `Forward ${messageIds.length} messages to…` : 'Forward message to…'
      }
      footer={
        <View style={tw`w-full flex-row items-center gap-3`}>
          <T numberOfLines={1} style={tw`min-w-0 flex-1 text-sm text-muted`}>
            {names.length ? names.join(', ') : `Select up to ${MAX_FORWARD_TARGETS} chats`}
          </T>
          <IconButton
            icon={SendIcon}
            label="Forward"
            variant="brand"
            size="lg"
            disabled={!selected.length}
            loading={sending}
            onPress={() => void send()}
          />
        </View>
      }
    >
      <SearchInput value={query} onChange={setQuery} placeholder="Search chats" />
      <ScrollView
        style={[tw`-mx-6 mt-2`, { maxHeight: height * 0.52, minHeight: 160 }]}
        keyboardShouldPersistTaps="handled"
      >
        {chats.length ? (
          chats.map((c) => {
            const on = selected.includes(c.id);
            return (
              <ListItem
                key={c.id}
                dense
                onPress={() => toggle(c.id)}
                leading={<ChatAvatar chat={c} size="md" />}
                title={chatTitle(c, me)}
                subtitle={
                  c.type === 'group'
                    ? `${c.memberCount} members`
                    : c.type === 'channel'
                      ? 'Channel'
                      : (c.peer?.about ?? undefined)
                }
                end={<CheckCircle checked={on} size={20} />}
                active={on}
              />
            );
          })
        ) : (
          <EmptyState compact title="No chats found" description="Try another name." />
        )}
      </ScrollView>
    </Modal>
  );
}
