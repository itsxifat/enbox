/**
 * Chat list row (web features/chats/ChatRow.tsx): avatar (+presence), title, time, preview
 * (typing / draft / last message with ticks and sender prefix), unread / @mention badges,
 * muted & pinned icons, marked-unread dot. Long-press opens the chat's action sheet.
 */
import { memo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AtSign, BellOff, MessageSquareText, Pin } from 'lucide-react-native';
import { chatTitle, isMuted, renderMentions, tickStatus } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { ActionSheet, Badge, ListItem, T } from '@/components/ui';
import { formatChatListTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { isChatUnread, useChats, useTypingUsers } from '@/stores/chats';
import { nameOf, useUsers } from '@/stores/users';
import { Ticks } from '@/features/conversation/bubbles/Ticks';
import { useTheme } from '@/theme';
import { chatMenuItems } from './chatActions';
import { useDraft } from './drafts';
import { PreviewLine, previewParts } from './preview';

function TypingPreview({ chat, typing }) {
  const { tw } = useTheme();
  const ids = Object.keys(typing);
  const recording = Object.values(typing).some((t) => t.state === 'recording');
  const verb = recording ? 'recording audio…' : 'typing…';
  const who =
    chat.type === 'direct'
      ? ''
      : ids.length > 1
        ? `${ids.length} people are `
        : `${nameOf(ids[0])} is `;
  return (
    <T numberOfLines={1} style={tw`text-[14px] font-medium leading-snug text-brand-ink`}>
      {who}
      {verb}
    </T>
  );
}

function LastMessagePreview({ chat, me, highlight }) {
  const { tw, c } = useTheme();
  const color = highlight ? c.fg : c.muted;
  const last = chat.lastMessage;
  if (!last) {
    const text =
      chat.membership !== 'active' && chat.type === 'group'
        ? 'You’re no longer a member'
        : chat.type === 'direct'
          ? 'Tap to start chatting'
          : (chat.description ?? '');
    return (
      <T numberOfLines={1} style={[tw`text-[14px] leading-snug`, { color }]}>
        {text}
      </T>
    );
  }
  const mine = !!me && last.senderId === me;
  const status = mine && !last.deletedAt ? (last.failed ? 'failed' : tickStatus(last, chat)) : null;
  const showSender =
    chat.type === 'group' && last.senderId && last.type !== 'system' && last.type !== 'call';
  const prefix = showSender ? (mine ? 'You' : nameOf(last.senderId)) : null;
  return (
    <View style={tw`min-w-0 flex-row items-center gap-1`}>
      {status ? <Ticks status={status} size={16} color={color} /> : null}
      {prefix ? (
        <T style={[tw`shrink-0 text-[14px] leading-snug`, { color }]}>{`${prefix}: `}</T>
      ) : null}
      <PreviewLine parts={previewParts(last, { meId: me, chat })} color={color} />
    </View>
  );
}

export const ChatRow = memo(function ChatRow({ chat, href, onDeleted }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const me = useAuth((s) => s.user?.id);
  useUsers((s) => s.byId);
  const typing = useTypingUsers(chat.id);
  const draft = useDraft(chat.id);
  const isOpen = useChats((s) => s.openChatId === chat.id);
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  const [sheet, setSheet] = useState(false);

  const muted = isMuted(chat.mutedUntil);
  const unread = isChatUnread(chat);
  const highlight = unread && !muted;
  const hasTyping = Object.keys(typing).length > 0;
  const showDraft = !!draft && !isOpen && !hasTyping && draft.text.trim().length > 0;
  const to = href ?? `/chats/${chat.id}`;

  let subtitle;
  if (hasTyping) subtitle = <TypingPreview chat={chat} typing={typing} />;
  else if (showDraft)
    subtitle = (
      <View style={tw`min-w-0 flex-row items-center`}>
        <T style={tw`text-[14px] font-medium leading-snug text-danger`}>{'Draft: '}</T>
        <T
          numberOfLines={1}
          style={[tw`shrink text-[14px] leading-snug`, { color: highlight ? c.fg : c.muted }]}
        >
          {renderMentions(draft.text, (id) => nameOf(id, { you: myName }))}
        </T>
      </View>
    );
  else subtitle = <LastMessagePreview chat={chat} me={me} highlight={highlight} />;

  const items = chatMenuItems(chat, { onDeleted: onDeleted && (() => onDeleted(chat.id)) });
  const title = chatTitle(chat, me);

  return (
    <>
      <ListItem
        onPress={() => router.push(to)}
        onLongPress={() => setSheet(true)}
        leading={
          <ChatAvatar
            chat={chat}
            size="lg"
            showPresence={chat.type === 'direct' && chat.peer?.id !== me}
          />
        }
        title={title}
        meta={
          chat.lastMessage || chat.lastActivityAt
            ? formatChatListTime(chat.lastActivityAt)
            : undefined
        }
        highlight={highlight}
        subtitle={subtitle}
        trailing={
          muted || (chat.isPinned && !chat.isArchived) || chat.unreadMentionCount > 0 || unread ? (
            <>
              {muted ? <Icon icon={BellOff} size={16} color={c.subtle} /> : null}
              {chat.isPinned && !chat.isArchived ? (
                <View style={{ transform: [{ rotate: '45deg' }] }}>
                  <Icon icon={Pin} size={16} color={c.subtle} />
                </View>
              ) : null}
              {chat.unreadMentionCount > 0 ? (
                <View style={tw`size-5 items-center justify-center rounded-full bg-unread`}>
                  <Icon
                    icon={AtSign}
                    size={14}
                    strokeWidth={ICON_STROKE_ON_FILL}
                    color={c['on-brand']}
                  />
                </View>
              ) : null}
              {unread ? (
                chat.unreadCount > 0 ? (
                  <Badge count={chat.unreadCount} tone={muted ? 'muted' : 'brand'} />
                ) : (
                  <View
                    style={[
                      tw`size-5 rounded-full`,
                      { backgroundColor: muted ? c['unread-muted'] : c.unread },
                    ]}
                  />
                )
              ) : null}
            </>
          ) : null
        }
      />
      <ActionSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={title}
        items={[
          { label: 'Open chat', icon: MessageSquareText, onSelect: () => router.push(to) },
          ...items,
        ]}
      />
    </>
  );
});
