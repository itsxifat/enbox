/**
 * Header replacements (in-chat search, selection), the read-only footer and the pinned bar
 * (web features/conversation/Bars.tsx + PinnedBar.tsx).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Forward,
  Pin,
  PinOff,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react-native';
import { Icon } from '@/components/icons';
import { useBanner } from '@/components/layout/ConnectionBanner';
import { Button, IconButton, Press, Spinner, T, toast } from '@/components/ui';
import { deleteChat } from '@/features/chats/chatActions';
import { PreviewLine, previewParts } from '@/features/chats/preview';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api, mediaUrl } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import { alpha, useTheme } from '@/theme';
import {
  canForward,
  copyMessages,
  copyText,
  deleteMessages,
  selectedMessages,
  setStarred,
  unpinMessage,
} from './actions';
import { useConversationUi } from './state';

function useHeaderInset() {
  const insets = useSafeAreaInsets();
  const banner = useBanner((s) => s.shown);
  return banner ? 0 : insets.top;
}

export function ChatSearchBar({ chat }) {
  const { tw, c } = useTheme();
  const top = useHeaderInset();
  const query = useConversationUi((s) => s.search[chat.id] ?? '');
  const q = useDebouncedValue(query.trim(), 300);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .get('/api/search/messages', {
        query: { q, chatId: chat.id, limit: 100 },
        signal: controller.signal,
      })
      .then((list) => {
        setResults(list);
        setIndex(0);
        const first = list[0];
        if (first)
          useConversationUi.getState().requestJump(chat.id, first.message.seq, first.message.id);
      })
      .catch((e) => {
        if (!controller.signal.aborted) toast.error(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, chat.id]);

  const go = (next) => {
    if (!results?.length) return;
    const i = Math.max(0, Math.min(results.length - 1, next));
    setIndex(i);
    const r = results[i];
    useConversationUi.getState().requestJump(chat.id, r.message.seq, r.message.id);
  };
  const close = () => useConversationUi.getState().setSearch(chat.id, null);
  const count = results?.length ?? 0;

  return (
    <View
      style={[tw`h-16 flex-row items-center gap-1 bg-surface px-2`, { marginTop: top, height: 64 }]}
    >
      <IconButton icon={ArrowLeft} label="Close search" onPress={close} />
      <View style={tw`h-10 min-w-0 flex-1 flex-row items-center rounded-full bg-surface-2`}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={(v) => useConversationUi.getState().setSearch(chat.id, v)}
          onSubmitEditing={() => go(index + 1)}
          placeholder="Search in chat"
          placeholderTextColor={c.subtle}
          returnKeyType="search"
          selectionColor={alpha(c.brand, 0.5)}
          cursorColor={c.brand}
          style={{
            flex: 1,
            height: '100%',
            paddingLeft: 16,
            paddingRight: 8,
            fontSize: 15,
            color: c.fg,
          }}
        />
        {loading ? <Spinner size={16} style={tw`mr-3`} /> : null}
        {!loading && q ? (
          <T style={[tw`mr-3 text-[13px] text-muted`, { fontVariant: ['tabular-nums'] }]}>
            {count ? `${index + 1} of ${count}` : 'No results'}
          </T>
        ) : null}
      </View>
      <IconButton
        icon={ChevronUp}
        label="Older result"
        disabled={!count || index >= count - 1}
        onPress={() => go(index + 1)}
      />
      <IconButton
        icon={ChevronDown}
        label="Newer result"
        disabled={!count || index <= 0}
        onPress={() => go(index - 1)}
      />
    </View>
  );
}

export function SelectionBar({ chat }) {
  const { tw } = useTheme();
  const top = useHeaderInset();
  const ids = useConversationUi((s) => s.selecting[chat.id] ?? []);
  const items = useMessages((s) => s.byChat[chat.id]?.items);
  const selected = (items ?? []).filter((m) => ids.includes(m.id));
  const n = selected.length;
  const allStarred = n > 0 && selected.every((m) => m.starred);
  const forwardable = n > 0 && selected.every(canForward);
  const copyable = n > 0 && selected.some((m) => copyText(m));
  const clear = () => useConversationUi.getState().clearSelect(chat.id);
  return (
    <View style={[tw`flex-row items-center gap-1 bg-surface px-2`, { marginTop: top, height: 64 }]}>
      <IconButton icon={X} label="Cancel selection" onPress={clear} />
      <T numberOfLines={1} style={tw`min-w-0 flex-1 px-1 text-[17px] font-semibold`}>
        {n ? `${n} selected` : 'Select messages'}
      </T>
      <IconButton
        icon={allStarred ? StarOff : Star}
        label={allStarred ? 'Unstar' : 'Star'}
        disabled={!n}
        onPress={() => void setStarred(selectedMessages(chat.id), !allStarred).then(clear)}
      />
      <IconButton
        icon={Copy}
        label="Copy"
        disabled={!copyable}
        onPress={() => void copyMessages(selectedMessages(chat.id)).then(clear)}
      />
      <IconButton
        icon={Forward}
        label="Forward"
        disabled={!forwardable}
        onPress={() => useConversationUi.getState().openForward(selectedMessages(chat.id))}
      />
      <IconButton
        icon={Trash2}
        label="Delete"
        disabled={!n}
        onPress={() =>
          void deleteMessages(chat, selectedMessages(chat.id)).then((done) => {
            if (done) clear();
          })
        }
      />
    </View>
  );
}

export function ReadOnlyFooter({ chat, onDeleted }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  let text;
  let action = null;
  if (chat.membership !== 'active') {
    text =
      chat.membership === 'removed'
        ? 'You can’t send messages to this group because you were removed.'
        : 'You can’t send messages to this group because you’re no longer a member.';
    action = {
      label: 'Delete group',
      run: async () => {
        if (await deleteChat(chat)) onDeleted();
      },
    };
  } else if (chat.type === 'direct' && chat.peer?.isDeleted) {
    text = 'This account has been deleted. You can’t send messages to it.';
  } else if (chat.type === 'direct' && chat.peer?.isBlocked) {
    text = 'You blocked this contact.';
    action = {
      label: 'Unblock',
      run: async () => {
        try {
          await api.delete(`/api/blocks/${chat.peer.id}`);
          await useChats.getState().refreshChat(chat.id);
          toast.success('Contact unblocked');
        } catch (e) {
          toast.error(e);
        }
      },
    };
  } else if (chat.type === 'channel') {
    text = 'Only channel admins can post.';
  } else if (chat.isAnnouncement) {
    text = 'Only community admins can send messages.';
  } else {
    text = 'Only admins can send messages.';
  }
  return (
    <View
      style={[
        tw`mx-3 mt-2 items-center gap-2 rounded-xl bg-surface-2 px-4 py-3`,
        { marginBottom: Math.max(12, insets.bottom) },
      ]}
    >
      <T style={tw`text-center text-[14px] text-muted`}>{text}</T>
      {action ? (
        <Button
          size="sm"
          variant="soft"
          loading={busy}
          onPress={() => {
            setBusy(true);
            void action.run().finally(() => setBusy(false));
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

const NO_IDS = [];

export function PinnedBar({ chat }) {
  const { tw, c } = useTheme();
  const me = useAuth((s) => s.user?.id);
  const ids = useChats((s) => s.pins[chat.id] ?? NO_IDS);
  const known = useChats((s) => s.pins[chat.id] !== undefined);
  const items = useMessages((s) => s.byChat[chat.id]?.items);
  const [fetched, setFetched] = useState([]);
  const [synced, setSynced] = useState(false);
  const [index, setIndex] = useState(0);
  const active = chat.membership === 'active';
  const missing = ids.some((id) => !fetched.some((m) => m.id === id));
  const needFetch = !synced || !known || missing;
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!needFetch) return;
    let cancelled = false;
    const before = useChats.getState().pins[chat.id];
    api
      .get(`/api/chats/${chat.id}/pins`)
      .then((list) => {
        if (cancelled) return;
        setFetched(list);
        setSynced(true);
        void useUsers
          .getState()
          .fetchUsers(list.map((m) => m.senderId).filter(Boolean))
          .catch(() => undefined);
        if (useChats.getState().pins[chat.id] === before)
          useChats.getState().setPins(
            chat.id,
            list.map((m) => m.id),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chat.id, needFetch, idsKey]);

  const pins = useMemo(
    () =>
      ids
        .map((id) => items?.find((m) => m.id === id) ?? fetched.find((m) => m.id === id))
        .filter((m) => !!m && !m.deletedAt),
    [ids, items, fetched],
  );

  if (!active || !pins.length) return null;
  const i = index % pins.length;
  const m = pins[i];
  const thumb =
    m.media && (m.type === 'image' || m.type === 'video')
      ? (m.media.thumbnailUrl ?? (m.type === 'image' ? m.media.url : null))
      : null;
  return (
    <View
      style={tw`mx-3 mb-2 flex-row items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1 pl-3`}
    >
      <View style={tw`h-9 justify-center gap-0.5`}>
        {pins.map((p, j) => (
          <View
            key={p.id}
            style={[
              tw`w-[3px] flex-1 rounded-full`,
              { backgroundColor: j === i ? c.brand : c['line-strong'] },
            ]}
          />
        ))}
      </View>
      <Press
        onPress={() => {
          useConversationUi.getState().requestJump(chat.id, m.seq, m.id);
          setIndex((x) => x + 1);
        }}
        style={tw`min-w-0 flex-1 flex-row items-center gap-2.5 rounded-lg px-1 py-0.5`}
      >
        <View style={{ transform: [{ rotate: '45deg' }] }}>
          <Icon icon={Pin} size={16} color={c.muted} />
        </View>
        <View style={tw`min-w-0 flex-1`}>
          <T style={tw`text-[12px] font-semibold text-brand-ink`}>
            {pins.length > 1 ? `Pinned message ${i + 1} of ${pins.length}` : 'Pinned message'}
          </T>
          <PreviewLine parts={previewParts(m, { meId: me, chat })} size={13.5} />
        </View>
        {thumb ? (
          <Image source={{ uri: mediaUrl(thumb) }} style={tw`size-9 rounded`} contentFit="cover" />
        ) : null}
      </Press>
      {chat.permissions.canPin ? (
        <IconButton
          icon={PinOff}
          label="Unpin message"
          size="sm"
          onPress={() => void unpinMessage(chat, m.id)}
        />
      ) : null}
    </View>
  );
}
