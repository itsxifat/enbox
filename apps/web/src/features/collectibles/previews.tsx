/**
 * Small live previews of cosmetics on my own profile, shared by the Collectibles gallery and
 * the editor's pickers: a decoration on my avatar, an effect over a mini card, a nameplate
 * behind a member-list row, a name style on my name. Motion is explicit (`hot`): cards and
 * tiles animate only while hovered or focused (`useHot`), the big previews always.
 */
import { useMemo, useState, type FocusEvent } from 'react';
import { userDisplayName, type NameStyle } from '@enbox/shared';
import { Nameplate, ProfileEffect, StyledName } from '@/components/cosmetics';
import { Avatar } from '@/components/ui';
import { profileGradient, type ProfileCardUser } from '@/features/profile/model';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Collectible } from './catalog';

type Motion = 'always' | 'never';

/** Hover / focus-within state for a card or tile, with the handlers to spread on it. */
export function useHot() {
  const [hot, setHot] = useState(false);
  const handlers = useMemo(
    () => ({
      onPointerEnter: () => setHot(true),
      onPointerLeave: () => setHot(false),
      onFocus: () => setHot(true),
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(false);
      },
    }),
    [],
  );
  return [hot, handlers] as const;
}

export function DecorationPreview({
  user,
  id,
  size = 80,
  animate = 'always',
}: {
  user: ProfileCardUser;
  id: string | null;
  size?: number;
  animate?: Motion;
}) {
  return (
    <Avatar
      src={user.avatarUrl}
      animatedSrc={user.avatarAnimatedUrl}
      name={userDisplayName(user)}
      colorSeed={user.id}
      size={size}
      decoration={id}
      animate={animate}
    />
  );
}

/** A small profile card (banner, avatar, name) with an effect over it. */
export function MiniCard({
  user,
  effect,
  play = 'loop',
  className,
}: {
  user: ProfileCardUser;
  effect: string | null;
  play?: 'loop' | 'still' | 'once';
  className?: string;
}) {
  const banner = mediaUrl(user.bannerUrl);
  return (
    <div
      className={cn('relative isolate overflow-hidden rounded-xl bg-elevated text-left', className)}
      data-testid="mini-card"
    >
      <div
        className="w-full"
        style={{
          aspectRatio: '5 / 2',
          background: profileGradient(user.profileColor, user.accentColor),
        }}
      >
        {banner ? (
          <img src={banner} alt="" className="size-full object-cover" draggable={false} />
        ) : null}
      </div>
      <div className="px-3 pb-3">
        <span className="-mt-5 inline-flex rounded-full bg-elevated ring-4 ring-elevated">
          <DecorationPreview
            user={user}
            id={user.avatarDecoration ?? null}
            size={40}
            animate="never"
          />
        </span>
        <StyledName
          name={userDisplayName(user)}
          style={user.nameStyle}
          mode="full"
          className="mt-1 block truncate text-[14px] font-semibold text-fg"
        />
        <span className="mt-1.5 block h-1.5 w-14 rounded-full bg-line" aria-hidden />
        <span className="mt-1 block h-1.5 w-24 rounded-full bg-line" aria-hidden />
      </div>
      {effect ? (
        <ProfileEffect id={effect} play={play} className="pointer-events-none absolute inset-0" />
      ) : null}
    </div>
  );
}

/** A member-list row (avatar, styled name) with a nameplate behind it. */
export function NameplateRow({
  user,
  id,
  animate = 'always',
  className,
  subtitle,
}: {
  user: ProfileCardUser;
  id: string | null;
  animate?: Motion;
  className?: string;
  subtitle?: string;
}) {
  return (
    <div
      className={cn(
        'relative isolate flex h-11 items-center gap-3 overflow-hidden rounded-lg px-2',
        className,
      )}
      data-testid="nameplate-row"
    >
      {id ? <Nameplate id={id} animate={animate} className="rounded-lg" /> : null}
      <span className="relative inline-flex">
        <DecorationPreview
          user={user}
          id={user.avatarDecoration ?? null}
          size={32}
          animate={animate}
        />
      </span>
      <span className="relative min-w-0 flex-1 leading-tight">
        <StyledName
          name={userDisplayName(user)}
          style={user.nameStyle}
          mode="full"
          className="block truncate text-[15px] font-medium text-fg"
        />
        {subtitle ? (
          <span className="block truncate text-[12px] text-subtle">{subtitle}</span>
        ) : null}
      </span>
    </div>
  );
}

/** A name in a style, on a dark plate so light colours read in either theme. */
export function NameStylePreview({
  name,
  style,
  className,
}: {
  name: string;
  style: NameStyle | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-center rounded-xl bg-[#1e1f22] px-3 py-4 text-[#f2f3f5]',
        className,
      )}
    >
      <StyledName
        name={name}
        style={style}
        mode="full"
        className="truncate text-[20px] font-semibold"
      />
    </div>
  );
}

/** A gallery card's / picker tile's preview of one item on my profile. */
export function CollectibleThumb({
  item,
  user,
  hot,
}: {
  item: Collectible;
  user: ProfileCardUser;
  hot: boolean;
}) {
  const motion: Motion = hot ? 'always' : 'never';
  switch (item.kind) {
    case 'decoration':
      return (
        <div className="flex aspect-[4/3] items-center justify-center">
          <DecorationPreview user={user} id={item.id} size={64} animate={motion} />
        </div>
      );
    case 'effect':
      return <MiniCard user={user} effect={item.id} play={hot ? 'loop' : 'still'} />;
    case 'nameplate':
      return (
        <div className="flex aspect-[4/3] items-center px-1">
          <NameplateRow user={user} id={item.id} animate={motion} className="w-full" />
        </div>
      );
    case 'nameStyle':
      return (
        <div className="flex aspect-[4/3] items-center px-1">
          <NameStylePreview
            name={userDisplayName(user)}
            style={item.style ?? null}
            className="w-full"
          />
        </div>
      );
  }
}
