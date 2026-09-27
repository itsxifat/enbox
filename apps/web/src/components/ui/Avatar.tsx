import { useEffect, useRef, useState, type RefObject } from 'react';
import { Megaphone, UserRound, UsersRound } from 'lucide-react';
import type { PresenceState } from '@enbox/shared';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { useUi } from '@/stores/ui';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type AvatarKind = 'user' | 'group' | 'channel' | 'community';
/** When an animated avatar plays (see `AvatarProps.animate`). */
export type AvatarAnimate = 'hover' | 'always' | 'never';

export const AVATAR_PX: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
  '2xl': 96,
  '3xl': 144,
};

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
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

const PRESENCE_LABEL: Record<Exclude<PresenceState, 'offline'>, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
};

export interface AvatarProps {
  /** Image URL (relative `/uploads/…` is resolved against the API origin). */
  src?: string | null;
  /** Used for initials and alt text. */
  name: string;
  /** Seed for the fallback color (defaults to name). Pass the user/chat id for stability. */
  colorSeed?: string;
  size?: AvatarSize | number;
  /** Fallback glyph when there is no image: initials for users, icons for the rest. */
  kind?: AvatarKind;
  /** Green presence dot (kept for callers without a state; `presence` wins when given). */
  online?: boolean;
  /** Status ring: 'unseen' (brand) / 'seen' (muted). */
  ring?: 'unseen' | 'seen' | null;
  className?: string;
  /** Decorative (next to a visible name) — hides it from screen readers. */
  decorative?: boolean;
  /** The animated original (GIF / animated WebP / APNG); `src` stays its static poster. */
  animatedSrc?: string | null;
  /**
   * When `animatedSrc` is shown instead of the poster: 'hover' (default) while the avatar — or
   * the closest ancestor with `data-animate-avatars` (a list row, the profile card) — is
   * hovered or has focus within; 'always' (profile card, lightbox); 'never'. The device pref
   * `autoplayAnimatedMedia` ('always' plays everywhere, 'never' nowhere), reduced motion and a
   * hidden or unfocused app override this: the poster shows.
   */
  animate?: AvatarAnimate;
  /** Presence badge: online dot, idle moon, dnd minus; 'offline' / null = none. */
  presence?: PresenceState | null;
}

/**
 * Only an avatar with an animation subscribes to the prefs and the app's focus (each such
 * subscription re-renders on every window focus change): the static ones — nearly all of
 * them, in member lists up to the group cap — render without a single subscription.
 */
export function Avatar(props: AvatarProps) {
  if (props.animatedSrc) return <AnimatedAvatar {...props} />;
  return <AvatarShell {...props} shown={mediaUrl(props.src)} />;
}

/** Poster by default, the animation only while it is wanted AND allowed (see `AvatarProps.animate`). */
function AnimatedAvatar(props: AvatarProps) {
  const { src, animatedSrc, animate = 'hover' } = props;
  const url = mediaUrl(src);
  const animatedUrl = mediaUrl(animatedSrc);
  const [animatedFailed, setAnimatedFailed] = useState(false);
  useEffect(() => setAnimatedFailed(false), [animatedUrl]);

  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const canAnimate =
    !!animatedUrl &&
    !animatedFailed &&
    animate !== 'never' &&
    autoplay !== 'never' &&
    !reduceMotion &&
    appVisible;
  const onHover = canAnimate && animate === 'hover' && autoplay !== 'always';
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (!onHover) return;
    const self = rootRef.current;
    if (!self) return;
    const host = self.closest<HTMLElement>('[data-animate-avatars]') ?? self;
    const on = () => setHot(true);
    const off = () => setHot(false);
    host.addEventListener('pointerenter', on);
    host.addEventListener('pointerleave', off);
    host.addEventListener('focusin', on);
    host.addEventListener('focusout', off);
    return () => {
      host.removeEventListener('pointerenter', on);
      host.removeEventListener('pointerleave', off);
      host.removeEventListener('focusin', on);
      host.removeEventListener('focusout', off);
      setHot(false);
    };
  }, [onHover]);
  const playing = canAnimate && (!onHover || hot);
  return (
    <AvatarShell
      {...props}
      shown={playing ? animatedUrl : url}
      playing={playing}
      onPlayingError={() => setAnimatedFailed(true)}
      rootRef={rootRef}
      animatedState={playing ? 'playing' : 'poster'}
    />
  );
}

interface AvatarShellProps extends AvatarProps {
  /** The image to show now: the poster, or the animation while it plays. */
  shown: string | null | undefined;
  playing?: boolean;
  /** The playing animation failed to load (the poster takes over). */
  onPlayingError?: () => void;
  rootRef?: RefObject<HTMLSpanElement | null>;
  /** `data-animated` on the root: whether an animated avatar is playing or showing its poster. */
  animatedState?: 'playing' | 'poster';
}

/** The frame, image or fallback glyph, and the presence badge — no subscriptions. */
function AvatarShell({
  src,
  name,
  colorSeed,
  size = 'md',
  kind = 'user',
  online,
  ring,
  className,
  decorative = true,
  presence,
  shown,
  playing = false,
  onPlayingError,
  rootRef,
  animatedState,
}: AvatarShellProps) {
  const px = typeof size === 'number' ? size : AVATAR_PX[size];
  const url = mediaUrl(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const showImage = !!shown && !failed;

  // Communities use a rounded square like WhatsApp; everything else is a circle.
  const shape = kind === 'community' ? 'rounded-[28%]' : 'rounded-full';
  const Icon =
    kind === 'group'
      ? UsersRound
      : kind === 'channel'
        ? Megaphone
        : kind === 'community'
          ? UsersRound
          : UserRound;
  const text = initials(name);
  const dot = Math.max(8, Math.round(px * 0.26));
  const state: PresenceState | null = presence !== undefined ? presence : online ? 'online' : null;
  const badge = state && state !== 'offline' ? state : null;

  return (
    <span
      ref={rootRef}
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: px, height: px }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      data-animated={animatedState}
    >
      <span
        className={cn(
          'flex size-full items-center justify-center overflow-hidden font-semibold text-white select-none',
          shape,
          ring === 'unseen' && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
          ring === 'seen' && 'ring-2 ring-line-strong ring-offset-2 ring-offset-surface',
        )}
        style={{
          backgroundColor: showImage
            ? 'var(--surface-2)'
            : kind === 'user'
              ? avatarColor(colorSeed ?? name)
              : 'var(--line-strong)',
          fontSize: Math.max(10, Math.round(px * (text.length > 1 ? 0.38 : 0.44))),
        }}
      >
        {showImage ? (
          <img
            src={shown}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => (playing ? onPlayingError?.() : setFailed(true))}
          />
        ) : kind === 'user' && text !== '?' ? (
          <span aria-hidden>{text}</span>
        ) : (
          <Icon
            size={Math.round(px * 0.52)}
            strokeWidth={1.75}
            nonScalingStroke={false}
            className={kind === 'user' ? 'text-white' : 'text-white dark:text-fg'}
            aria-hidden
          />
        )}
      </span>
      {badge ? (
        <PresenceBadge
          state={badge}
          size={dot}
          label={decorative ? undefined : PRESENCE_LABEL[badge]}
        />
      ) : null}
    </span>
  );
}

/**
 * Presence glyphs in the avatar's corner: online = green dot, idle = amber crescent (the
 * surface-coloured cut-out makes the moon), dnd = red disc with a surface-coloured bar.
 */
function PresenceBadge({
  state,
  size,
  label,
}: {
  state: Exclude<PresenceState, 'offline'>;
  size: number;
  label?: string;
}) {
  return (
    <span
      className={cn(
        'absolute right-0 bottom-0 overflow-hidden rounded-full ring-2 ring-surface',
        state === 'online' && 'bg-online',
        state === 'idle' && 'bg-warning',
        state === 'dnd' && 'bg-danger',
      )}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-presence={state}
    >
      {state === 'idle' ? (
        <span
          className="absolute rounded-full bg-surface"
          style={{ width: size * 0.7, height: size * 0.7, left: -size * 0.12, top: -size * 0.12 }}
        />
      ) : state === 'dnd' ? (
        <span
          className="absolute rounded-full bg-surface"
          style={{
            width: size * 0.62,
            height: Math.max(2, size * 0.18),
            left: size * 0.19,
            top: size / 2 - Math.max(2, size * 0.18) / 2,
          }}
        />
      ) : null}
    </span>
  );
}
