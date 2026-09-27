/**
 * Avatar (web components/ui/Avatar.tsx): image or initials/icon fallback on a deterministic
 * colour, community rounded-square, status ring, presence badge (online dot, idle moon, dnd
 * bar). Animated avatars (GIF / animated WebP / APNG) show their static poster unless
 * `animate="always"` or the device pref "Autoplay animated media" is "Always".
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Megaphone, UserRound, UsersRound } from 'lucide-react-native';
import { mediaUrl } from '@/lib/api';
import { initials } from '@/lib/format';
import { useUi } from '@/stores/ui';
import { useTheme } from '@/theme';
import { Icon } from '@/components/icons';
import { T } from './primitives';

export const AVATAR_PX = { xs: 24, sm: 32, md: 40, lg: 48, xl: 64, '2xl': 96, '3xl': 144 };

/** Fallback background palette (white text passes AA on all of them). */
const PALETTE = [
  '#6d5dfc',
  '#0e7fc0',
  '#0f8a6a',
  '#c2410c',
  '#be185d',
  '#7c3aed',
  '#0f766e',
  '#b45309',
  '#4f46e5',
  '#a21caf',
];

/** Deterministic color for a seed (user/chat id or name). */
export function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function Avatar({
  src,
  name,
  colorSeed,
  size = 'md',
  kind = 'user',
  online,
  ring,
  animatedSrc,
  animate = 'hover',
  presence,
  style,
  ringColor,
}) {
  const { c, dark } = useTheme();
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useUi((s) => s.prefs.reduceMotion === 'on');
  const px = typeof size === 'number' ? size : AVATAR_PX[size];
  const poster = mediaUrl(src);
  const animated = mediaUrl(animatedSrc);
  const playing =
    !!animated &&
    !reduceMotion &&
    animate !== 'never' &&
    autoplay !== 'never' &&
    (animate === 'always' || autoplay === 'always');
  const shown = playing ? animated : poster;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [shown]);
  const showImage = !!shown && !failed;

  const radius = kind === 'community' ? px * 0.28 : px / 2;
  const IconC =
    kind === 'group' || kind === 'community'
      ? UsersRound
      : kind === 'channel'
        ? Megaphone
        : UserRound;
  const text = initials(name);
  const dot = Math.max(8, Math.round(px * 0.26));
  const state = presence !== undefined ? presence : online ? 'online' : null;
  const badge = state && state !== 'offline' ? state : null;
  const ringW = ring ? 2 : 0;
  const gap = ring ? 2 : 0;

  const inner = (
    <View
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: showImage
          ? c['surface-2']
          : kind === 'user'
            ? avatarColor(colorSeed ?? name ?? '?')
            : c['line-strong'],
      }}
    >
      {showImage ? (
        <Image
          source={{ uri: shown }}
          style={{ width: px, height: px }}
          contentFit="cover"
          autoplay={playing}
          cachePolicy="memory-disk"
          recyclingKey={shown}
          onError={() => setFailed(true)}
          transition={0}
        />
      ) : kind === 'user' && text !== '?' ? (
        <T
          style={{
            color: '#ffffff',
            fontWeight: '600',
            fontSize: Math.max(10, Math.round(px * (text.length > 1 ? 0.38 : 0.44))),
            lineHeight: Math.max(12, Math.round(px * 0.5)),
          }}
        >
          {text}
        </T>
      ) : (
        <Icon
          icon={IconC}
          size={Math.round(px * 0.52)}
          strokeWidth={1.75}
          scale
          color={kind === 'user' || !dark ? '#ffffff' : c.fg}
        />
      )}
    </View>
  );

  return (
    <View style={[{ width: px, height: px }, style]}>
      {ring ? (
        <View
          style={{
            position: 'absolute',
            left: -(ringW + gap),
            top: -(ringW + gap),
            width: px + (ringW + gap) * 2,
            height: px + (ringW + gap) * 2,
            borderRadius: kind === 'community' ? radius + 4 : (px + 8) / 2,
            borderWidth: ringW,
            borderColor: ringColor ?? (ring === 'unseen' ? c.brand : c['line-strong']),
          }}
        />
      ) : null}
      {inner}
      {badge ? <PresenceBadge state={badge} size={dot} /> : null}
    </View>
  );
}

/**
 * Presence glyphs in the avatar's corner: online = green dot, idle = amber crescent (the
 * surface-coloured cut-out makes the moon), dnd = red disc with a surface-coloured bar.
 */
export function PresenceBadge({ state, size, style }) {
  const { c } = useTheme();
  const outer = size + 4;
  return (
    <View
      style={[
        {
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: outer,
          height: outer,
          borderRadius: outer,
          borderWidth: 2,
          borderColor: c.surface,
          overflow: 'hidden',
          backgroundColor: state === 'online' ? c.online : state === 'idle' ? c.warning : c.danger,
        },
        style,
      ]}
    >
      {state === 'idle' ? (
        <View
          style={{
            position: 'absolute',
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size,
            left: -size * 0.12,
            top: -size * 0.12,
            backgroundColor: c.surface,
          }}
        />
      ) : state === 'dnd' ? (
        <View
          style={{
            position: 'absolute',
            width: size * 0.62,
            height: Math.max(2, size * 0.18),
            borderRadius: 2,
            left: size * 0.19,
            top: size / 2 - Math.max(2, size * 0.18) / 2,
            backgroundColor: c.surface,
          }}
        />
      ) : null}
    </View>
  );
}
