/**
 * The conversation view for /chats/:chatId (web features/conversation/ConversationPane.tsx).
 *
 * Contract kept from the web:
 * - `useChats().setOpenChat(chatId)` while focused (read receipts, unread suppression,
 *   notification muting — see realtime/chats.ts `markChatRead`)
 * - loads with `loadLatest(chatId)` (or `loadAround` for `?m=<seq>` links)
 * - info panels by chat type (contact / group / channel) in a slide-in <Sheet>
 * - calls start with `useCalls().startCall(chatId, 'audio' | 'video')`
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { MessageCircleOff } from 'lucide-react-native';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, PageSpinner, Sheet } from '@/components/ui';
import { ChatBackground, useChatAppearance } from '@/features/appearance/ChatBackground';
import { ChatThemeSheet } from '@/features/appearance/ChatThemeSheet';
import { OngoingCallBanner } from '@/features/calls/OngoingCallBanner';
import { ChannelInfoPanel } from '@/features/channels/ChannelInfoPanel';
import { chatPath } from '@/features/chats/links';
import { ContactInfoPanel } from '@/features/contacts/ContactInfoPanel';
import { GroupInfoPanel } from '@/features/groups/GroupInfoPanel';
import { useChat, useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { ColorScope, useTheme } from '@/theme';
import { ChatSearchBar, PinnedBar, ReadOnlyFooter, SelectionBar } from './Bars';
import { Composer } from './composer/Composer';
import { ConversationHeader } from './ConversationHeader';
import { ForwardDialog } from './ForwardDialog';
import { Lightbox } from './Lightbox';
import { MessageActions } from './MessageActions';
import { MessageInfoSheet } from './MessageInfoSheet';
import { MessageList } from './MessageList';
import { useConversationUi } from './state';

function targetFromParams(params) {
  const seq = Number(params.m);
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return { seq, messageId: typeof params.mid === 'string' ? params.mid : undefined };
}

/** Contact / group / channel info by chat type (all `{ chatId, onClose }`). */
function InfoPanel({ chat, onClose }) {
  if (chat.type === 'direct') return <ContactInfoPanel chatId={chat.id} onClose={onClose} />;
  if (chat.type === 'channel') return <ChannelInfoPanel chatId={chat.id} onClose={onClose} />;
  return <GroupInfoPanel chatId={chat.id} onClose={onClose} />;
}

export function ConversationScreen() {
  const params = useLocalSearchParams();
  const chatId = typeof params.chatId === 'string' ? params.chatId : undefined;
  const chat = useChat(chatId);
  const chatsLoaded = useChats((s) => s.loaded);
  const target = useMemo(() => targetFromParams(params), [params]);

  useFocusEffect(
    useCallback(() => {
      if (!chatId) return undefined;
      useChats.getState().setOpenChat(chatId);
      return () => {
        if (useChats.getState().openChatId === chatId) useChats.getState().setOpenChat(null);
      };
    }, [chatId]),
  );

  useEffect(() => {
    if (chatId && chatsLoaded && !chat)
      void useChats
        .getState()
        .refreshChat(chatId)
        .catch(() => undefined);
  }, [chatId, chatsLoaded, chat]);

  if (!chat) return <MissingChat loaded={chatsLoaded} />;
  if (chat.type === 'channel')
    return <Redirect href={chatPath(chat, { seq: target?.seq, messageId: target?.messageId })} />;
  return <Conversation key={chat.id} chat={chat} initialTarget={target} />;
}

function MissingChat({ loaded }) {
  const { tw } = useTheme();
  const error = useChats((s) => s.error);
  const loading = useChats((s) => s.loading);
  let body;
  if (loaded) {
    body = (
      <EmptyState
        icon={MessageCircleOff}
        title="Chat not found"
        description="It may have been deleted, or you no longer have access."
      />
    );
  } else if (error && !loading) {
    body = (
      <EmptyState
        icon={MessageCircleOff}
        title="Couldn’t load your chats"
        description={error}
        action={
          <Button
            variant="soft"
            onPress={() =>
              void useChats
                .getState()
                .loadChats()
                .catch(() => undefined)
            }
          >
            Try again
          </Button>
        }
      />
    );
  } else body = <PageSpinner />;
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Chat" back="/chats" />
      <View style={tw`flex-1 items-center justify-center`}>{body}</View>
    </View>
  );
}

function Conversation({ chat, initialTarget }) {
  const { tw } = useTheme();
  const router = useRouter();
  const hasWindow = useMessages((s) => s.byChat[chat.id] !== undefined);
  const selecting = useConversationUi((s) => s.selecting[chat.id] !== undefined);
  const searching = useConversationUi((s) => typeof s.search[chat.id] === 'string');
  const [themeOpen, setThemeOpen] = useState(false);
  const [avoidKeyboard, setAvoidKeyboard] = useState(true);
  const [unread, setUnread] = useState(() =>
    chat.unreadCount > 0 ? { afterSeq: chat.lastReadSeq, count: chat.unreadCount } : null,
  );
  const appearance = useChatAppearance(chat);

  const bottomToken = useConversationUi((s) => s.bottomToken);
  const firstBottomToken = useRef(bottomToken);
  useEffect(() => {
    if (bottomToken !== firstBottomToken.current) setUnread(null);
  }, [bottomToken]);

  const targetKey = initialTarget ? `${initialTarget.seq}:${initialTarget.messageId ?? ''}` : null;
  useEffect(() => {
    if (initialTarget)
      useConversationUi.getState().requestJump(chat.id, initialTarget.seq, initialTarget.messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, chat.id]);

  useEffect(() => {
    const s = useMessages.getState().byChat[chat.id];
    if (s?.loadingLatest) return;
    if (initialTarget && !(s?.loaded && s.items.some((m) => m.seq === initialTarget.seq))) {
      void useMessages
        .getState()
        .loadAround(chat.id, initialTarget.seq)
        .catch(() => undefined);
    } else if (!s?.loaded || (s.hasMoreAfter && !initialTarget)) {
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  useEffect(
    () => () => {
      const ui = useConversationUi.getState();
      ui.clearSelect(chat.id);
      ui.setSearch(chat.id, null);
      if (ui.action?.chatId === chat.id) ui.openActions(null);
      if (ui.editing[chat.id]) ui.setEditing(chat.id, null);
    },
    [chat.id],
  );

  const [infoOpen, setInfoOpen] = useState(false);
  const openInfo = useCallback(() => setInfoOpen(true), []);
  const closeInfo = useCallback(() => setInfoOpen(false), []);
  const onAvoid = useCallback((v) => setAvoidKeyboard(v), []);
  const canCompose = chat.membership === 'active' && chat.permissions.canSend;

  return (
    <ColorScope overrides={appearance.colors}>
      <View style={tw`flex-1 bg-surface`}>
        {selecting ? (
          <SelectionBar chat={chat} />
        ) : searching ? (
          <ChatSearchBar chat={chat} />
        ) : (
          <ConversationHeader
            chat={chat}
            onOpenInfo={openInfo}
            onOpenTheme={() => setThemeOpen(true)}
          />
        )}
        <PinnedBar chat={chat} />
        <OngoingCallBanner chatId={chat.id} />
        <KeyboardAvoidingView behavior="padding" enabled={avoidKeyboard} style={tw`flex-1`}>
          <View style={tw`mx-2 min-h-0 flex-1 overflow-hidden rounded-xl`}>
            <ChatBackground appearance={appearance} />
            {!hasWindow ? (
              <PageSpinner />
            ) : (
              <MessageList
                chat={chat}
                unread={unread}
                initialTarget={initialTarget}
                bubbleStyle={appearance.bubbleStyle}
              />
            )}
          </View>
          {canCompose ? (
            <Composer chat={chat} onAvoidKeyboard={onAvoid} />
          ) : (
            <ReadOnlyFooter chat={chat} onDeleted={() => router.replace('/chats')} />
          )}
        </KeyboardAvoidingView>
        <MessageActions chat={chat} />
        <ForwardDialog />
        <MessageInfoSheet />
        <Lightbox chatId={chat.id} />
        <Sheet open={infoOpen} onClose={closeInfo} scroll={false}>
          <InfoPanel chat={chat} onClose={closeInfo} />
        </Sheet>
        {themeOpen ? <ChatThemeSheet chat={chat} onClose={() => setThemeOpen(false)} /> : null}
      </View>
    </ColorScope>
  );
}
