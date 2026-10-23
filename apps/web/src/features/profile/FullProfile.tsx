/**
 * The full profile (Discord's ~600px profile modal), shared by `FullProfileModal` and the
 * `/u/:username` / `/users/:userId` page: a large banner, the 120px decorated avatar (opens
 * the photo), the custom status bubble, actions (Message, calls, contact, "..." — Edit
 * Profile on mine), the styled name with the server tag and badges, and tabs: About Me (bio,
 * member since, roles in a Space, my note), Mutual Spaces (opens the Space), Mutual Friends
 * (opens their popout) and Groups in common. Data: `GET /api/users/:userId/profile` (fresh on
 * every open) plus the users store for live changes.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { MessageCircle, Pencil, UserPlus, UserRoundSearch, UserRoundX, X } from 'lucide-react';
import {
  activePresenceNote,
  chatTitle,
  profileBadges,
  userDisplayName,
  type ChatSummary,
  type ID,
  type Presence,
  type UserProfile,
  type UserPublic,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { presenceBadge } from '@/components/common/UserAvatar';
import { ProfileEffect, StyledName } from '@/components/cosmetics';
import { ServerTagPill } from '@/components/cosmetics/TagPill/ServerTagPill';
import { PhoneIcon, VideoIcon } from '@/components/icons';
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
import { Avatar, Button, EmptyState, IconButton, Skeleton, Tabs, type TabItem } from '@/components/ui';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { PhotoViewer } from '@/features/contacts/PhotoViewer';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { presenceLabel } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { usePresence, useUser } from '@/stores/users';
import { selfCardUser, type ProfileCardUser } from './model';
import { openProfile, type FullProfileTab } from './open';
import { ProfileMoreMenu } from './ProfileMoreMenu';
import { ProfileNote } from './ProfileNote';
import { useUserProfile } from './profileStore';
import { RoleChips } from './RoleChips';
import { useDirectActions } from './useDirectActions';
import { useProfileBannerSrc } from './useProfileBanner';
import { useProfileView } from './useProfileView';

export interface FullProfileProps {
  userId: ID;
  /** Opened inside a Space: its per-Space profile, roles and join date. */
  spaceId?: ID | null;
  initialTab?: FullProfileTab;
  /** `modal`: fills the dialog, the tab content scrolls; `page`: flows in the page. */
  variant: 'modal' | 'page';
  /** Id for the name heading (the modal is labelled by it). */
  titleId?: string;
  /** Modal: the close button on the banner. */
  onClose?: () => void;
  /** Called right before navigating away (a Space, a group, a chat). */
  onNavigate?: () => void;
  /** My own profile: the status bubble edits the custom status. */
  onSetStatus?: () => void;
  onEditContact?: (user: UserPublic) => void;
}

const LABEL = 'section-label mb-1.5';
const AVATAR = 120;
const RING = 8;

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function FullProfile(props: FullProfileProps) {
  const { userId } = props;
  const me = useMe();
  const self = !!me && userId === me.id;
  const cached = useUser(self ? null : userId);
  const presence = usePresence(self ? null : userId);
  const { profile, error } = useUserProfile(self ? null : userId);
  const user = self && me ? selfCardUser(me) : (cached ?? profile?.user);

  if (!user) {
    if (error)
      return (
        <ProfileShell {...props}>
          <EmptyState
            icon={UserRoundSearch}
            title={error instanceof ApiError && error.status === 404 ? 'No one found' : "Couldn't open this profile"}
            description="Check the link, or find people by their @username."
          />
        </ProfileShell>
      );
    return (
      <ProfileShell {...props}>
        <div className="flex flex-col gap-3 p-6" aria-busy data-testid="full-profile-loading">
          <Skeleton className="-mx-6 -mt-6 h-[212px] rounded-none" />
          <Skeleton circle className="-mt-16 size-[120px]" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-28" />
        </div>
      </ProfileShell>
    );
  }
  return (
    <FullProfileBody
      {...props}
      user={user}
      self={self}
      presence={self ? undefined : presence}
      profile={self ? undefined : profile}
    />
  );
}

/** Loading / error frame with the modal's close button. */
function ProfileShell({ variant, onClose, children }: FullProfileProps & { children: ReactNode }) {
  return (
    <div className={cn('relative flex flex-col bg-elevated', variant === 'modal' && 'min-h-0 flex-1')}>
      {variant === 'modal' && onClose ? (
        <IconButton icon={X} label="Close" size="sm" className="absolute top-3 right-3 z-10" onClick={onClose} />
      ) : null}
      {children}
    </div>
  );
}

function FullProfileBody({
  user,
  self,
  presence,
  profile,
  spaceId,
  initialTab,
  variant,
  titleId,
  onClose,
  onNavigate,
  onSetStatus,
  onEditContact,
}: FullProfileProps & {
  user: ProfileCardUser;
  self: boolean;
  presence: Presence | undefined;
  profile: UserProfile | undefined;
}) {
  const navigate = useNavigate();
  const view = useProfileView(user, spaceId);
  const { shown, name } = view;
  const deleted = user.isDeleted;
  const others = !self && !deleted;
  const theme = deleted ? null : profileTheme(shown.profileColor, shown.accentColor);
  const ring = surfaceRing(theme);
  const banner = useProfileBannerSrc(deleted ? null : shown);
  const state = deleted ? null : presence ? presenceBadge(presence) : user.presenceState;
  const note = deleted ? null : activePresenceNote(presence ? presence.note : user.presenceNote);
  const direct = useDirectActions(user, onNavigate);
  const [photo, setPhoto] = useState(false);
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<FullProfileTab>(initialTab ?? 'about');
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const count = (n: number | undefined) => (n === undefined ? '' : ` (${n})`);
  const tabs: TabItem<FullProfileTab>[] = [{ value: 'about', label: 'About Me' }];
  if (others) {
    tabs.push(
      { value: 'spaces', label: `Mutual Spaces${count(profile?.mutualSpaces.length)}` },
      { value: 'friends', label: `Mutual Friends${count(profile?.mutualFriends.length)}` },
    );
    if (profile?.mutualGroupCount)
      tabs.push({ value: 'groups', label: `Groups${count(profile.mutualGroupCount)}` });
  }
  const active = tabs.some((t) => t.value === tab) ? tab : 'about';

  return (
    <ThemedProfileSurface
      theme={theme}
      className={cn(variant === 'modal' ? 'min-h-0 flex-1' : 'rounded-[var(--radius-card)]')}
      data-testid="full-profile"
      data-user-id={user.id}
      onPointerEnter={() => setReplay((n) => n + 1)}
    >
      <ProfileBanner
        src={banner}
        color={theme?.primary ?? shown.profileColor ?? 'var(--brand)'}
        height={variant === 'modal' ? 212 : 200}
        data-testid="full-profile-banner"
      >
        {variant === 'modal' && onClose ? (
          <IconButton
            icon={X}
            label="Close"
            size="sm"
            variant="glass"
            className="absolute top-3 right-3"
            onClick={onClose}
          />
        ) : null}
      </ProfileBanner>

      <ProfilePanel theme={theme}>
        <div className="relative flex min-h-[72px] shrink-0 flex-wrap items-start justify-end gap-2 px-4 pt-3 pl-[156px] sm:px-6 sm:pl-[160px]">
          <ProfileAvatar
            className="absolute left-4 sm:left-5"
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
            onClick={!deleted && shown.avatarUrl ? () => setPhoto(true) : undefined}
            label="View photo"
          />
          {note ? (
            <StatusBubble
              note={note}
              background={ring}
              className="absolute top-[-34px] left-[150px] max-w-[calc(100%-166px)] sm:left-[156px]"
              onClick={self && onSetStatus ? onSetStatus : undefined}
              label="Edit custom status"
              data-testid="full-profile-status"
            />
          ) : null}
          {self ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={Pencil}
              onClick={() => {
                onNavigate?.();
                void navigate('/settings/profile');
              }}
            >
              Edit Profile
            </Button>
          ) : others ? (
            <>
              <Button
                size="sm"
                leftIcon={MessageCircle}
                loading={direct.busy === 'message'}
                disabled={!!direct.busy}
                onClick={() => void direct.message()}
              >
                Message
              </Button>
              {direct.canCall ? (
                <>
                  <IconButton
                    icon={PhoneIcon}
                    label="Voice call"
                    size="sm"
                    variant="solid"
                    disabled={!!direct.busy}
                    onClick={() => void direct.call('audio')}
                  />
                  <IconButton
                    icon={VideoIcon}
                    label="Video call"
                    size="sm"
                    variant="solid"
                    disabled={!!direct.busy}
                    onClick={() => void direct.call('video')}
                  />
                </>
              ) : null}
              {!user.isContact && onEditContact ? (
                <IconButton
                  icon={UserPlus}
                  label="Add to contacts"
                  size="sm"
                  variant="solid"
                  onClick={() => onEditContact(user)}
                />
              ) : null}
              <ProfileMoreMenu user={user} onEditContact={onEditContact} variant="solid" />
            </>
          ) : null}
        </div>

        <div className="shrink-0 px-4 pt-1 pb-3 sm:px-6">
          <h2
            id={titleId}
            className="text-[24px] leading-tight font-bold break-words text-fg"
            data-testid="full-profile-name"
          >
            <StyledName name={name} style={deleted ? null : shown.nameStyle} mode="full" />
            {/* Mine from the users store; others' come with their profile. */}
            {!deleted ? (
              <ServerTagPill
                userId={user.id}
                tag={self ? undefined : (user.spaceTag ?? null)}
                size="md"
                className="ml-2"
              />
            ) : null}
          </h2>
          {view.alias ? <p className="truncate text-[14px] text-muted">~{view.alias}</p> : null}
          {!deleted ? <p className="truncate text-[15px] text-fg">@{user.username}</p> : null}
          {shown.pronouns && !deleted ? (
            <p className="text-[14px] text-muted" data-testid="full-profile-pronouns">
              {shown.pronouns}
            </p>
          ) : null}
          {state && state !== 'offline' ? (
            <span className="sr-only">{capitalize(presenceLabel(state))}</span>
          ) : null}
          <BadgeRow badges={profileBadges(user)} owner={view.owner} size={22} className="mt-2" />
          {view.hasOverrides ? (
            <button
              type="button"
              className="mt-2 rounded text-[13px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-brand"
              onClick={() => view.setShowMain(!view.showMain)}
              aria-pressed={view.showMain}
            >
              {view.showMain ? 'View Space Profile' : 'View Main Profile'}
            </button>
          ) : null}
        </div>

        {tabs.length > 1 ? (
          <Tabs
            value={active}
            onChange={setTab}
            items={tabs}
            idBase={idBase}
            aria-label="Profile sections"
            // No divider line under the tabs (the Discord look): only the active indicator.
            className="shrink-0 border-b-0! px-2 sm:px-4"
          />
        ) : null}
        <div
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          id={tabs.length > 1 ? `${idBase}-panel-${active}` : undefined}
          aria-labelledby={tabs.length > 1 ? `${idBase}-tab-${active}` : undefined}
          className={cn(
            'px-4 py-4 sm:px-6',
            variant === 'modal' && 'min-h-0 flex-1 overflow-y-auto scrollbar-thin',
          )}
        >
          {deleted ? (
            <p className="flex items-center gap-2 text-[14px] text-muted">
              <UserRoundX size={16} aria-hidden /> This account was deleted.
            </p>
          ) : active === 'spaces' ? (
            <MutualSpaces profile={profile} onNavigate={onNavigate} />
          ) : active === 'friends' ? (
            <MutualFriends profile={profile} />
          ) : active === 'groups' ? (
            <CommonGroups userId={user.id} onNavigate={onNavigate} />
          ) : (
            <div className="flex flex-col gap-4">
              {shown.bio ? (
                <section>
                  <h3 className={LABEL}>About Me</h3>
                  <div
                    className="text-[14.5px] leading-[1.375] break-words whitespace-pre-wrap text-fg"
                    data-testid="full-profile-bio"
                  >
                    <RichText text={shown.bio} />
                  </div>
                </section>
              ) : null}
              {user.about ? (
                <section>
                  <h3 className={LABEL}>About</h3>
                  <p className="text-[14.5px] break-words text-fg">{user.about}</p>
                </section>
              ) : null}
              {view.space && view.member ? <RoleChips space={view.space} member={view.member} /> : null}
              {user.createdAt ? (
                <MemberSince createdAt={user.createdAt} space={view.space} joinedAt={view.member?.joinedAt} />
              ) : null}
              {others ? <ProfileNote userId={user.id} /> : null}
            </div>
          )}
        </div>
      </ProfilePanel>
      <ProfileEffect
        id={deleted ? null : shown.profileEffect}
        play="once"
        replayKey={replay}
        className="pointer-events-none absolute inset-0 z-10"
      />
      <PhotoViewer
        open={photo}
        onClose={() => setPhoto(false)}
        src={shown.avatarUrl}
        animatedSrc={shown.avatarAnimatedUrl}
        title={name}
      />
    </ThemedProfileSurface>
  );
}

const ROW =
  'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

function MutualSpaces({ profile, onNavigate }: { profile: UserProfile | undefined; onNavigate?: () => void }) {
  const navigate = useNavigate();
  if (!profile) return <ListSkeleton />;
  if (!profile.mutualSpaces.length) return <p className="text-[14px] text-muted">No Spaces in common.</p>;
  return (
    <ul className="-mx-2 flex flex-col" data-testid="mutual-spaces">
      {profile.mutualSpaces.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className={ROW}
            onClick={() => {
              onNavigate?.();
              void navigate(`/spaces/${s.id}`);
            }}
          >
            <Avatar kind="community" src={s.iconUrl} name={s.name} colorSeed={s.id} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-fg">{s.name}</span>
              {s.nickname ? <span className="block truncate text-[13px] text-muted">{s.nickname}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MutualFriends({ profile }: { profile: UserProfile | undefined }) {
  if (!profile) return <ListSkeleton />;
  if (!profile.mutualFriends.length) return <p className="text-[14px] text-muted">No friends in common.</p>;
  return (
    <ul className="-mx-2 flex flex-col" data-testid="mutual-friends">
      {profile.mutualFriends.map((u) => (
        <li key={u.id}>
          <button
            type="button"
            className={ROW}
            data-animate-avatars
            aria-haspopup="dialog"
            onClick={(e) => openProfile(u.id, e.currentTarget)}
          >
            <Avatar
              src={u.avatarUrl}
              animatedSrc={u.avatarAnimatedUrl}
              decoration={u.avatarDecoration}
              name={userDisplayName(u)}
              colorSeed={u.id}
              size={40}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-fg">
                <StyledName name={userDisplayName(u)} style={u.nameStyle} mode="full" />
              </span>
              <span className="block truncate text-[13px] text-muted">@{u.username}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Groups we are both in (loaded when the tab opens), newest activity first. */
function CommonGroups({ userId, onNavigate }: { userId: ID; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<ChatSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<ChatSummary[]>(`/api/users/${userId}/common-groups`)
      .then((list) => alive && setGroups(Array.isArray(list) ? list : []))
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!groups) return <ListSkeleton />;
  if (!groups.length) return <p className="text-[14px] text-muted">No groups in common.</p>;
  return (
    <ul className="-mx-2 flex flex-col" data-testid="common-groups">
      {groups.map((g) => (
        <li key={g.id}>
          <button
            type="button"
            className={ROW}
            onClick={() => {
              onNavigate?.();
              void navigate(`/chats/${g.id}`);
            }}
          >
            <ChatAvatar chat={g} size="md" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">{chatTitle(g)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
