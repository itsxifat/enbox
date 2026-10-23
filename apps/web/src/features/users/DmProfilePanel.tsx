/**
 * Discord's user profile panel beside a DM (the header's "Show User Profile"): the banner, the
 * decorated avatar with presence and custom status, the styled name with the server tag they
 * wear, @username and pronouns, badges, About Me and Member Since, Mutual Spaces and Mutual
 * Friends (counts that expand into lists), my private note and View Full Profile. Docked on the
 * right inside the conversation card, like the search results (which replace it while open).
 * Data: the users store (live) and `GET /api/users/:userId/profile` (mutuals, note).
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, IdCard } from 'lucide-react';
import {
  MUTUALS_LIMIT,
  activePresenceNote,
  profileBadges,
  userDisplayName,
  type ChatSummary,
  type ID,
  type UserProfile,
} from '@enbox/shared';
import { presenceBadge } from '@/components/common/UserAvatar';
import { StyledName } from '@/components/cosmetics';
import { ServerTagPill } from '@/components/cosmetics/TagPill/ServerTagPill';
import {
  BadgeRow,
  MemberSince,
  ProfileAvatar,
  ProfileBanner,
  StatusBubble,
  profileTheme,
} from '@/components/profile';
import { Avatar, Button, Skeleton } from '@/components/ui';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { openFullProfile, openProfile } from '@/features/profile/open';
import { ProfileNote } from '@/features/profile/ProfileNote';
import { useUserProfile } from '@/features/profile/profileStore';
import { useProfileBannerSrc } from '@/features/profile/useProfileBanner';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useSidePanel } from '@/stores/sidePanel';
import { usePresence, useUser } from '@/stores/users';
import { DM_PROFILE_QUERY, dmProfilePeer, useDmProfilePanel } from './profilePanel';

const AVATAR = 80;
const RING = 6;
const ROW =
  'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

/** The panel beside `chat` when it applies: a DM, a wide window, toggled on, no search open. */
export function DmProfileDock({ chat }: { chat: ChatSummary }) {
  const wide = useMediaQuery(DM_PROFILE_QUERY);
  const open = useDmProfilePanel((s) => s.open);
  const me = useAuth((s) => s.user?.id);
  const searching = useSidePanel(
    (s) =>
      s.panel?.kind === 'search' &&
      s.panel.scope.kind === 'chat' &&
      s.panel.scope.chatId === chat.id,
  );
  const peer = dmProfilePeer(chat, me);
  if (!wide || !open || searching || !peer) return null;
  return <DmProfilePanel userId={peer} />;
}

export function DmProfilePanel({ userId }: { userId: ID }) {
  const user = useUser(userId);
  const presence = usePresence(userId);
  const { profile } = useUserProfile(userId);
  const [hover, setHover] = useState(false);
  const banner = useProfileBannerSrc(user, hover);

  if (!user)
    return (
      <Panel name="Profile">
        <div className="flex flex-col gap-3 p-4" aria-busy>
          <Skeleton className="-mx-4 -mt-4 h-[120px] rounded-none" />
          <Skeleton circle className="-mt-12 size-20" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </Panel>
    );

  const name = userDisplayName(user);
  const theme = profileTheme(user.profileColor, user.accentColor);
  // Without a theme the panel's own colour cuts the avatar out of the banner.
  const ring = theme ? theme.ring : 'var(--surface-2)';
  const card = theme ? 'card-inset p-3' : 'rounded-xl bg-surface p-3';
  const state = presence ? presenceBadge(presence) : user.presenceState;
  const note = activePresenceNote(presence ? presence.note : user.presenceNote);
  return (
    <Panel name={`${name}'s profile`} onHover={setHover}>
      <div
        className="relative isolate flex min-h-full flex-col text-fg"
        data-themed={theme ? theme.ink : undefined}
        style={theme ? { background: theme.background, ...theme.vars } : undefined}
      >
        <ProfileBanner
          src={banner}
          color={theme?.primary ?? user.profileColor ?? 'var(--brand)'}
          height={120}
          data-testid="dm-profile-banner"
        />
        <div className="relative px-4" style={{ height: AVATAR / 2 + RING + 4 }}>
          <ProfileAvatar
            className="absolute left-[10px]"
            style={{ top: -(AVATAR / 2 + RING) }}
            name={name}
            colorSeed={user.id}
            src={user.avatarUrl}
            animatedSrc={user.avatarAnimatedUrl}
            decoration={user.avatarDecoration}
            presence={state}
            size={AVATAR}
            ring={ring}
            ringWidth={RING}
            onClick={() => openFullProfile(user.id)}
            label={`View full profile of ${name}`}
          />
          {note ? (
            <StatusBubble
              note={note}
              background={ring}
              className="absolute top-[-26px] left-[114px] max-w-[calc(100%-126px)]"
            />
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3 px-4 pt-2 pb-4">
          <div className="min-w-0">
            <h2
              className="text-[20px] leading-6 font-bold break-words"
              data-testid="dm-profile-name"
            >
              <StyledName name={name} style={user.nameStyle} mode="full" />
              <ServerTagPill
                userId={user.id}
                tag={user.spaceTag ?? null}
                size="md"
                className="ml-1.5"
              />
            </h2>
            {/* A friend nickname shows; their own name under it, like the profile card. */}
            {name !== user.displayName ? (
              <p className="truncate text-[13.5px] text-muted">~{user.displayName}</p>
            ) : null}
            <p className="truncate text-[14px]">
              {user.username}
              {user.pronouns ? <span className="text-muted"> • {user.pronouns}</span> : null}
            </p>
            <BadgeRow badges={profileBadges(user)} className="mt-1.5" />
          </div>

          {user.bio || user.createdAt ? (
            <section className={cn(card, 'flex flex-col gap-3')}>
              {user.bio ? (
                <div>
                  <h3 className="section-label mb-1">About Me</h3>
                  <div
                    className="text-[14px] leading-[1.375] break-words whitespace-pre-wrap"
                    data-testid="dm-profile-bio"
                  >
                    <RichText text={user.bio} />
                  </div>
                </div>
              ) : null}
              {user.createdAt ? <MemberSince createdAt={user.createdAt} /> : null}
            </section>
          ) : null}

          {profile ? (
            <Mutuals
              profile={profile}
              className={theme ? 'card-inset p-1' : 'rounded-xl bg-surface p-1'}
            />
          ) : null}

          <ProfileNote userId={user.id} className={card} />

          <Button
            variant="ghost"
            leftIcon={IdCard}
            className="mt-auto self-center"
            onClick={() => openFullProfile(user.id)}
          >
            View Full Profile
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Panel({
  name,
  onHover,
  children,
}: {
  name: string;
  onHover?: (hover: boolean) => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={name}
      className="relative flex min-h-0 w-[340px] max-w-[40%] shrink-0 flex-col overflow-y-auto bg-surface-2 scrollbar-thin"
      data-testid="dm-profile-panel"
      data-animate-avatars
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHover?.(false);
      }}
    >
      {children}
    </aside>
  );
}

function count(n: number): string {
  return n >= MUTUALS_LIMIT ? `${MUTUALS_LIMIT}+` : String(n);
}

/** "Mutual Spaces — 3" and "Mutual Friends — 2", each expanding into its list. */
function Mutuals({ profile, className }: { profile: UserProfile; className: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<'spaces' | 'friends' | null>(null);
  const spaces = profile.mutualSpaces;
  const friends = profile.mutualFriends;
  if (!spaces.length && !friends.length) return null;
  const toggle = (which: 'spaces' | 'friends') => setOpen((o) => (o === which ? null : which));
  const head = (which: 'spaces' | 'friends', label: string, n: number) => (
    <button
      type="button"
      className={cn(ROW, 'py-2 text-[14px] font-medium')}
      aria-expanded={open === which}
      onClick={() => toggle(which)}
    >
      <span className="min-w-0 flex-1 truncate">
        {label} — {count(n)}
      </span>
      <ChevronRight
        size={16}
        className={cn('shrink-0 text-muted transition-transform', open === which && 'rotate-90')}
        aria-hidden
      />
    </button>
  );
  return (
    <section className={className} data-testid="dm-profile-mutuals">
      {spaces.length ? (
        <>
          {head('spaces', 'Mutual Spaces', spaces.length)}
          {open === 'spaces' ? (
            <ul className="pb-1" aria-label="Mutual Spaces">
              {spaces.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={ROW}
                    onClick={() => void navigate(`/spaces/${s.id}`)}
                  >
                    <Avatar
                      kind="community"
                      src={s.iconUrl}
                      name={s.name}
                      colorSeed={s.id}
                      size={32}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{s.name}</span>
                      {s.nickname ? (
                        <span className="block truncate text-[12px] text-muted">{s.nickname}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {friends.length ? (
        <>
          {head('friends', 'Mutual Friends', friends.length)}
          {open === 'friends' ? (
            <ul className="pb-1" aria-label="Mutual Friends">
              {friends.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={ROW}
                    aria-haspopup="dialog"
                    onClick={(e) => openProfile(u.id, e.currentTarget)}
                  >
                    <Avatar
                      src={u.avatarUrl}
                      animatedSrc={u.avatarAnimatedUrl}
                      decoration={u.avatarDecoration}
                      name={userDisplayName(u)}
                      colorSeed={u.id}
                      size={32}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                      <StyledName name={userDisplayName(u)} style={u.nameStyle} mode="full" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
