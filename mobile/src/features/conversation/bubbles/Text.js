/**
 * Message text and bubble footer (web bubbles/RichText.tsx + Meta.tsx):
 *
 * - `RichText`   tappable @mentions, links, *bold* _italic_ ~strike~ ```mono```, search hits
 * - `Meta`       [star] [Edited] time [ticks] — inline, over media, or as a pill
 * - `InlineMeta` WhatsApp layout: an invisible copy of the meta at the end of the last text
 *                line reserves room, the visible meta sits in the bubble's bottom-right corner
 */
import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { Star } from 'lucide-react-native';
import { tickStatus } from '@enbox/shared';
import { T } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { formatTime } from '@/lib/format';
import { openUrl } from '@/lib/links';
import { useAuth } from '@/stores/auth';
import { useUserName } from '@/stores/users';
import { alpha, useTheme } from '@/theme';
import { parseRichText, splitHighlight } from '../lib/richText';
import { Ticks } from './Ticks';

function Mention({ userId }) {
  const { tw } = useTheme();
  const me = useAuth((s) => s.user?.id);
  const name = useUserName(userId, { you: useAuth.getState().user?.displayName ?? 'You' });
  return (
    <T
      style={tw`font-medium text-brand-ink`}
      onPress={userId === me ? undefined : () => openProfile(userId)}
      suppressHighlighting
    >
      @{name}
    </T>
  );
}

function Plain({ text, highlight }) {
  const { c } = useTheme();
  if (!highlight) return text;
  const parts = splitHighlight(text, highlight);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <T key={i} style={{ backgroundColor: alpha(c.warning, 0.35), borderRadius: 2 }}>
        {p}
      </T>
    ) : (
      p
    ),
  );
}

function openLink(href) {
  openUrl(href);
}

function Segments({ segments, highlight }) {
  const { tw, c, dark } = useTheme();
  return segments.map((s, i) => {
    switch (s.t) {
      case 'text':
        return <Plain key={i} text={s.text} highlight={highlight} />;
      case 'link':
        return (
          <T
            key={i}
            onPress={() => openLink(s.href)}
            suppressHighlighting
            style={{
              color: c['brand-ink'],
              textDecorationLine: 'underline',
              textDecorationColor: alpha(c['brand-ink'], 0.4),
            }}
          >
            <Plain text={s.text} highlight={highlight} />
          </T>
        );
      case 'mention':
        return <Mention key={i} userId={s.userId} />;
      case 'bold':
        return (
          <T key={i} style={tw`font-semibold`}>
            <Segments segments={s.children} highlight={highlight} />
          </T>
        );
      case 'italic':
        return (
          <T key={i} style={{ fontStyle: 'italic' }}>
            <Segments segments={s.children} highlight={highlight} />
          </T>
        );
      case 'strike':
        return (
          <T key={i} style={{ textDecorationLine: 'line-through' }}>
            <Segments segments={s.children} highlight={highlight} />
          </T>
        );
      case 'code':
        return (
          <T
            key={i}
            style={{
              fontFamily: 'monospace',
              fontSize: 13.5,
              backgroundColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            }}
          >
            <Segments segments={s.children} highlight={highlight} />
          </T>
        );
      default:
        return null;
    }
  });
}

/** Rendered inside a parent <T> (so it wraps with the meta spacer). */
export const RichText = memo(function RichText({ text, highlight }) {
  const segments = useMemo(() => parseRichText(text), [text]);
  return <Segments segments={segments} highlight={highlight} />;
});

export function useMetaStatus(m, mine, chat) {
  return mine && !m.deletedAt ? (m.failed ? 'failed' : tickStatus(m, chat)) : null;
}

/** The meta row: [star] [Edited] time [ticks]. */
export function Meta({ m, mine, chat, variant = 'inline', style }) {
  const { tw, c, shadow } = useTheme();
  const status = useMetaStatus(m, mine, chat);
  const color =
    variant === 'overlay' ? '#ffffff' : mine ? c['bubble-out-meta'] : c['bubble-in-meta'];
  return (
    <View
      pointerEvents="none"
      style={[
        tw`flex-row items-center gap-1`,
        variant === 'overlay' ? tw`rounded-full bg-black/35 px-1.5 py-1` : null,
        variant === 'pill'
          ? [
              tw`rounded-full px-2 py-1`,
              { backgroundColor: mine ? c['bubble-out'] : c['bubble-in'] },
              shadow.bubble,
            ]
          : null,
        style,
      ]}
    >
      {m.starred ? <Star size={12} color={color} fill={color} strokeWidth={2} /> : null}
      {m.editedAt && !m.deletedAt ? (
        <T style={[tw`text-[11px]`, { color, lineHeight: 13 }]}>Edited</T>
      ) : null}
      <T style={[tw`text-[11px]`, { color, lineHeight: 13, fontVariant: ['tabular-nums'] }]}>
        {formatTime(m.createdAt)}
      </T>
      {status ? (
        <Ticks
          status={status}
          size={16}
          color={color}
          readColor={variant === 'overlay' ? '#7dd3fc' : undefined}
        />
      ) : null}
    </View>
  );
}

/**
 * Invisible text appended to the last line (inside the text's <T>) that reserves the meta's
 * width, so the absolutely positioned meta never overlaps the text.
 */
export function MetaSpacer({ m, mine }) {
  const edited = m.editedAt && !m.deletedAt;
  // The web's `ml-2` gap, then the meta's own content at 11px: star (12px + gap), "Edited ",
  // the time, ticks (16px + gap); em/en spaces stand in for the icons.
  const pad = `\u00A0\u00A0\u00A0${m.starred ? '\u2003\u2002' : ''}${edited ? 'Edited\u00A0' : ''}${formatTime(m.createdAt)}${mine ? '\u2003\u2003\u2002' : '\u2002'}`;
  return <T style={{ fontSize: 11, color: 'transparent' }}>{pad}</T>;
}

/** Visible meta in the bubble's bottom-right corner (pair with `MetaSpacer`). */
export function CornerMeta({ m, mine, chat }) {
  return (
    <Meta m={m} mine={mine} chat={chat} style={{ position: 'absolute', right: 8, bottom: 6 }} />
  );
}
