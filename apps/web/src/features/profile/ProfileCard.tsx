/**
 * The profile popout (Discord 2025 layout, ~300px): a themed surface (profile → accent
 * gradient with contrast-aware ink, else the plain surface), the banner (image, or the
 * profile colour), the decorated 80px avatar cutting into it with the presence badge, the
 * custom status as a thought bubble beside it, the styled name with the server tag they wear,
 * @username / pronouns, badges, the markdown bio (clamped), roles and both join dates in a
 * Space, the mutuals line, my private note and "Message @name". Others get a "..." menu (View
 * Full Profile, contact, calls, copy username / id, block) on the banner; my own card keeps
 * availability, custom status and Edit profile. The profile effect plays once on open and
 * again on hover.
 *
 * Rendered by ProfilePopover (popover / sheet), and in `preview` mode — no actions, effects on
 * loop — as the live preview of the profile editor (`<ProfileCard user={draft} preview />`).
 *
 * In a Space (`spaceId`) the member's per-Space profile wins (avatar, banner, bio, pronouns,
 * colours, decoration, effect) with a "View Main Profile" toggle back. Privacy: fields the
 * subject hides arrive as null and are simply not rendered.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Pencil, Smile, UserPlus, UserRoundX } from 'lucide-react';
import {
  activePresenceNote,
  profileBadges,
  type ID,
  type Presence,
  type PresenceNote,
  type UserProfile,
  type UserPublic,
} from '@enbox/shared';
import { presenceBadge } from '@/components/common/UserAvatar';
import { ProfileEffect, StyledName } from '@/components/cosmetics';
import { ServerTagPill } from '@/components/cosmetics/TagPill/ServerTagPill';
import {
  BadgeRow,
  MemberSince,
  ProfileAvatar,
  ProfileBanner,
  ProfilePanel,
  StatusBubble,
  ThemedProfileSurface,
  profileTheme,
  surfaceRing,
} from '@/components/profile';
import { Button, IconButton } from '@/components/ui';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { cn } from '@/lib/cn';
import { formatPresenceNote, presenceLabel } from '@/lib/format';
import { AvailabilityPicker } from './AvailabilityPicker';
import type { ProfileCardUser } from './model';
import type { FullProfileTab } from './open';
import { ProfileMessageInput } from './ProfileMessageInput';
import { ProfileMoreMenu } from './ProfileMoreMenu';
import { ProfileNote } from './ProfileNote';
import { RoleChips } from './RoleChips';
import { useDirectActions } from './useDirectActions';
import { useProfileBannerSrc } from './useProfileBanner';
import { useProfileView } from './useProfileView';

export interface ProfileCardProps {
  user: ProfileCardUser;
  /** Live presence (the caller subscribes); falls back to `user.presenceState/presenceNote`. */
  presence?: Presence | null;
  /** My own card: availability, custom status and Edit profile instead of the contact actions. */
  self?: boolean;
  /** Settings preview: no actions, the profile effect on loop. */
  preview?: boolean;
  /** Opened inside a Space: nickname, roles, join date and the per-Space profile. */
  spaceId?: ID | null;
  /** The full profile (mutual counts); omit to hide the mutuals line. */
  profile?: UserProfile | null;
  /** Called right before the card navigates somewhere (the host closes the popover). */
  onNavigate?: () => void;
  /** Self card: open the custom-status dialog (rendered by the host, outside the popover). */
  onSetStatus?: () => void;
  /** Add / edit contact dialog (rendered by the host, outside the popover). */
  onEditContact?: (user: UserPublic) => void;
  /** Open the full profile (avatar, "View Full Profile", the mutuals line). */
  onOpenFull?: (tab?: FullProfileTab) => void;
  className?: string;
}

const LABEL = 'section-label mb-1';
const ROW =
  'card-inset flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand';
const LINK =
  'rounded text-[12.5px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-brand';

/** Banner heights: an image or a themed colour, else the short header. */
const BANNER_TALL = 105;
const BANNER_SHORT = 60;
const AVATAR = 80;
const RING = 6;

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function ProfileCard({
  user,
  presence,
  self = false,
  preview = false,
  spaceId,
  profile,
  onNavigate,
  onSetStatus,
  onEditContact,
  onOpenFull,
  className,
}: ProfileCardProps) {
  const navigate = useNavigate();
  const view = useProfileView(user, spaceId);
  const { shown, name } = view;
  const deleted = user.isDeleted;
  const theme = deleted ? null : profileTheme(shown.profileColor, shown.accentColor);
  const ring = surfaceRing(theme);
  const banner = useProfileBannerSrc(deleted ? null : shown);
  const bannerHeight = banner || theme ? BANNER_TALL : BANNER_SHORT;
  const state = deleted ? null : presence ? presenceBadge(presence) : user.presenceState;
  const note = deleted ? null : activePresenceNote(presence ? presence.note : user.presenceNote);
  const [replay, setReplay] = useState(0);
  const others = !preview && !self && !deleted;
  const direct = useDirectActions(user, onNavigate);
  const openFull =
    !preview && !deleted
      ? (tab?: FullProfileTab) => {
          if (onOpenFull) onOpenFull(tab);
          else {
            onNavigate?.();
            void navigate(`/u/${user.username}`);
          }
        }
      : undefined;

  return (
    <ThemedProfileSurface
      theme={theme}
      className={className}
      data-testid="profile-card"
      data-user-id={user.id}
      onPointerEnter={() => setReplay((n) => n + 1)}
    >
      <ProfileBanner
        src={banner}
        color={theme?.primary ?? shown.profileColor ?? 'var(--brand)'}
        height={bannerHeight}
        data-testid="card-banner"
      >
        {others ? (
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            {!user.isContact && onEditContact ? (
              <IconButton
                icon={UserPlus}
                label="Add to contacts"
                size="sm"
                variant="glass"
                onClick={() => onEditContact(user)}
              />
            ) : null}
            <ProfileMoreMenu
              user={user}
              onViewFull={openFull ? () => openFull() : undefined}
              onEditContact={onEditContact}
              canCall={direct.canCall && !direct.busy}
              onCall={(type) => void direct.call(type)}
            />
          </div>
        ) : null}
      </ProfileBanner>

      <ProfilePanel theme={theme}>
        <div className="relative px-4" style={{ height: AVATAR / 2 + RING + 4 }}>
          <ProfileAvatar
            className="absolute left-[10px]"
            style={{ top: -(AVATAR / 2 + RING) }}
            name={name}
            colorSeed={user.id}
            src={deleted ? null : shown.avatarUrl}
            animatedSrc={deleted ? null : shown.avatarAnimatedUrl}
            decoration={deleted ? null : shown.avatarDecoration}
            presence={state}
            size={AVATAR}
            ring={ring}
            ringWidth={RING}
            onClick={openFull ? () => openFull() : undefined}
            label={openFull ? `View full profile of ${name}` : undefined}
          />
          {note ? (
            <StatusBubble
              note={note}
              background={ring}
              className="absolute top-[-26px] left-[114px] max-w-[calc(100%-126px)]"
              onClick={self && !preview ? onSetStatus : undefined}
              label="Edit custom status"
              data-testid="card-note"
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
          <div className="min-w-0">
            <h2
              className="text-[20px] leading-6 font-bold break-words text-fg"
              data-testid="card-name"
            >
              <StyledName name={name} style={deleted ? null : shown.nameStyle} mode="full" />
              {/* Mine from the users store; others' (and previews) come with the user. */}
              {!deleted ? (
                <ServerTagPill
                  userId={user.id}
                  tag={self && !preview ? undefined : (user.spaceTag ?? null)}
                  size="md"
                  className="ml-1.5"
                />
              ) : null}
            </h2>
            {view.alias ? <p className="truncate text-[13.5px] text-muted">~{view.alias}</p> : null}
            {!deleted ? <p className="truncate text-[14px] text-fg">@{user.username}</p> : null}
            {shown.pronouns && !deleted ? (
              <p className="text-[13px] text-muted" data-testid="card-pronouns">
                {shown.pronouns}
              </p>
            ) : null}
            {state && state !== 'offline' ? (
              <span className="sr-only" data-testid="card-state">
                {capitalize(presenceLabel(state))}
              </span>
            ) : null}
            <BadgeRow badges={profileBadges(user)} owner={view.owner} className="mt-1.5" />
            {view.hasOverrides ? (
              <button
                type="button"
                className={cn(LINK, 'mt-1.5')}
                onClick={() => view.setShowMain(!view.showMain)}
                aria-pressed={view.showMain}
              >
                {view.showMain ? 'View Space Profile' : 'View Main Profile'}
              </button>
            ) : null}
          </div>

          {shown.bio && !deleted ? (
            <section>
              <h3 className={LABEL}>About Me</h3>
              <div
                className="line-clamp-6 text-[14px] leading-[1.375] break-words whitespace-pre-wrap text-fg"
                data-testid="card-bio"
              >
                <RichText text={shown.bio} />
              </div>
            </section>
          ) : null}
          {user.about && !deleted ? (
            <section>
              <h3 className={LABEL}>About</h3>
              <p className="text-[14px] break-words text-fg" data-testid="card-about">
                {user.about}
              </p>
            </section>
          ) : null}
          {view.space && view.member && !deleted ? (
            <RoleChips space={view.space} member={view.member} />
          ) : null}
          {user.createdAt ? (
            <MemberSince
              createdAt={user.createdAt}
              space={view.space}
              joinedAt={view.member?.joinedAt}
            />
          ) : null}
          {profile && others ? <Mutuals profile={profile} onOpen={openFull} /> : null}
          {others ? <ProfileNote userId={user.id} /> : null}

          {preview ? null : deleted ? (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <UserRoundX size={16} aria-hidden /> This account was deleted.
            </p>
          ) : self ? (
            <SelfActions note={note} onNavigate={onNavigate} onSetStatus={onSetStatus} />
          ) : (
            <ProfileMessageInput user={user} name={name} onNavigate={onNavigate} />
          )}
        </div>
      </ProfilePanel>
      <ProfileEffect
        id={deleted ? null : shown.profileEffect}
        play={preview ? 'loop' : 'once'}
        replayKey={replay}
        className="pointer-events-none absolute inset-0 z-10"
      />
    </ThemedProfileSurface>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 Mutual Friends • 3 Mutual Spaces • 1 Group in common", each opening its tab. */
function Mutuals({
  profile,
  onOpen,
}: {
  profile: UserProfile;
  onOpen?: (tab: FullProfileTab) => void;
}) {
  const parts: { tab: FullProfileTab; text: string }[] = [];
  if (profile.mutualFriends.length)
    parts.push({ tab: 'friends', text: plural(profile.mutualFriends.length, 'Mutual Friend', 'Mutual Friends') });
  if (profile.mutualSpaces.length)
    parts.push({ tab: 'spaces', text: plural(profile.mutualSpaces.length, 'Mutual Space', 'Mutual Spaces') });
  if (profile.mutualGroupCount)
    parts.push({ tab: 'groups', text: plural(profile.mutualGroupCount, 'Group in common', 'Groups in common') });
  if (!parts.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted" data-testid="card-mutuals">
      {parts.map((p, i) => (
        <span key={p.tab} className="inline-flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden className="size-1 rounded-full bg-subtle" /> : null}
          {onOpen ? (
            <button type="button" className={cn(LINK, 'text-muted hover:text-fg')} onClick={() => onOpen(p.tab)}>
              {p.text}
            </button>
          ) : (
            <span className="text-[12.5px]">{p.text}</span>
          )}
        </span>
      ))}
    </p>
  );
}

function SelfActions({
  note,
  onNavigate,
  onSetStatus,
}: {
  note: PresenceNote | null;
  onNavigate?: () => void;
  onSetStatus?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      <AvailabilityPicker />
      {onSetStatus ? (
        <button type="button" onClick={onSetStatus} className={ROW} data-testid="set-status">
          <Smile size={18} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-fg">
            {note ? formatPresenceNote(note) : 'Set a custom status'}
          </span>
          {note ? <span className="text-[12px] text-muted">Edit</span> : null}
        </button>
      ) : null}
      <Button
        variant="soft"
        leftIcon={Pencil}
        fullWidth
        onClick={() => {
          onNavigate?.();
          void navigate('/settings/profile');
        }}
      >
        Edit profile
      </Button>
    </>
  );
}
