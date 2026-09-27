/**
 * /u/:username (web features/contacts/UserProfilePage.tsx) — public profile link and the
 * profile card's "View full profile": banner (or the profile colours), avatar with presence,
 * pronouns, presence line, About me, about, member since, then Message / Add to contacts.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageCircle, Pencil, UserPlus, UserRoundSearch } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { presenceBadge } from '@/components/common/avatars';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  EmptyState,
  PageSpinner,
  Press,
  SectionLabel,
  T,
  toast,
} from '@/components/ui';
import { selfCardUser } from '@/features/profile/model';
import { ProfileBanner } from '@/features/profile/ProfileCard';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatLastSeen, formatMonthYear, formatPresenceNote } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { usePresence, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { EditContactDialog } from './ContactDialogs';
import { openDirectChat } from './contactActions';
import { PhotoViewer } from './PhotoViewer';

export function UserProfile({ username = '' }) {
  const { tw } = useTheme();
  const router = useRouter();
  const me = useMe();
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState(null);
  const [photo, setPhoto] = useState(false);
  const fetched = useUsers((s) => (userId ? s.byId[userId] : undefined));
  const isMe = !!me && userId === me.id;
  const presence = usePresence(userId && !isMe ? userId : null);
  // My own link shows the raw profile (no privacy gating, my availability choice).
  const user = isMe && me ? selfCardUser(me) : fetched;

  useEffect(() => {
    let alive = true;
    setUserId(null);
    setError(null);
    api
      .get(`/api/users/by-username/${encodeURIComponent(username.toLowerCase())}`)
      .then((u) => {
        if (!alive) return;
        useUsers.getState().upsertUsers([u]);
        setUserId(u.id);
      })
      .catch((e) => {
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
      router.push(`/chats/${chat.id}`);
      setOpening(false);
    } catch (e) {
      toast.error(e);
      setOpening(false);
    }
  };

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
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Profile" back="/chats" />
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
            <Button variant="soft" onPress={() => router.push('/new')}>
              Find people
            </Button>
          }
        />
      ) : !user ? (
        <PageSpinner />
      ) : (
        <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`px-3 pb-10`}>
          <View style={tw`overflow-hidden rounded-xl bg-surface-2`}>
            <ProfileBanner user={user} style={{ aspectRatio: 3 }} />
            <View style={tw`px-5 pb-5`}>
              <Press
                onPress={() => user.avatarUrl && setPhoto(true)}
                disabled={!user.avatarUrl}
                accessibilityLabel={user.avatarUrl ? 'View photo' : undefined}
                style={[
                  tw`self-start rounded-full bg-surface-2`,
                  { marginTop: -66, padding: 6, marginLeft: -6 },
                ]}
              >
                <Avatar
                  src={user.avatarUrl}
                  animatedSrc={user.avatarAnimatedUrl}
                  name={userDisplayName(user)}
                  colorSeed={user.id}
                  size="3xl"
                  presence={state}
                />
              </Press>
              <View style={tw`mt-3 rounded-xl bg-surface px-4 py-3`}>
                <T style={tw`text-[24px] leading-tight font-semibold`}>
                  {isMe ? `${me?.displayName} (You)` : userDisplayName(user)}
                </T>
                <T style={tw`mt-0.5 text-[15px] text-muted`}>
                  @{user.username}
                  {user.pronouns ? ` · ${user.pronouns}` : ''}
                </T>
                {presenceLine ? (
                  <T style={tw`mt-1 text-[13.5px] text-subtle`}>{presenceLine}</T>
                ) : null}
                {isMe && user.presenceNote ? (
                  <View style={tw`mt-2 self-start rounded-lg bg-surface-2 px-2.5 py-1.5`}>
                    <T style={tw`text-[13.5px]`}>{formatPresenceNote(user.presenceNote)}</T>
                  </View>
                ) : null}
              </View>
              {user.bio ? (
                <View style={tw`mt-3 w-full rounded-xl bg-surface px-4 py-3`}>
                  <SectionLabel style={tw`mb-1`}>About me</SectionLabel>
                  <T style={[tw`text-[15px]`, { lineHeight: 24 }]}>{user.bio}</T>
                </View>
              ) : null}
              {user.about || user.createdAt ? (
                <View style={tw`mt-3 w-full gap-3 rounded-xl bg-surface px-4 py-3`}>
                  {user.about ? (
                    <View>
                      <SectionLabel style={tw`mb-1`}>About</SectionLabel>
                      <T style={tw`text-[15px]`}>{user.about}</T>
                    </View>
                  ) : null}
                  {user.createdAt ? (
                    <View>
                      <SectionLabel style={tw`mb-1`}>Member since</SectionLabel>
                      <T style={tw`text-[15px]`}>{formatMonthYear(user.createdAt)}</T>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={tw`mt-4 w-full gap-2.5`}>
                {isMe ? (
                  <Button
                    leftIcon={Pencil}
                    fullWidth
                    onPress={() => router.push('/settings/profile')}
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
                      onPress={() => void message()}
                      disabled={user.isDeleted}
                    >
                      Message
                    </Button>
                    {!user.isContact && !user.isDeleted ? (
                      <Button
                        variant="soft"
                        leftIcon={UserPlus}
                        fullWidth
                        onPress={() => setEditing(user)}
                      >
                        Add to contacts
                      </Button>
                    ) : null}
                  </>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      )}
      <PhotoViewer
        open={photo}
        onClose={() => setPhoto(false)}
        src={user?.avatarUrl}
        animatedSrc={user?.avatarAnimatedUrl}
        title={user ? userDisplayName(user) : ''}
      />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </View>
  );
}
