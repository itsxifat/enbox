/**
 * Channel info (web features/channels/ChannelInfoPanel.tsx): followers, description,
 * share/invite link, mute, unfollow; admins edit info and settings (visibility, reactions);
 * the owner manages admins, transfers ownership and deletes the channel.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  Crown,
  Globe,
  Image as ImageIcon,
  Link2,
  Lock,
  LogOut,
  Pencil,
  Share2,
  ShieldCheck,
  ShieldMinus,
  SlidersHorizontal,
  Star,
  Trash2,
  Users,
} from 'lucide-react-native';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  chatTitle,
  isMuted,
  userDisplayName,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Menu,
  Press,
  RadioGroup,
  SearchInput,
  Switch,
  T,
  confirm,
  toast,
} from '@/components/ui';
import { MemberRow } from '@/features/groups/GroupMembers';
import { sortMembers, useChatMembers } from '@/features/groups/members';
import { matchesUser } from '@/features/groups/shared/candidates';
import { setMuted } from '@/features/groups/shared/chatActions';
import { EditTextModal, MuteModal } from '@/features/groups/shared/dialogs';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { InfoPage, InfoRow, InfoSection, QuickAction } from '@/features/groups/shared/InfoLayout';
import { InviteLinkView } from '@/features/groups/shared/InviteLinkView';
import { MediaGalleryView, RichText } from '@/features/groups/shared/MediaGallery';
import {
  mediaTotal,
  useChatMediaCounts,
  useStarredCount,
} from '@/features/groups/shared/mediaCounts';
import { shareLink } from '@/features/groups/shared/share';
import { StarredView } from '@/features/groups/shared/StarredView';
import { formatCount, formatShortDate } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { useChat } from '@/stores/chats';
import { useTheme } from '@/theme';
import {
  channelUrl,
  deleteChannel,
  getChannelInvite,
  resetChannelInvite,
  setChannelAdmin,
  transferChannelOwnership,
  unfollowChannel,
  updateChannel,
} from './channelApi';

export function ChannelInfoPanel({ chatId, onClose }) {
  const chat = useChat(chatId);
  const [view, setView] = useState('main');
  if (!chat) return null;
  const back = () => setView('main');
  switch (view) {
    case 'settings':
      return <ChannelSettingsView chat={chat} onBack={back} />;
    case 'invite':
      return (
        <InviteLinkView
          title="Invite link"
          kind="channel"
          name={chatTitle(chat)}
          avatar={<ChatAvatar chat={chat} size="lg" />}
          code={chat.inviteCode}
          load={() => getChannelInvite(chat.id)}
          reset={chat.permissions.canInvite ? () => resetChannelInvite(chat.id) : undefined}
          onBack={back}
        />
      );
    case 'admins':
      return <ChannelPeopleView chat={chat} onBack={back} />;
    case 'media':
      return <MediaGalleryView chatId={chat.id} title={chatTitle(chat)} onBack={back} />;
    case 'starred':
      return <StarredView chat={chat} onBack={back} />;
    default:
      return <ChannelInfoMain chat={chat} onClose={onClose} go={setView} />;
  }
}

function ChannelInfoMain({ chat, onClose, go }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const p = chat.permissions;
  const mediaCounts = useChatMediaCounts(chat.id);
  const starredCount = useStarredCount(chat.id);
  const owner = chat.myRole === 'owner';
  const isPublic = chat.channelSettings?.isPublic ?? false;
  const muted = isMuted(chat.mutedUntil);
  const [edit, setEdit] = useState(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const title = chatTitle(chat);

  const share = () => {
    if (isPublic)
      void shareLink({ title, text: `Follow “${title}” on Enbox`, url: channelUrl(chat.id) });
    else if (p.canInvite) go('invite');
  };

  const unfollow = async () => {
    const ok = await confirm({
      title: `Unfollow ${title}?`,
      message: 'You will stop receiving updates from this channel.',
      confirmLabel: 'Unfollow',
      danger: true,
    });
    if (!ok) return;
    try {
      await unfollowChannel(chat.id);
      onClose();
      toast.success(`Unfollowed ${title}`);
      router.replace('/updates');
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${title}?`,
      message: `The channel and all its posts will be deleted for its ${formatCount(chat.memberCount)} followers. This can't be undone.`,
      confirmLabel: 'Delete channel',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChannel(chat.id);
      onClose();
      toast.success('Channel deleted');
      router.replace('/updates');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Channel info" back={onClose} />
      <ScrollView>
        <InfoPage>
          <View style={tw`items-center px-6 pt-7 pb-5`}>
            <EditableAvatar
              src={chat.avatarUrl}
              name={title}
              colorSeed={chat.id}
              kind="channel"
              size={136}
              editable={p.canEditInfo}
              label="Change channel icon"
              onUploaded={async (m) => {
                await updateChannel(chat.id, { avatarMediaId: m.id });
                toast.success('Channel icon updated');
              }}
              onRemove={
                chat.avatarUrl
                  ? async () => {
                      await updateChannel(chat.id, { avatarMediaId: null });
                      toast.success('Channel icon removed');
                    }
                  : undefined
              }
            />
            <View style={tw`mt-4 max-w-full flex-row items-center gap-1`}>
              <T numberOfLines={1} style={tw`shrink text-[24px] font-semibold leading-tight`}>
                {title}
              </T>
              {p.canEditInfo ? (
                <IconButton
                  icon={Pencil}
                  label="Edit channel name"
                  size="sm"
                  onPress={() => setEdit('name')}
                />
              ) : null}
            </View>
            <View style={tw`mt-1 flex-row items-center gap-1.5`}>
              <Icon icon={isPublic ? Globe : Lock} size={14} color={c.muted} />
              <T style={tw`text-[15px] text-muted`}>
                {isPublic ? 'Public channel' : 'Private channel'} · {formatCount(chat.memberCount)}{' '}
                {chat.memberCount === 1 ? 'follower' : 'followers'}
              </T>
            </View>
            <View style={tw`mt-5 flex-row flex-wrap justify-center gap-2.5`}>
              {isPublic || p.canInvite ? (
                <QuickAction icon={Share2} label="Share" onPress={share} />
              ) : null}
              <QuickAction
                icon={Bell}
                label={muted ? 'Unmute' : 'Mute'}
                onPress={() =>
                  muted
                    ? void setMuted(chat.id, null)
                        .then(() => toast.success('Channel unmuted'))
                        .catch((e) => toast.error(e))
                    : setMuteOpen(true)
                }
              />
              {p.canViewMembers ? (
                <QuickAction icon={Users} label="Followers" onPress={() => go('admins')} />
              ) : null}
            </View>
          </View>

          {chat.description || p.canEditInfo ? (
            <InfoSection>
              {chat.description ? (
                <View style={tw`flex-row items-start gap-2 px-5 py-2`}>
                  <View style={tw`min-w-0 flex-1`}>
                    <RichText
                      text={chat.description}
                      style={[tw`text-[15px]`, { lineHeight: 24 }]}
                    />
                    <T style={tw`mt-2 text-[13px] text-muted`}>
                      Created {formatShortDate(chat.createdAt)}
                    </T>
                  </View>
                  {p.canEditInfo ? (
                    <IconButton
                      icon={Pencil}
                      label="Edit channel description"
                      size="sm"
                      onPress={() => setEdit('description')}
                    />
                  ) : null}
                </View>
              ) : (
                <Press onPress={() => setEdit('description')} style={tw`px-5 py-2`}>
                  <T style={tw`text-[15px] font-medium text-brand-ink`}>Add channel description</T>
                  <T style={tw`mt-1 text-[13px] text-muted`}>
                    Created {formatShortDate(chat.createdAt)}
                  </T>
                </Press>
              )}
            </InfoSection>
          ) : null}

          <InfoSection>
            <InfoRow
              icon={ImageIcon}
              label="Media, links and docs"
              value={mediaCounts ? String(mediaTotal(mediaCounts)) : undefined}
              onPress={() => go('media')}
            />
            <InfoRow
              icon={Star}
              label="Starred messages"
              value={starredCount ? String(starredCount) : undefined}
              onPress={() => go('starred')}
            />
          </InfoSection>

          <InfoSection>
            <InfoRow
              icon={Bell}
              label="Mute notifications"
              description="Muted channels don't show new-post badges"
              trailing={
                <Switch
                  checked={muted}
                  onChange={(on) =>
                    on
                      ? setMuteOpen(true)
                      : void setMuted(chat.id, null).catch((e) => toast.error(e))
                  }
                />
              }
            />
            {p.canEditInfo ? (
              <InfoRow
                icon={SlidersHorizontal}
                label="Channel settings"
                description="Visibility and reactions"
                onPress={() => go('settings')}
              />
            ) : null}
            {p.canInvite ? (
              <InfoRow icon={Link2} label="Invite link" onPress={() => go('invite')} />
            ) : null}
            {p.canViewMembers ? (
              <InfoRow
                icon={ShieldCheck}
                label={p.canManageAdmins ? 'Admins & followers' : 'Followers'}
                value={formatCount(chat.memberCount)}
                onPress={() => go('admins')}
              />
            ) : null}
          </InfoSection>

          <InfoSection>
            {p.canLeave ? (
              <InfoRow
                icon={LogOut}
                label="Unfollow channel"
                danger
                onPress={() => void unfollow()}
              />
            ) : null}
            {owner ? (
              <>
                <T style={tw`px-5 py-2 text-[13px] text-muted`}>
                  You own this channel. To stop following it, transfer ownership to an admin first.
                </T>
                <InfoRow
                  icon={Trash2}
                  label="Delete channel"
                  danger
                  onPress={() => void remove()}
                />
              </>
            ) : null}
          </InfoSection>
        </InfoPage>
      </ScrollView>

      <EditTextModal
        open={edit === 'name'}
        onClose={() => setEdit(null)}
        title="Channel name"
        label="Name"
        initial={chat.name ?? ''}
        maxLength={MAX_GROUP_NAME_LENGTH}
        required
        onSave={async (v) => {
          await updateChannel(chat.id, { name: v });
          toast.success('Channel name updated');
        }}
      />
      <EditTextModal
        open={edit === 'description'}
        onClose={() => setEdit(null)}
        title="Channel description"
        label="Description"
        initial={chat.description ?? ''}
        maxLength={MAX_DESCRIPTION_LENGTH}
        multiline
        placeholder="Tell followers what this channel is about"
        onSave={async (v) => {
          await updateChannel(chat.id, { description: v || null });
          toast.success('Description updated');
        }}
      />
      <MuteModal
        open={muteOpen}
        kind="channel"
        onClose={() => setMuteOpen(false)}
        onMute={(until) => setMuted(chat.id, until).then(() => toast.success('Channel muted'))}
      />
    </View>
  );
}

function ChannelSettingsView({ chat, onBack }) {
  const { tw } = useTheme();
  const [pending, setPending] = useState({});
  const value = { isPublic: true, reactions: 'all', ...chat.channelSettings, ...pending };
  const change = async (patch) => {
    setPending((s) => ({ ...s, ...patch }));
    try {
      await updateChannel(chat.id, patch);
      toast.success('Channel settings saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setPending({});
    }
  };
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title="Channel settings" back={onBack} />
      <ScrollView>
        <InfoPage>
          <InfoSection title="Who can find this channel">
            <RadioGroup
              style={tw`px-5`}
              value={value.isPublic ? 'public' : 'private'}
              onChange={(v) => void change({ isPublic: v === 'public' })}
              options={[
                {
                  value: 'public',
                  label: 'Public',
                  description:
                    'Anyone can find it in the channel directory, preview it and follow it.',
                },
                {
                  value: 'private',
                  label: 'Private',
                  description:
                    'Hidden from the directory. People can only follow it with the invite link.',
                },
              ]}
            />
          </InfoSection>
          <InfoSection title="Reactions">
            <RadioGroup
              style={tw`px-5`}
              value={value.reactions}
              onChange={(v) => void change({ reactions: v })}
              options={[
                {
                  value: 'all',
                  label: 'Any emoji',
                  description: 'Followers can react with any emoji.',
                },
                {
                  value: 'quick',
                  label: 'Default emoji only',
                  description: 'Followers pick from 👍 ❤️ 😂 😮 😢 🙏',
                },
                {
                  value: 'none',
                  label: 'No reactions',
                  description: 'Followers can’t react to posts.',
                },
              ]}
            />
          </InfoSection>
          <T style={[tw`px-5 text-[13px] text-muted`, { lineHeight: 21 }]}>
            Followers never see each other, and reactions and poll votes stay anonymous.
          </T>
        </InfoPage>
      </ScrollView>
    </View>
  );
}

function ChannelPeopleView({ chat, onBack }) {
  const { tw } = useTheme();
  const { members, error, reload } = useChatMembers(chat.id, chat.permissions.canViewMembers);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(null);
  const meId = getMyId();
  const list = useMemo(
    () => sortMembers(members ?? [], meId).filter((m) => matchesUser(m.user, query)),
    [members, meId, query],
  );
  const admins = list.filter((m) => m.role !== 'member');
  const followers = list.filter((m) => m.role === 'member');
  const canManage = chat.permissions.canManageAdmins;

  const run = async (fn, done) => {
    try {
      await fn();
      toast.success(done);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const items = [];
  if (menu && canManage) {
    const u = menu.member.user;
    const name = userDisplayName(u);
    if (menu.member.role === 'member')
      items.push({
        label: 'Make channel admin',
        icon: ShieldCheck,
        onSelect: () =>
          void run(() => setChannelAdmin(chat.id, u.id, true), `${name} is now an admin`),
      });
    if (menu.member.role === 'admin')
      items.push({
        label: 'Dismiss as admin',
        icon: ShieldMinus,
        onSelect: () =>
          void run(() => setChannelAdmin(chat.id, u.id, false), `${name} is no longer an admin`),
      });
    items.push({
      label: 'Transfer ownership',
      icon: Crown,
      onSelect: () =>
        void confirm({
          title: `Make ${name} the owner?`,
          message: `${name} will own “${chatTitle(chat)}”. You'll stay on as an admin.`,
          confirmLabel: 'Transfer',
        }).then((ok) => {
          if (ok)
            void run(() => transferChannelOwnership(chat.id, u.id), `${name} now owns the channel`);
        }),
    });
  }

  const row = (m) => (
    <MemberRow
      key={m.user.id}
      member={m}
      meId={meId}
      kind="channel"
      onPress={
        canManage && m.role !== 'owner' ? (anchor) => setMenu({ member: m, anchor }) : undefined
      }
    />
  );

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title={canManage ? 'Admins & followers' : 'Followers'}
        subtitle={`${formatCount(chat.memberCount)} ${chat.memberCount === 1 ? 'follower' : 'followers'}`}
        back={onBack}
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search followers" />
      </PaneHeader>
      {members === null && !error ? (
        <ListItemSkeleton count={5} />
      ) : error ? (
        <EmptyState compact icon={Users} title="Couldn't load followers" description={error} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {admins.length ? (
            <View>
              <T style={tw`px-5 pt-3 pb-1 text-[13px] font-semibold text-brand-ink`}>Admins</T>
              {admins.map(row)}
            </View>
          ) : null}
          <View>
            <T style={tw`px-5 pt-3 pb-1 text-[13px] font-semibold text-brand-ink`}>Followers</T>
            {followers.length ? (
              followers.map(row)
            ) : (
              <T style={tw`px-5 py-2 text-[14px] text-muted`}>
                {query
                  ? 'No matches.'
                  : 'No followers yet. Share the channel to grow your audience.'}
              </T>
            )}
          </View>
          {canManage ? (
            <T style={tw`px-5 py-3 text-[13px] text-muted`}>
              Admins can post, edit channel info and settings, and delete posts. Tap a follower to
              make them an admin.
            </T>
          ) : null}
        </ScrollView>
      )}
      <Menu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={items}
        align="end"
      />
    </View>
  );
}
