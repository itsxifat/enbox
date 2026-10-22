/**
 * The full profile as a page: `/u/:username` (the public profile link from Settings → Profile
 * → share) looks the user up by username; `/users/:userId` takes the id. Both render the same
 * `FullProfile` as the full profile modal (banner, decorated avatar, styled name, badges,
 * About Me / Mutual Spaces / Mutual Friends tabs, Message and the "..." menu). Anonymous
 * visitors are sent to /login first (RequireAuth keeps the link in `?next=`).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { UserRoundSearch } from 'lucide-react';
import type { UserPublic } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, PageSpinner } from '@/components/ui';
import { FullProfile } from '@/features/profile/FullProfile';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useUsers } from '@/stores/users';
import { EditContactDialog } from './ContactDialogs';

export function UserProfilePage() {
  const { username = '', userId: idParam } = useParams();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(idParam ?? null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [editing, setEditing] = useState<UserPublic | null>(null);

  useEffect(() => {
    setError(null);
    if (idParam) {
      setUserId(idParam);
      return;
    }
    let alive = true;
    setUserId(null);
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
  }, [username, idParam]);

  const back = () => (window.history.length > 1 ? void navigate(-1) : void navigate('/chats'));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader title="Profile" back={back} />
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
        ) : !userId ? (
          <PageSpinner />
        ) : (
          <div className="mx-auto flex w-full max-w-[640px] flex-col px-3 pb-10 sm:px-6 sm:pt-3">
            <FullProfile key={userId} userId={userId} variant="page" onEditContact={setEditing} />
          </div>
        )}
      </div>
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
