/** Reply quote (inside bubbles and above the composer) and status-reply quote (web Quote.tsx). */
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { chatTitle, formatDuration, renderMentions } from '@enbox/shared';
import { Icon, UpdatesIcon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUserName, useUsers } from '@/stores/users';
import { mentionName, typeIcon } from '@/features/chats/preview';
import { useTheme } from '@/theme';
import { senderColor } from '../lib/senderColor';

function QuoteFrame({ color, children, thumb, onPress, style }) {
  const { tw, dark } = useTheme();
  const bg = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
  const pressedBg = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const inner = (
    <>
      <View style={[tw`w-1 self-stretch`, { backgroundColor: color }]} />
      <View style={tw`min-w-0 flex-1 justify-center gap-0.5 px-2.5 py-1.5`}>{children}</View>
      {thumb}
    </>
  );
  const frame = [
    tw`min-h-12 w-full min-w-0 flex-row overflow-hidden rounded-lg`,
    { backgroundColor: bg },
    style,
  ];
  if (!onPress) return <View style={frame}>{inner}</View>;
  return (
    <Press onPress={onPress} style={frame} pressedStyle={{ backgroundColor: pressedBg }}>
      {inner}
    </Press>
  );
}

function quoteText(p) {
  if (p.deleted) return 'This message was deleted';
  const text = p.text ? renderMentions(p.text, mentionName).replace(/\s+/g, ' ').trim() : '';
  if (text) return text;
  switch (p.type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return `Voice message${p.media?.durationMs ? ` (${formatDuration(p.media.durationMs)})` : ''}`;
    case 'audio':
      return p.media?.fileName ?? 'Audio';
    case 'file':
      return p.media?.fileName ?? 'Document';
    case 'location':
      return 'Location';
    case 'contact':
      return 'Contact';
    case 'poll':
      return 'Poll';
    case 'call':
      return 'Call';
    default:
      return 'Message';
  }
}

export function ReplyQuote({ preview, onPress, style, chatId }) {
  const { tw, c, dark } = useTheme();
  const me = useAuth((s) => s.user?.id);
  const origin = useChats((s) =>
    chatId && preview.chatId !== chatId ? s.byId[preview.chatId] : undefined,
  );
  const name = useUserName(preview.senderId, { you: 'You' });
  useUsers((s) => s.byId);
  const color = preview.senderId
    ? preview.senderId === me
      ? c.brand
      : senderColor(preview.senderId, dark)
    : c.brand;
  const TypeIcon = preview.deleted ? null : typeIcon(preview.type);
  const thumbSrc =
    !preview.deleted && preview.media && (preview.type === 'image' || preview.type === 'video')
      ? (preview.media.thumbnailUrl ?? (preview.type === 'image' ? preview.media.url : null))
      : null;
  return (
    <QuoteFrame
      color={color}
      onPress={onPress}
      style={style}
      thumb={
        thumbSrc ? (
          <View style={tw`size-12`}>
            <Image source={{ uri: mediaUrl(thumbSrc) }} style={tw`size-12`} contentFit="cover" />
            {preview.type === 'video' ? (
              <View style={tw`absolute inset-0 items-center justify-center`}>
                <Play size={14} color="#fff" fill="#fff" />
              </View>
            ) : null}
          </View>
        ) : null
      }
    >
      <T numberOfLines={1} style={[tw`text-[13px] font-semibold`, { color }]}>
        {preview.senderId ? name : 'Channel'}
        {origin ? (
          <T style={tw`text-[13px] font-normal text-muted`}> · {chatTitle(origin, me)}</T>
        ) : null}
      </T>
      <View style={tw`min-w-0 flex-row items-center gap-1`}>
        {TypeIcon ? <Icon icon={TypeIcon} size={14} color={c.muted} /> : null}
        <T
          numberOfLines={2}
          style={[
            tw`shrink text-[13px] leading-snug text-muted`,
            preview.deleted ? { fontStyle: 'italic' } : null,
          ]}
        >
          {quoteText(preview)}
        </T>
      </View>
    </QuoteFrame>
  );
}

export function StatusReplyQuote({ status }) {
  const { tw, c } = useTheme();
  const author = useUserName(status.authorId, { you: 'You' });
  const unavailable = !status.available;
  return (
    <QuoteFrame
      color={c.brand}
      thumb={
        !unavailable ? (
          status.type === 'text' ? (
            <View
              style={[
                tw`size-12 items-center justify-center p-1`,
                { backgroundColor: status.backgroundColor ?? c.brand },
              ]}
            >
              <T
                numberOfLines={3}
                style={tw`text-center text-[8px] font-semibold leading-tight text-white`}
              >
                {status.text}
              </T>
            </View>
          ) : status.mediaUrl ? (
            <Image
              source={{ uri: mediaUrl(status.mediaUrl) }}
              style={tw`size-12`}
              contentFit="cover"
            />
          ) : null
        ) : null
      }
    >
      <View style={tw`flex-row items-center gap-1`}>
        <Icon icon={UpdatesIcon} size={14} color={c['brand-ink']} />
        <T numberOfLines={1} style={tw`text-[13px] font-semibold text-brand-ink`}>
          {author} · Status
        </T>
      </View>
      <T
        numberOfLines={1}
        style={[tw`text-[13px] text-muted`, unavailable ? { fontStyle: 'italic' } : null]}
      >
        {unavailable
          ? 'Status unavailable'
          : status.text ||
            (status.type === 'video' ? 'Video' : status.type === 'image' ? 'Photo' : 'Status')}
      </T>
    </QuoteFrame>
  );
}
