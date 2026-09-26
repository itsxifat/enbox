/**
 * /u/:username — public profile link (Settings → Profile → share) and the profile card's
 * "View full profile". Looks the user up by username and shows the full profile: banner (or
 * the profile colours), avatar with presence, pronouns, the presence line, About me, about,
 * member since, then Message / Add to contacts. Anonymous visitors are sent to /login first
 * (RequireAuth keeps the link in `?next=`).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MessageCircle, Pencil, UserPlus, UserRoundSearch } from 'lucide-react';
import { userDisplayName, type UserPublic } from '@enbox/shared';
import { presenceBadge } from '@/components/common/UserAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, EmptyState, PageSpinner, toast } from '@/components/ui';
import { profileGradient, selfCardUser } from '@/features/profile/model';
import { useProfileBannerSrc } from '@/features/profile/useProfileBanner';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatLastSeen, formatMonthYear, formatPresenceNote } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { usePresence, useUsers } from '@/stores/users';
import { EditContactDialog } from './ContactDialogs';
import { openDirectChat } from './contactActions';
import { PhotoViewer } from './PhotoViewer';

const LABEL = 'mb-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase';

export function UserProfilePage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const [photo, setPhoto] = useState(false);
  const fetched = useUsers((s) => (userId ? s.byId[userId] : undefined));
  const isMe = !!me && userId === me.id;
  const presence = usePresence(userId && !isMe ? userId : null);
  // My own link shows the raw profile (no privacy gating, my availability choice).
  const user = isMe && me ? selfCardUser(me) : fetched;
  // A full page is not the profile card: animated media plays while the hero is hovered/focused.
  const [heroHot, setHeroHot] = useState(false);
  const banner = useProfileBannerSrc(user, heroHot);

  useEffect(() => {
    let alive = true;
    setUserId(null);
    setError(null);
    api
      .get<UserPublic>(`/api/users/by-username/${encodeURIComponent(username.toLowerCase())}`)
      .then((u) => {
        if (!alive) return;
        useUsers.getState().upsertUsers([u]);
        setUserId(u.id);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError({
          notFound: e instanceof ApiError && (e.status === 404 || e.status === 400),
          message: errorMessage(e),
        });
      });
    return () => {
      alive = false;
    };
  }, [username]);

  const message = async () => {
    if (!userId) return;
    setOpening(true);
    try {
      const chat = await openDirectChat(userId);
      void navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
      setOpening(false);
    }
  };

  const back = () => (window.history.length > 1 ? void navigate(-1) : void navigate('/chats'));

  const state =
    !user || user.isDeleted ? null : isMe ? user.presenceState : presenceBadge(presence);
  const presenceLine =
    !user || isMe || user.isDeleted
      ? ''
      : formatLastSeen(
          presence ?? {
            online: user.online,
            state: user.presenceState,
            note: user.presenceNote,
            lastSeenAt: user.lastSeenAt,
          },
        );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <PaneHeader title="Profile" back={back} border />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <EmptyState
            icon={UserRoundSearch}
            title={error.notFound ? 'No one found' : "Couldn't open this profile"}
            description={
              error.notFound
                ? `There’s no Enbox account with the username @${username}.`
                : error.message
            }
            action={
              <Button variant="soft" onClick={() => void navigate('/new')}>
                Find people
              </Button>
            }
          />
        ) : !user ? (
          <PageSpinner />
        ) : (
          <div className="mx-auto flex w-full max-w-md flex-col pb-10 sm:px-6 sm:pt-6">
            <div
              className="overflow-hidden bg-surface sm:rounded-3xl sm:shadow-bubble"
              data-animate-avatars
              onPointerEnter={() => setHeroHot(true)}
              onPointerLeave={() => setHeroHot(false)}
              onFocus={() => setHeroHot(true)}
              onBlur={() => setHeroHot(false)}
            >
              <div
                className="relative w-full"
                style={{
                  aspectRatio: '5 / 2',
                  background: profileGradient(user.profileColor, user.accentColor),
                  borderBottom: user.accentColor ? `3px solid ${user.accentColor}` : undefined,
                }}
                data-testid="profile-page-banner"
              >
                {banner ? (
                  <img src={banner} alt="" className="size-full object-cover" draggable={false} />
                ) : null}
              </div>
              <div className="flex flex-col items-center px-6 pb-8 text-center">
                <button
                  type="button"
                  onClick={() => user.avatarUrl && setPhoto(true)}
                  disabled={!user.avatarUrl}
                  className="-mt-[72px] rounded-full bg-surface ring-4 ring-surface outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                  aria-label={user.avatarUrl ? 'View photo' : undefined}
                >
                  <Avatar
                    src={user.avatarUrl}
                    animatedSrc={user.avatarAnimatedUrl}
                    name={userDisplayName(user)}
                    colorSeed={user.id}
                    size="3xl"
                    presence={state}
                  />
                </button>
                <h2 className="mt-4 text-[26px] font-semibold text-fg">
                  {isMe ? `${me?.displayName} (You)` : userDisplayName(user)}
                </h2>
                <p className="mt-1 text-[15px] text-muted">
                  @{user.username}
                  {user.pronouns ? (
                    <>
                      {' · '}
                      <span data-testid="profile-page-pronouns">{user.pronouns}</span>
                    </>
                  ) : null}
                </p>
                {presenceLine ? (
                  <p className="mt-1 text-[13.5px] text-subtle" data-testid="profile-page-presence">
                    {presenceLine}
                  </p>
                ) : null}
                {isMe && user.presenceNote ? (
                  <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[13.5px] text-fg">
                    {formatPresenceNote(user.presenceNote)}
                  </p>
                ) : null}
                {user.bio ? (
                  <section className="mt-5 w-full rounded-2xl bg-surface-2 px-4 py-3 text-left">
                    <h3 className={LABEL}>About me</h3>
                    <p
                      className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg"
                      data-testid="profile-page-bio"
                    >
                      {user.bio}
                    </p>
                  </section>
                ) : null}
                {user.about ? (
                  <p className="mt-3 max-w-sm text-[15px] break-words text-fg">{user.about}</p>
                ) : null}
                {user.createdAt ? (
                  <p className="mt-3 text-[12.5px] text-subtle">
                    Member since {formatMonthYear(user.createdAt)}
                  </p>
                ) : null}
                <div className="mt-8 flex w-full flex-col gap-2.5">
                  {isMe ? (
                    <Button
                      leftIcon={Pencil}
                      fullWidth
                      onClick={() => void navigate('/settings/profile')}
                    >
                      Edit profile
                    </Button>
                  ) : (
                    <>
                      <Button
                        leftIcon={MessageCircle}
                        fullWidth
                        size="lg"
                        loading={opening}
                        onClick={() => void message()}
                        disabled={user.isDeleted}
                      >
                        Message
                      </Button>
                      {!user.isContact && !user.isDeleted ? (
                        <Button
                          variant="soft"
                          leftIcon={UserPlus}
                          fullWidth
                          onClick={() => setEditing(user)}
                        >
                          Add to contacts
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <PhotoViewer
        open={photo}
        onClose={() => setPhoto(false)}
        src={user?.avatarUrl}
        animatedSrc={user?.avatarAnimatedUrl}
        title={user ? userDisplayName(user) : ''}
      />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
