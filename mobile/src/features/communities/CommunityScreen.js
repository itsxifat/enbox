/**
 * Community home (web features/communities/CommunityPane.tsx): header, announcements, groups
 * I'm in, groups I can join, admin tools (edit, members, invite link, add/create/unlink
 * groups, deactivate) and exit. Admin pages open in a full-screen Sheet.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  EllipsisVertical,
  Link2,
  LogOut,
  Pencil,
  Plus,
  Power,
  Unlink,
  UserPlus,
  UsersRound,
} from 'lucide-react-native';
import { MAX_DESCRIPTION_LENGTH, MAX_GROUP_NAME_LENGTH } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  PageSpinner,
  Press,
  Sheet,
  T,
  confirm,
  toast,
} from '@/components/ui';
import { EditInfoModal, EditTextModal } from '@/features/groups/shared/dialogs';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { InfoPage, InfoRow, InfoSection, QuickAction } from '@/features/groups/shared/InfoLayout';
import { InviteLinkView } from '@/features/groups/shared/InviteLinkView';
import { RichText } from '@/features/groups/shared/MediaGallery';
import { ApiError, errorMessage } from '@/lib/api';
import { formatShortDate } from '@/lib/format';
import { useChats } from '@/stores/chats';
import { isCommunityAdmin, useCommunities, useCommunity } from '@/stores/communities';
import { useUserName } from '@/stores/users';
import { useTheme } from '@/theme';
import { AddGroupsView } from './AddGroupsView';
import { CommunityChatRow } from './CommunityChatRow';
import { CommunityMembersView } from './CommunityMembersView';

export function CommunityScreen() {
  const { tw } = useTheme();
  const { communityId } = useLocalSearchParams();
  const community = useCommunity(communityId);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (!communityId) return;
    let alive = true;
    setChecking(true);
    setFailed(null);
    useCommunities
      .getState()
      .refreshCommunity(communityId)
      .catch((e) => {
        if (alive && !(e instanceof ApiError && (e.status === 404 || e.status === 403)))
          setFailed(errorMessage(e));
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [communityId]);

  if (!community) {
    if (failed || !checking)
      return (
        <View style={tw`flex-1 bg-app`}>
          <PaneHeader title="Community" back="/communities" />
          <View style={tw`flex-1 items-center justify-center`}>
            <EmptyState
              icon={UsersRound}
              title={failed ? "Couldn't load the community" : 'Community not available'}
              description={failed ?? "It may have been deactivated, or you're no longer a member."}
            />
          </View>
        </View>
      );
    return (
      <View style={tw`flex-1 bg-app`}>
        <PaneHeader title="Community" back="/communities" />
        <PageSpinner />
      </View>
    );
  }
  return <CommunityHome key={community.id} community={community} />;
}

function CommunityHome({ community: c }) {
  const { tw } = useTheme();
  const router = useRouter();
  const admin = isCommunityAdmin(c);
  const owner = c.myRole === 'owner';
  const [sheet, setSheet] = useState(null);
  const [edit, setEdit] = useState(null);
  const [joining, setJoining] = useState(null);
  const chatsLoaded = useChats((s) => s.loaded);
  const creator = useUserName(c.createdBy);
  const createdBy = c.createdBy ? `Created by ${creator}` : 'Created';

  const groups = useMemo(() => c.groups.filter((g) => !g.isAnnouncement), [c.groups]);
  const mine = groups.filter((g) => g.isMember);
  const others = groups.filter((g) => !g.isMember);
  const store = useCommunities.getState;

  useEffect(() => {
    if (!chatsLoaded) return;
    const byId = useChats.getState().byId;
    for (const id of [c.announcementChatId, ...mine.map((g) => g.chatId)])
      if (!byId[id])
        void useChats
          .getState()
          .refreshChat(id)
          .catch(() => undefined);
  }, [c.announcementChatId, mine, chatsLoaded]);

  const join = async (g) => {
    setJoining(g.chatId);
    try {
      const chat = await store().joinGroup(c.id, g.chatId);
      toast.success(`You joined “${g.name}”`, {
        action: { label: 'Open', onClick: () => router.push(`/chats/${chat.id}`) },
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setJoining(null);
    }
  };

  const unlink = async (g) => {
    const ok = await confirm({
      title: `Remove “${g.name}” from the community?`,
      message:
        'The group stays active, but community members will no longer be able to find and join it here.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await store().unlinkGroup(c.id, g.chatId);
      toast.success('Group removed from the community');
    } catch (e) {
      toast.error(e);
    }
  };

  const leave = async () => {
    const ok = await confirm({
      title: `Exit “${c.name}”?`,
      message: owner
        ? `You'll exit the community and its ${groups.length} groups. Ownership passes to the longest-serving admin, or member.`
        : `You'll exit the community and all ${groups.length ? `${groups.length} of its groups` : 'its groups'}. You'll stop receiving announcements.`,
      confirmLabel: 'Exit community',
      danger: true,
    });
    if (!ok) return;
    try {
      await store().leaveCommunity(c.id);
      toast.success(`You exited “${c.name}”`);
      router.replace('/communities');
    } catch (e) {
      toast.error(e);
    }
  };

  const deactivate = async () => {
    const ok = await confirm({
      title: `Deactivate “${c.name}”?`,
      message:
        'Members will be removed from the community and the announcement group will be deleted. The other groups stay active on their own.',
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await store().deactivateCommunity(c.id);
      toast.success('Community deactivated');
      router.replace('/communities');
    } catch (e) {
      toast.error(e);
    }
  };

  const menu = [
    admin && { label: 'Edit community', icon: Pencil, onSelect: () => setEdit('all') },
    admin && { label: 'Members', icon: UsersRound, onSelect: () => setSheet('members') },
    admin && { label: 'Invite members', icon: Link2, onSelect: () => setSheet('invite') },
    admin && { label: 'Add groups', icon: Plus, onSelect: () => setSheet('groups') },
    admin && 'separator',
    { label: 'Exit community', icon: LogOut, danger: true, onSelect: () => void leave() },
    owner && {
      label: 'Deactivate community',
      icon: Power,
      danger: true,
      onSelect: () => void deactivate(),
    },
  ];

  return (
    <View style={tw`flex-1 bg-app`}>
      <PaneHeader
        title={c.name}
        subtitle={`Community · ${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
        back="/communities"
        leading={
          <Avatar
            src={c.avatarUrl}
            name={c.name}
            colorSeed={c.id}
            kind="community"
            size="md"
            style={tw`mx-1`}
          />
        }
        actions={
          <DropdownMenu
            items={menu}
            trigger={(t) => <IconButton {...t} icon={EllipsisVertical} label="Community options" />}
          />
        }
      />
      <ScrollView style={tw`min-h-0 flex-1`}>
        <InfoPage>
          <View style={tw`items-center bg-surface px-6 pt-8 pb-6`}>
            <EditableAvatar
              src={c.avatarUrl}
              name={c.name}
              colorSeed={c.id}
              kind="community"
              size={112}
              editable={admin}
              label="Change community icon"
              onUploaded={async (m) => {
                await store().updateCommunity(c.id, { avatarMediaId: m.id });
                toast.success('Community icon updated');
              }}
              onRemove={
                c.avatarUrl
                  ? async () => {
                      await store().updateCommunity(c.id, { avatarMediaId: null });
                      toast.success('Community icon removed');
                    }
                  : undefined
              }
            />
            <View style={tw`mt-4 max-w-full flex-row items-center gap-1`}>
              <T numberOfLines={1} style={tw`shrink text-[24px] font-semibold leading-tight`}>
                {c.name}
              </T>
              {admin ? (
                <IconButton
                  icon={Pencil}
                  label="Edit community name"
                  size="sm"
                  onPress={() => setEdit('name')}
                />
              ) : null}
            </View>
            <T style={tw`mt-1 text-center text-[15px] text-muted`}>
              Community · {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} ·{' '}
              {groups.length} {groups.length === 1 ? 'group' : 'groups'}
            </T>
            {c.description ? (
              <RichText
                text={c.description}
                style={[tw`mt-3 text-center text-[15px]`, { maxWidth: 576, lineHeight: 24 }]}
              />
            ) : admin ? (
              <Press feedback={false} onPress={() => setEdit('description')} style={tw`mt-3`}>
                <T style={tw`text-[15px] font-medium text-brand-ink`}>Add community description</T>
              </Press>
            ) : null}
            <T style={tw`mt-2 text-[13px] text-subtle`}>
              {createdBy} · {formatShortDate(c.createdAt)}
            </T>
            {admin ? (
              <View style={tw`mt-5 flex-row flex-wrap justify-center gap-2.5`}>
                <QuickAction icon={UserPlus} label="Invite" onPress={() => setSheet('invite')} />
                <QuickAction icon={Plus} label="Add groups" onPress={() => setSheet('groups')} />
                <QuickAction
                  icon={UsersRound}
                  label="Members"
                  onPress={() => setSheet('members')}
                />
              </View>
            ) : null}
          </View>

          <InfoSection>
            <CommunityChatRow
              chatId={c.announcementChatId}
              name={c.name}
              avatarUrl={c.avatarUrl}
              announcement
              fallback={
                admin ? 'Send an announcement to all members' : 'Only admins can send announcements'
              }
            />
          </InfoSection>

          <InfoSection title="Groups you're in">
            {mine.length ? (
              mine.map((g) => (
                <View key={g.chatId} style={tw`relative`}>
                  <CommunityChatRow
                    chatId={g.chatId}
                    name={g.name}
                    avatarUrl={g.avatarUrl}
                    fallback={`${g.memberCount} members`}
                  />
                  {admin ? (
                    <View style={[tw`absolute right-3`, { top: '50%', marginTop: -16 }]}>
                      <IconButton
                        icon={Unlink}
                        label={`Remove ${g.name} from community`}
                        size="sm"
                        variant="solid"
                        onPress={() => void unlink(g)}
                      />
                    </View>
                  ) : null}
                </View>
              ))
            ) : (
              <T style={tw`px-5 py-2 text-[14px] text-muted`}>
                You haven't joined any groups in this community yet.
              </T>
            )}
          </InfoSection>

          {others.length ? (
            <InfoSection title="Groups you can join">
              {others.map((g) => (
                <CommunityChatRow
                  key={g.chatId}
                  chatId={g.chatId}
                  name={g.name}
                  avatarUrl={g.avatarUrl}
                  fallback={`${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}${g.description ? ` · ${g.description}` : ''}`}
                  end={
                    <View style={tw`flex-row items-center gap-1`}>
                      {admin ? (
                        <IconButton
                          icon={Unlink}
                          label={`Remove ${g.name} from community`}
                          size="sm"
                          onPress={() => void unlink(g)}
                        />
                      ) : null}
                      <Button
                        size="sm"
                        variant="soft"
                        loading={joining === g.chatId}
                        onPress={() => void join(g)}
                        accessibilityLabel={`Join ${g.name}`}
                      >
                        Join
                      </Button>
                    </View>
                  }
                />
              ))}
            </InfoSection>
          ) : null}

          {admin ? (
            <InfoSection>
              <InfoRow
                icon={Plus}
                label="Add groups"
                description="Create a new group or add groups you manage"
                onPress={() => setSheet('groups')}
              />
              <InfoRow
                icon={UsersRound}
                label="Members"
                value={String(c.memberCount)}
                onPress={() => setSheet('members')}
              />
              <InfoRow icon={Link2} label="Invite link" onPress={() => setSheet('invite')} />
            </InfoSection>
          ) : null}

          <InfoSection>
            <InfoRow icon={LogOut} label="Exit community" danger onPress={() => void leave()} />
            {owner ? (
              <InfoRow
                icon={Power}
                label="Deactivate community"
                danger
                onPress={() => void deactivate()}
              />
            ) : null}
          </InfoSection>
        </InfoPage>
      </ScrollView>

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} scroll={false}>
        {sheet === 'members' ? (
          <CommunityMembersView community={c} onClose={() => setSheet(null)} />
        ) : sheet === 'invite' ? (
          <InviteLinkView
            title="Invite members"
            kind="community"
            name={c.name}
            avatar={
              <Avatar src={c.avatarUrl} name={c.name} colorSeed={c.id} kind="community" size="lg" />
            }
            code={c.inviteCode}
            load={() => store().getInvite(c.id)}
            reset={() => store().resetInvite(c.id)}
            onBack={() => setSheet(null)}
          />
        ) : sheet === 'groups' ? (
          <AddGroupsView community={c} onClose={() => setSheet(null)} />
        ) : null}
      </Sheet>

      <EditInfoModal
        open={edit === 'all'}
        onClose={() => setEdit(null)}
        title="Edit community"
        initialName={c.name}
        initialDescription={c.description ?? ''}
        nameMax={MAX_GROUP_NAME_LENGTH}
        descriptionMax={MAX_DESCRIPTION_LENGTH}
        onSave={async (patch) => {
          await store().updateCommunity(c.id, patch);
          toast.success('Community updated');
        }}
      />
      <EditTextModal
        open={edit === 'name'}
        onClose={() => setEdit(null)}
        title="Community name"
        label="Name"
        initial={c.name}
        maxLength={MAX_GROUP_NAME_LENGTH}
        required
        onSave={async (v) => {
          await store().updateCommunity(c.id, { name: v });
          toast.success('Community name updated');
        }}
      />
      <EditTextModal
        open={edit === 'description'}
        onClose={() => setEdit(null)}
        title="Community description"
        label="Description"
        initial={c.description ?? ''}
        maxLength={MAX_DESCRIPTION_LENGTH}
        multiline
        placeholder="What is this community about?"
        onSave={async (v) => {
          await store().updateCommunity(c.id, { description: v || null });
          toast.success('Description updated');
        }}
      />
    </View>
  );
}
