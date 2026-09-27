/**
 * Group info (web features/groups/GroupInfoPanel.tsx), shown by the conversation in a
 * <Sheet>; props `{ chatId, onClose }`. Drill-in pages: main → members / add members /
 * invite link / settings / media / starred. Everything is gated by `chat.permissions`; the
 * member list refreshes on `chat:members-changed`, the rest follows the chats store.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  ChevronRight,
  Clock3,
  Eraser,
  Image as ImageIcon,
  Link2,
  LogOut,
  Megaphone,
  Palette,
  Pencil,
  Search,
  Settings2,
  Star,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react-native';
import { MAX_DESCRIPTION_LENGTH, MAX_GROUP_NAME_LENGTH, chatTitle, isMuted } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { ICON_STROKE_ON_FILL, Icon, PhoneIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, IconButton, Press, Skeleton, Switch, T, confirm, toast } from '@/components/ui';
import { ChatThemeSheet } from '@/features/appearance/ChatThemeSheet';
import { chatThemeLabel } from '@/features/appearance/presets';
import { formatShortDate } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { useUserName } from '@/stores/users';
import { useTheme } from '@/theme';
import { GroupPermissionsFields } from './GroupPermissions';
import { MemberRow, MembersView, useGroupMemberMenu } from './GroupMembers';
import { sortMembers, useChatMembers } from './members';
import { AddResultModal, hasProblems } from './shared/AddResultModal';
import {
  addGroupMembers,
  clearChatHistory,
  deleteChatForMe,
  getGroupInvite,
  leaveGroup,
  resetGroupInvite,
  setDisappearing,
  setMuted,
  updateGroup,
  updateGroupSettings,
} from './shared/chatActions';
import { DisappearingModal, EditTextModal, MuteModal, disappearingLabel } from './shared/dialogs';
import { EditableAvatar } from './shared/EditableAvatar';
import { InfoPage, InfoRow, InfoSection, QuickAction } from './shared/InfoLayout';
import { InviteLinkView } from './shared/InviteLinkView';
import { MediaGalleryView, MediaPreviewStrip, RichText } from './shared/MediaGallery';
import { mediaTotal, useChatMediaCounts, useStarredCount } from './shared/mediaCounts';
import { StarredView } from './shared/StarredView';
import { UserPicker } from './shared/UserPicker';

const PREVIEW_MEMBERS = 10;

/** Owner or admin of the group (group settings and invite reset are admin-only server-side). */
function isAdmin(chat) {
  return chat.membership === 'active' && (chat.myRole === 'owner' || chat.myRole === 'admin');
}

export function GroupInfoPanel({ chatId, onClose }) {
  const chat = useChat(chatId);
  const [view, setView] = useState('main');
  const active = chat?.membership === 'active';
  const members = useChatMembers(chatId, !!chat && active && chat.permissions.canViewMembers);

  // Drop out of pages the viewer lost access to (removed, demoted…).
  useEffect(() => {
    if (!chat) return;
    const p = chat.permissions;
    if (
      (view === 'add' && !p.canAddMembers) ||
      (view === 'invite' && !p.canInvite) ||
      (view === 'settings' && !isAdmin(chat)) ||
      (view === 'members' && !p.canViewMembers)
    )
      setView('main');
  }, [chat, view]);

  if (!chat) return null;
  const back = () => setView('main');
  switch (view) {
    case 'members':
      return (
        <MembersView
          chat={chat}
          members={members.members}
          error={members.error}
          onBack={back}
          onChanged={members.reload}
        />
      );
    case 'add':
      return (
        <AddMembersView
          chat={chat}
          members={members.members}
          onBack={back}
          onDone={() => {
            members.reload();
            setView('main');
          }}
          onInvite={() => setView('invite')}
        />
      );
    case 'invite':
      return (
        <InviteLinkView
          title="Invite via link"
          kind="group"
          name={chatTitle(chat)}
          avatar={<ChatAvatar chat={chat} size="lg" />}
          code={chat.inviteCode}
          load={() => getGroupInvite(chat.id)}
          reset={isAdmin(chat) ? () => resetGroupInvite(chat.id) : undefined}
          onBack={back}
        />
      );
    case 'settings':
      return <GroupSettingsView chat={chat} onBack={back} />;
    case 'media':
      return <MediaGalleryView chatId={chat.id} title={chatTitle(chat)} onBack={back} />;
    case 'starred':
      return <StarredView chat={chat} onBack={back} />;
    default:
      return (
        <GroupInfoMain
          chat={chat}
          onClose={onClose}
          go={setView}
          members={members.members}
          membersError={members.error}
          reloadMembers={members.reload}
        />
      );
  }
}

function GroupInfoMain({ chat, onClose, go, members, membersError, reloadMembers }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const meId = getMyId();
  const p = chat.permissions;
  const active = chat.membership === 'active';
  const announcement = chat.isAnnouncement;
  const community = useCommunities((s) => (chat.communityId ? s.byId[chat.communityId] : undefined));
  const communitiesLoaded = useCommunities((s) => s.loaded);
  // `createdBy` is viewer-neutral (announcements: the community's creator).
  const creator = chat.createdBy;
  const creatorName = useUserName(creator);
  const mediaCounts = useChatMediaCounts(chat.id);
  const starredCount = useStarredCount(chat.id);
  const muted = isMuted(chat.mutedUntil);
  const [edit, setEdit] = useState(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const menu = useGroupMemberMenu(chat, reloadMembers);

  useEffect(() => {
    if (chat.communityId && !communitiesLoaded)
      void useCommunities
        .getState()
        .loadCommunities()
        .catch(() => undefined);
  }, [chat.communityId, communitiesLoaded]);

  const sorted = useMemo(() => sortMembers(members ?? [], meId), [members, meId]);
  const title = chatTitle(chat);
  const noun = announcement ? 'Announcements' : 'Group';

  const toCommunity = () => {
    onClose();
    router.push(`/communities/${chat.communityId}`);
  };

  const exit = async () => {
    const owner = chat.myRole === 'owner';
    const ok = await confirm({
      title: `Exit “${title}”?`,
      message: owner
        ? 'You own this group. If you exit, the longest-serving admin becomes the owner — or, if there are no admins, the longest-serving member.'
        : 'You will stop receiving messages from this group. Admins may add you back later.',
      confirmLabel: 'Exit group',
      danger: true,
    });
    if (!ok) return;
    try {
      await leaveGroup(chat.id);
      toast.success(`You left “${title}”`);
    } catch (e) {
      toast.error(e);
    }
  };

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear this chat?',
      message:
        'Messages will be removed from this device and your other devices. Starred messages are removed too.',
      confirmLabel: 'Clear chat',
      danger: true,
    });
    if (!ok) return;
    try {
      await clearChatHistory(chat.id);
      toast.success('Chat cleared');
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${title}”?`,
      message:
        'The group and its messages will be deleted from your chat list on all your devices.',
      confirmLabel: 'Delete group',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChatForMe(chat.id);
      onClose();
      toast.success('Group deleted');
      router.replace('/chats');
    } catch (e) {
      toast.error(e);
    }
  };

  const createdLine = [
    creator ? `Created by ${creatorName}` : 'Created',
    formatShortDate(chat.createdAt),
  ].join(', ');

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title={announcement ? 'Announcements info' : 'Group info'} back={onClose} />
      <ScrollView style={tw`min-h-0 flex-1`}>
        <InfoPage>
          {/* Hero */}
          <View style={tw`items-center bg-surface px-6 pt-7 pb-5`}>
            <EditableAvatar
              src={chat.avatarUrl}
              name={title}
              colorSeed={chat.id}
              kind={announcement ? 'community' : 'group'}
              size={136}
              editable={active && p.canEditInfo}
              label="Change group icon"
              onUploaded={async (m) => {
                await updateGroup(chat.id, { avatarMediaId: m.id });
                toast.success('Group icon updated');
              }}
              onRemove={
                chat.avatarUrl
                  ? async () => {
                      await updateGroup(chat.id, { avatarMediaId: null });
                      toast.success('Group icon removed');
                    }
                  : undefined
              }
            />
            <View style={tw`mt-4 max-w-full flex-row items-center gap-1`}>
              <T numberOfLines={1} style={tw`shrink text-[24px] font-semibold leading-tight`}>
                {title}
              </T>
              {active && p.canEditInfo ? (
                <IconButton
                  icon={Pencil}
                  label="Edit group name"
                  size="sm"
                  onPress={() => setEdit('name')}
                />
              ) : null}
            </View>
            <T style={tw`mt-1 text-[15px] text-muted`}>
              {noun} · {chat.memberCount} {chat.memberCount === 1 ? 'member' : 'members'}
            </T>
            {active && (p.canCall || p.canAddMembers) ? (
              <View style={tw`mt-5 flex-row flex-wrap justify-center gap-2.5`}>
                {p.canCall ? (
                  <>
                    <QuickAction
                      icon={PhoneIcon}
                      label="Audio"
                      onPress={() => void useCalls.getState().startCall(chat.id, 'audio')}
                    />
                    <QuickAction
                      icon={VideoIcon}
                      label="Video"
                      onPress={() => void useCalls.getState().startCall(chat.id, 'video')}
                    />
                  </>
                ) : null}
                {p.canAddMembers ? (
                  <QuickAction icon={UserPlus} label="Add" onPress={() => go('add')} />
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Description */}
          {chat.description || (active && p.canEditInfo) ? (
            <InfoSection>
              {chat.description ? (
                <View style={tw`flex-row items-start gap-2 px-5 py-2`}>
                  <View style={tw`min-w-0 flex-1`}>
                    <RichText
                      text={chat.description}
                      style={[tw`text-[15px]`, { lineHeight: 24 }]}
                    />
                    <T style={tw`mt-2 text-[13px] text-muted`}>{createdLine}</T>
                  </View>
                  {active && p.canEditInfo ? (
                    <IconButton
                      icon={Pencil}
                      label="Edit group description"
                      size="sm"
                      onPress={() => setEdit('description')}
                    />
                  ) : null}
                </View>
              ) : (
                <Press onPress={() => setEdit('description')} style={tw`px-5 py-2`}>
                  <T style={tw`text-[15px] font-medium text-brand-ink`}>Add group description</T>
                  <T style={tw`mt-1 text-[13px] text-muted`}>{createdLine}</T>
                </Press>
              )}
            </InfoSection>
          ) : (
            <InfoSection>
              <T style={tw`px-5 py-1 text-[13px] text-muted`}>{createdLine}</T>
            </InfoSection>
          )}

          {/* Community */}
          {chat.communityId ? (
            <InfoSection>
              <InfoRow
                icon={announcement ? Megaphone : UsersRound}
                label={
                  community ? (
                    <T style={tw`text-[15.5px] leading-snug`}>
                      {announcement ? 'Announcements of ' : 'Part of '}
                      <T style={tw`font-semibold`}>{community.name}</T>
                    </T>
                  ) : (
                    'Part of a community'
                  )
                }
                description={
                  announcement
                    ? 'Only community admins can send messages here.'
                    : 'Community members can find and join this group.'
                }
                onPress={toCommunity}
              />
            </InfoSection>
          ) : null}

          {/* Media & starred */}
          <InfoSection>
            <InfoRow
              icon={ImageIcon}
              label="Media, links and docs"
              value={mediaCounts ? String(mediaTotal(mediaCounts)) : undefined}
              onPress={() => go('media')}
            />
            <MediaPreviewStrip chatId={chat.id} onOpen={() => go('media')} />
            <InfoRow
              icon={Star}
              label="Starred messages"
              value={starredCount ? String(starredCount) : undefined}
              onPress={() => go('starred')}
            />
          </InfoSection>

          {/* Preferences */}
          {active ? (
            <InfoSection>
              <InfoRow
                icon={Bell}
                label="Mute notifications"
                description={
                  muted
                    ? chat.mutedUntil && chat.mutedUntil.startsWith('9999')
                      ? 'Muted always'
                      : `Muted until ${formatShortDate(chat.mutedUntil)}`
                    : undefined
                }
                trailing={
                  <Switch
                    accessibilityLabel="Mute notifications"
                    checked={muted}
                    onChange={(on) => {
                      if (on) setMuteOpen(true);
                      else
                        void setMuted(chat.id, null)
                          .then(() => toast.success('Notifications unmuted'))
                          .catch((e) => toast.error(e));
                    }}
                  />
                }
              />
              <InfoRow
                icon={Clock3}
                label="Disappearing messages"
                description={
                  p.canEditInfo
                    ? undefined
                    : announcement
                      ? 'Managed by the community'
                      : 'Only admins can change the timer in this group'
                }
                value={disappearingLabel(chat.disappearingSeconds)}
                onPress={p.canEditInfo ? () => setTimerOpen(true) : undefined}
              />
              <InfoRow
                icon={Palette}
                label="Chat theme"
                value={chatThemeLabel(chat)}
                onPress={() => setThemeOpen(true)}
              />
              {isAdmin(chat) && !announcement ? (
                <InfoRow icon={Settings2} label="Group settings" onPress={() => go('settings')} />
              ) : null}
            </InfoSection>
          ) : (
            <InfoSection>
              <T
                accessibilityRole="text"
                style={[tw`px-5 py-2 text-[14px] text-muted`, { lineHeight: 22.75 }]}
              >
                {chat.membership === 'removed'
                  ? 'You were removed from this group. You can still read the messages sent while you were a member.'
                  : "You're no longer a member of this group. You can still read the messages sent while you were a member."}
              </T>
            </InfoSection>
          )}

          {/* Members */}
          {active && p.canViewMembers ? (
            <InfoSection
              accessibilityLabel="Members"
              title={`${chat.memberCount} ${chat.memberCount === 1 ? 'member' : 'members'}`}
              action={
                <IconButton
                  icon={Search}
                  label="Search members"
                  size="sm"
                  onPress={() => go('members')}
                />
              }
            >
              {p.canAddMembers ? (
                <ActionRow icon={UserPlus} label="Add members" onPress={() => go('add')} />
              ) : null}
              {p.canInvite ? (
                <ActionRow icon={Link2} label="Invite via link" onPress={() => go('invite')} />
              ) : null}
              {members === null && !membersError ? (
                <View style={tw`gap-3 px-5 py-3`}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={tw`flex-row items-center gap-3`}>
                      <Skeleton circle style={tw`size-10`} />
                      <Skeleton style={[tw`h-3.5`, { width: '33%' }]} />
                    </View>
                  ))}
                </View>
              ) : membersError ? (
                <T style={tw`px-5 py-3 text-[14px] text-danger`}>{membersError}</T>
              ) : (
                sorted
                  .slice(0, PREVIEW_MEMBERS)
                  .map((m) => (
                    <MemberRow
                      key={m.user.id}
                      member={m}
                      meId={meId}
                      onPress={(a) => menu.open(m, a)}
                    />
                  ))
              )}
              {sorted.length > PREVIEW_MEMBERS ? (
                <Press
                  onPress={() => go('members')}
                  style={tw`flex-row items-center justify-between px-5 py-3`}
                >
                  <T style={tw`text-[15px] font-medium text-brand-ink`}>
                    View all ({sorted.length - PREVIEW_MEMBERS} more)
                  </T>
                  <Icon icon={ChevronRight} size={18} color={c['brand-ink']} />
                </Press>
              ) : null}
            </InfoSection>
          ) : null}

          {/* Danger zone */}
          <InfoSection>
            {announcement && active ? (
              <InfoRow
                icon={UsersRound}
                label="Go to community"
                description="Leave the community from its page to stop receiving announcements."
                onPress={toCommunity}
              />
            ) : null}
            {active && p.canLeave ? (
              <InfoRow icon={LogOut} label="Exit group" danger onPress={() => void exit()} />
            ) : null}
            <InfoRow icon={Eraser} label="Clear chat" danger onPress={() => void clear()} />
            {!active ? (
              <InfoRow icon={Trash2} label="Delete group" danger onPress={() => void remove()} />
            ) : null}
          </InfoSection>
        </InfoPage>
      </ScrollView>

      <EditTextModal
        open={edit === 'name'}
        onClose={() => setEdit(null)}
        title="Group name"
        label="Name"
        initial={chat.name ?? ''}
        maxLength={MAX_GROUP_NAME_LENGTH}
        required
        onSave={async (v) => {
          await updateGroup(chat.id, { name: v });
          toast.success('Group name updated');
        }}
      />
      <EditTextModal
        open={edit === 'description'}
        onClose={() => setEdit(null)}
        title="Group description"
        label="Description"
        initial={chat.description ?? ''}
        maxLength={MAX_DESCRIPTION_LENGTH}
        multiline
        placeholder="Add a description for the group"
        onSave={async (v) => {
          await updateGroup(chat.id, { description: v || null });
          toast.success('Description updated');
        }}
      />
      <MuteModal
        open={muteOpen}
        kind="group"
        onClose={() => setMuteOpen(false)}
        onMute={(until) => setMuted(chat.id, until)}
      />
      <DisappearingModal
        open={timerOpen}
        onClose={() => setTimerOpen(false)}
        current={chat.disappearingSeconds}
        onSave={async (s) => {
          await setDisappearing(chat.id, s);
          toast.success(
            s ? `Disappearing messages: ${disappearingLabel(s)}` : 'Disappearing messages off',
          );
        }}
      />
      {menu.element}
      {themeOpen ? <ChatThemeSheet chat={chat} onClose={() => setThemeOpen(false)} /> : null}
    </View>
  );
}

function ActionRow({ icon, label, onPress }) {
  const { tw, c } = useTheme();
  return (
    <Press onPress={onPress} style={tw`flex-row items-center gap-3 px-5 py-2.5`}>
      <View style={tw`size-10 items-center justify-center rounded-full bg-brand`}>
        <Icon icon={icon} size={20} strokeWidth={ICON_STROKE_ON_FILL} color={c['on-brand']} />
      </View>
      <T style={tw`text-[15.5px] font-medium`}>{label}</T>
    </Press>
  );
}

function GroupSettingsView({ chat, onBack }) {
  const { tw } = useTheme();
  const [pending, setPending] = useState({});
  const value = { ...chat.groupSettings, ...pending };
  const change = async (key, next) => {
    setPending((s) => ({ ...s, [key]: next }));
    try {
      await updateGroupSettings(chat.id, { [key]: next });
    } catch (e) {
      toast.error(e);
    } finally {
      setPending((s) => {
        const copy = { ...s };
        delete copy[key];
        return copy;
      });
    }
  };
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Group settings" back={onBack} />
      <ScrollView style={tw`min-h-0 flex-1`}>
        <InfoPage>
          <InfoSection style={tw`px-5`}>
            <GroupPermissionsFields value={value} onChange={(k, v) => void change(k, v)} />
          </InfoSection>
          <T style={[tw`px-5 text-[13px] text-muted`, { lineHeight: 21 }]}>
            Admins can always send messages, edit group info and add members. Every change is
            announced in the chat.
          </T>
        </InfoPage>
      </ScrollView>
    </View>
  );
}

function AddMembersView({ chat, members, onBack, onDone, onInvite }) {
  const { tw, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const disabled = useMemo(
    () => new Map((members ?? []).map((m) => [m.user.id, 'Already added to the group'])),
    [members],
  );

  const toggle = (u) =>
    setSelected((list) =>
      list.some((x) => x.id === u.id) ? list.filter((x) => x.id !== u.id) : [...list, u],
    );

  const add = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const r = await addGroupMembers(
        chat.id,
        selected.map((u) => u.id),
      );
      if (r.added.length)
        toast.success(r.added.length === 1 ? 'Member added' : `${r.added.length} members added`);
      if (hasProblems(r)) setResult(r);
      else onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Add members"
        subtitle={selected.length ? `${selected.length} selected` : chatTitle(chat)}
        back={onBack}
      />
      <UserPicker
        selected={selected}
        onToggle={toggle}
        query={query}
        onQueryChange={setQuery}
        disabled={disabled}
        autoFocus
        header={
          chat.permissions.canInvite && !query ? (
            <ActionRow icon={Link2} label="Invite via link" onPress={onInvite} />
          ) : null
        }
      />
      {selected.length ? (
        <View
          style={[
            tw`bg-surface px-4 pt-3`,
            { paddingBottom: Math.max(12, insets.bottom) },
            shadow.elevated,
          ]}
        >
          <Button fullWidth size="lg" loading={busy} onPress={() => void add()} leftIcon={UserPlus}>
            {`Add ${
              selected.length === 1 ? selected[0].displayName.split(' ')[0] : `${selected.length} people`
            }`}
          </Button>
        </View>
      ) : null}
      <AddResultModal
        result={result}
        name={chatTitle(chat)}
        kind="group"
        inviteCode={chat.inviteCode}
        onClose={() => {
          setResult(null);
          onDone();
        }}
      />
    </View>
  );
}
