/**
 * The message action surface of a conversation (web MessageActionsHost.tsx): the long-press
 * sheet with a quick-reactions strip, and the full reaction picker (the same responsive
 * emoji panel as the composer, in a bottom sheet). Opened through
 * `useConversationUi().openActions`.
 */
import { useCallback, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import {
  CheckSquare,
  Copy,
  Download,
  Forward,
  Info,
  MessageSquareReply,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCw,
  Share2,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react-native';
import { QUICK_REACTIONS } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { ActionSheet, Modal, Press, T } from '@/components/ui';
import { EmojiPanel } from '@/features/emoji/EmojiPanel';
import { mediaUrl } from '@/lib/api';
import { saveToGallery, shareFile } from '@/lib/files';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { nameOf, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import {
  canEdit,
  canForward,
  canInfo,
  canMessageSender,
  canPinMessage,
  canReact,
  canReply,
  canReplyPrivately,
  copyMessages,
  copyText,
  deleteMessages,
  isActionable,
  openDirectChat,
  pinMessage,
  react,
  retry,
  setStarred,
  startEdit,
  startReply,
  unpinMessage,
} from './actions';
import { myReactionOf } from './lib/optimistic';
import { useChatMembersStore } from './members';
import { useConversationUi } from './state';

export function QuickReactions({ chat, m, onDone, onMore }) {
  const { tw, c } = useTheme();
  const me = useAuth((s) => s.user?.id) ?? '';
  const current = myReactionOf(m, me);
  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  return (
    <View style={tw`flex-row items-center justify-between rounded-full bg-surface-2 p-1`}>
      {QUICK_REACTIONS.map((e) => (
        <Press
          key={e}
          accessibilityLabel={current === e ? `Remove reaction ${e}` : `React ${e}`}
          onPress={() => {
            onDone();
            void react(chat, m, current === e ? null : e);
          }}
          style={[
            tw`size-10 items-center justify-center rounded-full`,
            current === e ? tw`bg-brand-soft` : null,
          ]}
        >
          <T style={{ fontSize: 26, lineHeight: 32 }}>{e}</T>
        </Press>
      ))}
      {onMore && !quickOnly ? (
        <Press
          accessibilityLabel="More reactions"
          onPress={onMore}
          style={tw`ml-0.5 size-9 items-center justify-center rounded-full bg-surface`}
        >
          <Icon icon={Plus} size={20} color={c.muted} />
        </Press>
      ) : null}
    </View>
  );
}

function downloadName(m) {
  return m.media?.fileName ?? `${m.type}-${m.id.slice(0, 8)}`;
}

export function MessageActions({ chat }) {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const action = useConversationUi((s) => (s.action?.chatId === chat.id ? s.action : null));
  const m = useMessages((s) =>
    action ? s.byChat[chat.id]?.items.find((x) => x.id === action.messageId) : undefined,
  );
  const pins = useChats((s) => s.pins[chat.id]);
  const me = useAuth((s) => s.user?.id);
  const senderProfile = useUsers((s) => (m?.senderId ? s.byId[m.senderId] : undefined));
  const members = useChatMembersStore((s) =>
    chat.type === 'group' ? s.byChat[chat.id] : undefined,
  );
  const [pickerFor, setPickerFor] = useState(null);
  const pickerMessage = useMessages((s) =>
    pickerFor ? s.byChat[chat.id]?.items.find((x) => x.id === pickerFor) : undefined,
  );
  const close = useCallback(() => useConversationUi.getState().openActions(null), []);

  const items = [];
  if (action && m) {
    const actionable = isActionable(m);
    const sender = {
      deleted: !!(m.senderId && senderProfile?.isDeleted),
      member: members && m.senderId ? members.some((x) => x.user.id === m.senderId) : null,
    };
    const pinned = !!pins?.includes(m.id);
    const text = copyText(m);
    const visual = m.type === 'image' || m.type === 'video';
    items.push(
      m.failed ? { label: 'Retry', icon: RotateCw, onSelect: () => retry(chat.id, m) } : null,
      canReply(chat, m)
        ? { label: 'Reply', icon: Reply, onSelect: () => startReply(chat, m) }
        : null,
      canReplyPrivately(chat, m, me, sender)
        ? {
            label: 'Reply privately',
            icon: MessageSquareReply,
            onSelect: () =>
              void openDirectChat(m.senderId).then((id) => {
                if (!id) return;
                useConversationUi.getState().setReply(id, m);
                router.push(`/chats/${id}`);
              }),
          }
        : null,
      canMessageSender(chat, m, me, sender)
        ? {
            label: `Message ${nameOf(m.senderId)}`,
            icon: MessageSquareText,
            onSelect: () =>
              void openDirectChat(m.senderId).then((id) => id && router.push(`/chats/${id}`)),
          }
        : null,
      text ? { label: 'Copy', icon: Copy, onSelect: () => void copyMessages([m]) } : null,
      canForward(m)
        ? {
            label: 'Forward',
            icon: Forward,
            onSelect: () => useConversationUi.getState().openForward([m]),
          }
        : null,
      canPinMessage(chat, m)
        ? pinned
          ? { label: 'Unpin', icon: PinOff, onSelect: () => void unpinMessage(chat, m.id) }
          : { label: 'Pin', icon: Pin, onSelect: () => void pinMessage(chat, m) }
        : null,
      actionable && !m.deletedAt && m.type !== 'call'
        ? m.starred
          ? { label: 'Unstar', icon: StarOff, onSelect: () => void setStarred([m], false) }
          : { label: 'Star', icon: Star, onSelect: () => void setStarred([m], true) }
        : null,
      canEdit(chat, m) ? { label: 'Edit', icon: Pencil, onSelect: () => startEdit(chat, m) } : null,
      canInfo(chat, m)
        ? { label: 'Info', icon: Info, onSelect: () => useConversationUi.getState().openInfo(m) }
        : null,
      m.media && !m.deletedAt && actionable
        ? {
            label: visual ? 'Save to gallery' : 'Download',
            icon: Download,
            onSelect: () =>
              visual
                ? void saveToGallery(mediaUrl(m.media.url), downloadName(m))
                : void shareFile(mediaUrl(m.media.url), downloadName(m), m.media.mimeType),
          }
        : null,
      m.media && !m.deletedAt && actionable && visual
        ? {
            label: 'Share',
            icon: Share2,
            onSelect: () =>
              void shareFile(mediaUrl(m.media.url), downloadName(m), m.media.mimeType),
          }
        : null,
      actionable
        ? {
            label: 'Select',
            icon: CheckSquare,
            onSelect: () => useConversationUi.getState().startSelect(chat.id, m.id),
          }
        : null,
      'separator',
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => void deleteMessages(chat, [m]),
      },
    );
  }
  const reactable = !!m && canReact(chat, m);

  return (
    <>
      <ActionSheet
        open={!!action && !!m}
        onClose={close}
        header={
          m && reactable ? (
            <QuickReactions
              chat={chat}
              m={m}
              onDone={close}
              onMore={() => {
                close();
                setPickerFor(m.id);
              }}
            />
          ) : null
        }
        items={items}
      />
      <Modal
        open={!!pickerFor && !!pickerMessage}
        onClose={() => setPickerFor(null)}
        title="Choose a reaction"
        hideClose
        scroll={false}
        bodyStyle={{ paddingHorizontal: 0, paddingVertical: 0 }}
      >
        {pickerMessage ? (
          <EmojiPanel
            height={Math.min(440, Math.round(height * 0.55))}
            onPick={(emoji) => {
              setPickerFor(null);
              void react(chat, pickerMessage, emoji);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
