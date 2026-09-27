/**
 * One conversation row (web features/conversation/MessageRow.tsx): optional day separator /
 * unread divider, then a system pill or a message bubble (sender name, forwarded label,
 * quotes, typed content, meta, reactions). Touch: long-press opens the action sheet,
 * swipe right replies, tap toggles in select mode.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Ban, Check, FastForward, Forward, RotateCw } from 'lucide-react-native';
import { FORWARDED_MANY_TIMES_THRESHOLD } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { isFreshArrival } from '@/lib/arrivals';
import { formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { useUserName } from '@/stores/users';
import { alpha, useTheme } from '@/theme';
import { canReact, canReply, retry, startReply } from './actions';
import { AudioFileBody, VoiceBody } from './bubbles/AudioBody';
import { CallBody, ContactBody, FileBody, LocationBody } from './bubbles/CardBodies';
import { MediaBody } from './bubbles/MediaBody';
import { DaySeparator, SystemPill, UnreadDivider } from './bubbles/Pills';
import { PollBody } from './bubbles/PollBody';
import { ReplyQuote, StatusReplyQuote } from './bubbles/Quote';
import { ReactionPill, ReactionsDialog } from './bubbles/Reactions';
import { CornerMeta, Meta, MetaSpacer, RichText } from './bubbles/Text';
import { emojiOnlyCount } from './lib/richText';
import { senderColor } from './lib/senderColor';
import { useConversationUi, useIsSelected, useSelecting } from './state';

function Tail({ mine, color }) {
  return (
    <Svg
      viewBox="0 0 8 13"
      width={8}
      height={13}
      style={{ position: 'absolute', top: 0, [mine ? 'right' : 'left']: -8 }}
    >
      {mine ? (
        <Path d="M0 0h5.5C7.5 0 8 1.2 7 2.6L0 12.6V0z" fill={color} />
      ) : (
        <Path d="M8 0H2.5C.5 0 0 1.2 1 2.6l7 10V0z" fill={color} />
      )}
    </Svg>
  );
}

export function SenderName({ userId, selecting, you, style }) {
  const { tw, dark } = useTheme();
  const name = useUserName(userId, { you });
  return (
    <T
      numberOfLines={1}
      onPress={selecting ? undefined : () => openProfile(userId)}
      suppressHighlighting
      style={[
        tw`px-1 pt-0.5 text-[13px] font-semibold`,
        { color: senderColor(userId, dark) },
        style,
      ]}
    >
      {name}
    </T>
  );
}

function SenderAvatar({ userId, selecting, size = 32 }) {
  return (
    <Press
      feedback={false}
      disabled={selecting}
      onPress={() => openProfile(userId)}
      style={{ borderRadius: size / 2 }}
    >
      <UserAvatar userId={userId} size={size} />
    </Press>
  );
}

export function ForwardedLabel({ count }) {
  const { tw, c } = useTheme();
  const many = count >= FORWARDED_MANY_TIMES_THRESHOLD;
  return (
    <View style={tw`flex-row items-center gap-1 px-1 pt-0.5`}>
      <Icon icon={many ? FastForward : Forward} size={14} color={c.muted} />
      <T style={[tw`text-[12px] text-muted`, { fontStyle: 'italic' }]}>
        {many ? 'Forwarded many times' : 'Forwarded'}
      </T>
    </View>
  );
}

/** Derived facts about a message that decide the row's chrome. */
export function rowShape(m, showSender) {
  const deleted = !!m.deletedAt;
  const emojiCount =
    m.type === 'text' && !deleted && !m.replyTo && !m.forwardCount && !m.statusReply
      ? emojiOnlyCount(m.text)
      : 0;
  const bare = emojiCount > 0;
  const hasHeader =
    showSender ||
    (m.forwardCount > 0 && !deleted) ||
    (!!m.replyTo && !deleted) ||
    (!!m.statusReply && !deleted);
  const visual = !deleted && (m.type === 'image' || m.type === 'video') && !!m.media;
  const caption = !deleted && m.text ? m.text : null;
  return { deleted, emojiCount, bare, hasHeader, visual, caption };
}

function SelectCheckbox({ selected, style }) {
  const { tw, c } = useTheme();
  return (
    <View
      style={[
        tw`mt-2 mr-2 size-5 items-center justify-center rounded-md border-2`,
        {
          borderColor: selected ? c.brand : c['line-strong'],
          backgroundColor: selected ? c.brand : c.surface,
        },
        style,
      ]}
    >
      {selected ? (
        <Icon icon={Check} size={14} strokeWidth={ICON_STROKE_BOLD} color={c['on-brand']} />
      ) : null}
    </View>
  );
}

function RetryButton({ chat, m }) {
  const { tw, c } = useTheme();
  if (!m.failed || m.type === 'image' || m.type === 'video') return null;
  return (
    <Press
      feedback={false}
      onPress={() => retry(chat.id, m)}
      style={tw`mt-1 flex-row items-center gap-1`}
    >
      <Icon icon={RotateCw} size={12} color={c.danger} />
      <T style={tw`text-[12px] font-medium text-danger`}>Not sent. Tap to retry</T>
    </Press>
  );
}

/** The typed body of a message (text, media + caption, cards, deleted placeholder). */
export function MessageContent({ m, mine, chat, search, shape, maxWidth }) {
  const { tw, c, chatFontSize } = useTheme();
  const { deleted, bare, emojiCount, hasHeader, visual, caption } = shape;
  const text = [
    tw`text-fg`,
    { fontSize: chatFontSize, lineHeight: Math.round(chatFontSize * 1.38) },
  ];
  if (deleted) {
    return (
      <View style={tw`px-1.5 pt-1 pb-1.5`}>
        <T style={[text, { color: c.muted, fontStyle: 'italic' }]}>
          <Icon icon={Ban} size={16} color={c.muted} />{' '}
          {mine ? 'You deleted this message' : 'This message was deleted'}
          <MetaSpacer m={m} mine={mine} />
        </T>
        <CornerMeta m={m} mine={mine} chat={chat} />
      </View>
    );
  }
  if (bare) {
    const size = emojiCount === 1 ? 52 : emojiCount === 2 ? 44 : 38;
    return (
      <View style={tw`items-end gap-1`}>
        <T style={{ fontSize: size, lineHeight: size * 1.25 }}>{m.text}</T>
        <Meta m={m} mine={mine} chat={chat} variant="pill" />
      </View>
    );
  }
  if (m.type === 'text') {
    return (
      <View style={tw`px-1.5 pt-1 pb-1.5`}>
        <T style={text}>
          <RichText text={m.text ?? ''} highlight={search} />
          <MetaSpacer m={m} mine={mine} />
        </T>
        <CornerMeta m={m} mine={mine} chat={chat} />
      </View>
    );
  }
  if (visual) {
    const radius = hasHeader || caption ? 6 : 6;
    return (
      <>
        <MediaBody
          m={m}
          radius={radius}
          maxWidth={maxWidth}
          onOpen={() =>
            useConversationUi.getState().openViewer({ chatId: chat.id, messageId: m.id })
          }
          onRetry={() => retry(chat.id, m)}
        >
          {!caption ? <Meta m={m} mine={mine} chat={chat} variant="overlay" /> : null}
        </MediaBody>
        {caption ? (
          <View style={[tw`px-1.5 pt-1.5 pb-1.5`, { maxWidth }]}>
            <T style={text}>
              <RichText text={caption} highlight={search} />
              <MetaSpacer m={m} mine={mine} />
            </T>
            <CornerMeta m={m} mine={mine} chat={chat} />
          </View>
        ) : null}
      </>
    );
  }
  const metaInBody = !caption && (m.type === 'voice' || m.type === 'call');
  const meta = <Meta m={m} mine={mine} chat={chat} />;
  const w = maxWidth - 8;
  let body;
  switch (m.type) {
    case 'voice':
      body = m.media ? <VoiceBody m={m} mine={mine} meta={meta} width={w} /> : null;
      break;
    case 'audio':
      body = m.media ? <AudioFileBody m={m} mine={mine} width={w} /> : null;
      break;
    case 'file':
      body = m.media ? <FileBody m={m} mine={mine} width={w} /> : null;
      break;
    case 'location':
      body = m.location ? <LocationBody m={m} width={w} /> : null;
      break;
    case 'contact':
      body = m.contact ? <ContactBody m={m} width={w} /> : null;
      break;
    case 'poll':
      body = m.poll ? <PollBody m={m} chat={chat} mine={mine} width={w} /> : null;
      break;
    case 'call':
      body = m.call ? <CallBody m={m} chat={chat} meta={meta} width={w} /> : null;
      break;
    default:
      body = null;
  }
  return (
    <View>
      <View style={tw`px-1 pt-1`}>
        {body ?? <T style={{ color: c.muted, fontStyle: 'italic' }}>Unsupported message</T>}
      </View>
      {caption ? (
        <View style={[tw`px-1.5 pt-1 pb-1.5`, { maxWidth }]}>
          <T style={text}>
            <RichText text={caption} highlight={search} />
            <MetaSpacer m={m} mine={mine} />
          </T>
          <CornerMeta m={m} mine={mine} chat={chat} />
        </View>
      ) : metaInBody ? (
        <View style={tw`h-1`} />
      ) : (
        <View style={tw`flex-row justify-end px-1.5 pt-0.5 pb-1`}>{meta}</View>
      )}
    </View>
  );
}

/** Quotes and labels above the body (forwarded, reply quote, status reply). */
export function BubbleHeader({ m, chat, onJump, deleted }) {
  const { tw } = useTheme();
  if (deleted) return null;
  return (
    <>
      {m.forwardCount > 0 ? <ForwardedLabel count={m.forwardCount} /> : null}
      {m.replyTo ? (
        <ReplyQuote
          preview={m.replyTo}
          chatId={chat.id}
          style={tw`mt-1 mb-0.5`}
          onPress={
            m.replyTo.chatId === chat.id && !m.replyTo.deleted
              ? () => onJump(m.replyTo.seq, m.replyTo.id)
              : undefined
          }
        />
      ) : null}
      {m.statusReply ? (
        <View style={tw`mt-1 mb-0.5`}>
          <StatusReplyQuote status={m.statusReply} />
        </View>
      ) : null}
    </>
  );
}

/** Swipe right to reply (touch), with the reply hint fading in behind the bubble. */
function SwipeToReply({ enabled, onReply, children }) {
  const { tw, c, shadow } = useTheme();
  const x = useSharedValue(0);
  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([12, 999])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(84, e.translationX * 0.6));
    })
    .onEnd(() => {
      if (x.value > 52) runOnJS(onReply)();
      x.value = withTiming(0, { duration: 160 });
    })
    .onFinalize(() => {
      if (x.value !== 0) x.value = withTiming(0, { duration: 160 });
    });
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const hint = useAnimatedStyle(() => ({ opacity: Math.min(1, x.value / 52) }));
  return (
    <GestureDetector gesture={pan}>
      <View>
        <ReAnimated.View
          pointerEvents="none"
          style={[
            tw`absolute left-3 size-8 items-center justify-center rounded-full bg-surface`,
            { top: '50%', marginTop: -16 },
            shadow.bubble,
            hint,
          ]}
        >
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <Icon icon={Forward} size={16} color={c.muted} />
          </View>
        </ReAnimated.View>
        <ReAnimated.View style={moving}>{children}</ReAnimated.View>
      </View>
    </GestureDetector>
  );
}

function useFlash(messageId) {
  const token = useConversationUi((s) =>
    s.highlight?.messageId === messageId ? s.highlight.token : 0,
  );
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!token) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [token]);
  return flash;
}

/** Fade/slide/pop in for live arrivals only (chat theme "message animation"). */
function useEnter(rowKey) {
  const anim = useUi((s) => s.prefs.messageAnimation);
  const reduce = useUi((s) => s.prefs.reduceMotion === 'on');
  const [fresh] = useState(() => !reduce && anim !== 'none' && isFreshArrival(rowKey));
  const v = useRef(new Animated.Value(fresh ? 0 : 1)).current;
  useEffect(() => {
    if (fresh) Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [fresh, v]);
  if (!fresh) return null;
  if (anim === 'slide')
    return {
      opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
    };
  if (anim === 'pop')
    return {
      opacity: v,
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
    };
  return { opacity: v };
}

export const MessageRow = memo(function MessageRow({
  row,
  chat,
  onJump,
  onJumpById,
  rowWidth,
  bubbleStyle = 'classic',
}) {
  const { tw, c, shadow } = useTheme();
  const m = row.message;
  const { mine } = row;
  const selecting = useSelecting(chat.id);
  const selected = useIsSelected(chat.id, m.id);
  const search = useConversationUi((s) => s.search[chat.id] ?? null);
  const flash = useFlash(m.id);
  const enter = useEnter(row.key);
  const [reactionsOpen, setReactionsOpen] = useState(false);

  if (m.type === 'system') {
    return (
      <View>
        {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
        {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
        <SystemPill m={m} chat={chat} onJump={onJumpById} />
      </View>
    );
  }

  const isGroupish = chat.type === 'group';
  const showSender = isGroupish && !mine && row.firstInGroup && !!m.senderId;
  const showAvatar = isGroupish && !mine;
  const shape = rowShape(m, showSender);
  const { deleted, bare, hasHeader, visual } = shape;
  const hasReactions = m.reactions.length > 0 && !deleted;
  const tail = bubbleStyle === 'classic' || bubbleStyle === 'cozy';
  const bubbleColor = mine ? c['bubble-out'] : c['bubble-in'];
  const inner = (rowWidth ?? 390) - 16 - (showAvatar ? 38 : 0) - (selecting ? 28 : 0);
  const maxBubble = Math.min(560, Math.floor(inner * 0.86));
  const contentMax = visual && !hasHeader ? maxBubble - 6 : maxBubble - 8;

  const openSheet = () => {
    if (selecting) return;
    useConversationUi
      .getState()
      .openActions({ chatId: chat.id, messageId: m.id, anchor: null, mode: 'sheet' });
  };
  const toggle = () => useConversationUi.getState().toggleSelect(chat.id, m.id);

  const radius = bubbleStyle === 'rounded' ? 18 : bubbleStyle === 'minimal' ? 10 : 8;
  const chrome = bare
    ? null
    : [
        { backgroundColor: bubbleColor, borderRadius: radius },
        bubbleStyle === 'minimal'
          ? { borderWidth: 1, borderColor: alpha(c.line, 0.7) }
          : shadow.bubble,
        bubbleStyle === 'classic' && row.firstInGroup
          ? mine
            ? { borderTopRightRadius: 0 }
            : { borderTopLeftRadius: 0 }
          : null,
        visual && !hasHeader ? { padding: 3 } : { paddingHorizontal: 4, paddingTop: 2 },
        m.failed ? { borderWidth: 1, borderColor: alpha(c.danger, 0.6) } : null,
      ];

  return (
    <View>
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <SwipeToReply enabled={!selecting && canReply(chat, m)} onReply={() => startReply(chat, m)}>
        <Press
          feedback={false}
          disabled={!selecting}
          onPress={toggle}
          style={[
            tw`flex-row items-start px-2`,
            { justifyContent: mine ? 'flex-end' : 'flex-start' },
            row.firstInGroup ? tw`pt-1.5` : { paddingTop: 3 },
            hasReactions ? tw`pb-4` : null,
            selected ? { backgroundColor: alpha(c.brand, 0.12) } : null,
            flash ? { backgroundColor: alpha(c.brand, 0.2) } : null,
          ]}
        >
          {selecting ? (
            <SelectCheckbox
              selected={selected}
              style={mine ? { position: 'absolute', left: 8 } : null}
            />
          ) : null}
          {showAvatar ? (
            <View style={tw`mr-1.5 w-8 pt-0.5`}>
              {row.firstInGroup && m.senderId ? (
                <SenderAvatar userId={m.senderId} selecting={selecting} />
              ) : null}
            </View>
          ) : null}
          <Animated.View
            style={[{ maxWidth: maxBubble, alignItems: mine ? 'flex-end' : 'flex-start' }, enter]}
          >
            <Press
              feedback={false}
              onLongPress={openSheet}
              delayLongPress={380}
              onPress={selecting ? toggle : undefined}
              style={[{ maxWidth: maxBubble, minWidth: 0 }, chrome]}
            >
              {!bare && tail && row.firstInGroup && bubbleStyle === 'classic' ? (
                <Tail mine={mine} color={bubbleColor} />
              ) : null}
              {showSender ? <SenderName userId={m.senderId} selecting={selecting} /> : null}
              <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
              <MessageContent
                m={m}
                mine={mine}
                chat={chat}
                search={search}
                shape={shape}
                maxWidth={contentMax}
              />
            </Press>
            {hasReactions ? (
              <View
                style={[
                  tw`absolute`,
                  { bottom: -16, zIndex: 1 },
                  mine ? { right: 8 } : { left: 8 },
                ]}
              >
                <ReactionPill
                  reactions={m.reactions}
                  myReaction={m.myReaction}
                  onPress={() => setReactionsOpen(true)}
                />
              </View>
            ) : null}
            <RetryButton chat={chat} m={m} />
          </Animated.View>
        </Press>
      </SwipeToReply>
      {reactionsOpen ? (
        <ReactionsDialog m={m} chat={chat} open onClose={() => setReactionsOpen(false)} />
      ) : null}
    </View>
  );
});

/**
 * The `cozy` bubble style (web CozyMessageRow.tsx): Discord-style rows — a 40 px avatar, name
 * and time header on the first message of a sender group, no bubble background and
 * full-width content. Same gestures as `MessageRow`; `MessageList` picks it.
 */
export const CozyMessageRow = memo(function CozyMessageRow({
  row,
  chat,
  onJump,
  onJumpById,
  rowWidth,
}) {
  const { tw, c } = useTheme();
  const m = row.message;
  const { mine } = row;
  const selecting = useSelecting(chat.id);
  const selected = useIsSelected(chat.id, m.id);
  const search = useConversationUi((s) => s.search[chat.id] ?? null);
  const flash = useFlash(m.id);
  const enter = useEnter(row.key);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  // Discord shows your own name, not "You".
  const myName = useAuth((s) => s.user?.displayName ?? 'You');

  if (m.type === 'system') {
    return (
      <View>
        {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
        {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
        <SystemPill m={m} chat={chat} onJump={onJumpById} />
      </View>
    );
  }

  const shape = rowShape(m, false);
  const { deleted, bare, visual } = shape;
  const hasReactions = m.reactions.length > 0 && !deleted;
  const header = row.firstInGroup && !!m.senderId;
  const inner = (rowWidth ?? 390) - 16 - 24 - 40 - 12 - (selecting ? 28 : 0);
  const contentMax = bare ? inner : visual ? Math.min(inner, 480) : Math.min(inner, 720);

  const openSheet = () => {
    if (selecting) return;
    useConversationUi
      .getState()
      .openActions({ chatId: chat.id, messageId: m.id, anchor: null, mode: 'sheet' });
  };
  const toggle = () => useConversationUi.getState().toggleSelect(chat.id, m.id);

  return (
    <View>
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <SwipeToReply enabled={!selecting && canReply(chat, m)} onReply={() => startReply(chat, m)}>
        <Press
          feedback={false}
          disabled={!selecting}
          onPress={toggle}
          style={[
            tw`flex-row items-start gap-3 px-3`,
            row.firstInGroup ? tw`mt-2.5 pt-0.5` : { paddingTop: 1 },
            hasReactions ? tw`pb-1` : { paddingBottom: 1 },
            selected ? { backgroundColor: alpha(c.brand, 0.12) } : null,
            flash ? { backgroundColor: alpha(c.brand, 0.2) } : null,
          ]}
        >
          {selecting ? <SelectCheckbox selected={selected} style={tw`mr-0`} /> : null}
          <View style={tw`w-10`}>
            {header ? (
              <SenderAvatar userId={m.senderId} selecting={selecting} size={40} />
            ) : null}
          </View>
          <Animated.View style={[tw`min-w-0 flex-1`, enter]}>
            <Press
              feedback={false}
              onLongPress={openSheet}
              delayLongPress={380}
              onPress={selecting ? toggle : undefined}
              style={[
                tw`min-w-0 rounded-md`,
                m.failed ? { borderWidth: 1, borderColor: alpha(c.danger, 0.6) } : null,
              ]}
            >
              {header ? (
                <View style={tw`flex-row items-baseline gap-2`}>
                  <SenderName
                    userId={m.senderId}
                    selecting={selecting}
                    you={myName}
                    style={tw`shrink px-0 pt-0 text-[14.5px]`}
                  />
                  <T style={tw`text-[11.5px] text-muted`}>{formatTime(m.createdAt)}</T>
                </View>
              ) : null}
              <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
              <View style={bare ? tw`self-start` : { maxWidth: contentMax }}>
                <MessageContent
                  m={m}
                  mine={mine}
                  chat={chat}
                  search={search}
                  shape={shape}
                  maxWidth={contentMax}
                />
              </View>
            </Press>
            {hasReactions ? (
              <View style={tw`mt-1 flex-row px-1`}>
                <ReactionPill
                  reactions={m.reactions}
                  myReaction={m.myReaction}
                  onPress={() => setReactionsOpen(true)}
                />
              </View>
            ) : null}
            <RetryButton chat={chat} m={m} />
          </Animated.View>
        </Press>
      </SwipeToReply>
      {reactionsOpen ? (
        <ReactionsDialog m={m} chat={chat} open onClose={() => setReactionsOpen(false)} />
      ) : null}
    </View>
  );
});

export { canReact };
