/**
 * /u/:username — public profile link (Settings → Profile → share). Looks the user up by
 * username and offers Message / Add to contacts. Anonymous visitors are sent to /login first
 * (RequireAuth keeps the link in `?next=`).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MessageCircle, Pencil, UserPlus, UserRoundSearch } from 'lucide-react';
import { userDisplayName, type UserPublic } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, EmptyState, PageSpinner, toast } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatLastSeen } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { usePresence, useUsers } from '@/stores/users';
import { EditContactDialog } from './ContactDialogs';
import { openDirectChat } from './contactActions';
import { PhotoViewer } from './PhotoViewer';

export function UserProfilePage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const [photo, setPhoto] = useState(false);
  const user = useUsers((s) => (userId ? s.byId[userId] : undefined));
  const isMe = !!me && userId === me.id;
  const presence = usePresence(userId && !isMe ? userId : null);

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
          <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-10 text-center">
            <button
              type="button"
              onClick={() => user.avatarUrl && setPhoto(true)}
              disabled={!user.avatarUrl}
              className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              aria-label={user.avatarUrl ? 'View photo' : undefined}
            >
              <Avatar
                src={user.avatarUrl}
                name={userDisplayName(user)}
                colorSeed={user.id}
                size="3xl"
              />
            </button>
            <h2 className="mt-5 text-[26px] font-semibold text-fg">
              {isMe ? `${me?.displayName} (You)` : userDisplayName(user)}
            </h2>
            <p className="mt-1 text-[15px] text-muted">@{user.username}</p>
            {!isMe && formatLastSeen(presence) ? (
              <p className="mt-1 text-[13.5px] text-subtle">{formatLastSeen(presence)}</p>
            ) : null}
            {user.about ? (
              <p className="mt-5 max-w-sm rounded-2xl bg-surface px-4 py-3 text-[15px] break-words text-fg shadow-bubble">
                {user.about}
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
        )}
      </div>
      <PhotoViewer
        open={photo}
        onClose={() => setPhoto(false)}
        src={user?.avatarUrl}
        title={user ? userDisplayName(user) : ''}
      />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
