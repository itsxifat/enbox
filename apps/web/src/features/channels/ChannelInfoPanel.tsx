/**
 * Channel info (in a <Sheet>; contract `{ chatId, onClose }`): followers, description,
 * share/invite link, mute, unfollow; admins edit info and settings (visibility, reactions);
 * the owner manages admins, transfers ownership and deletes the channel.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
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
} from 'lucide-react';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  chatTitle,
  isMuted,
  userDisplayName,
  type ChannelSettings,
  type ChatMember,
  type ChatSummary,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  IconButton,
  ListItemSkeleton,
  Menu,
  RadioGroup,
  SearchInput,
  Switch,
  confirm,
  toast,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
import type { InfoPanelProps } from '@/features/contacts/ContactInfoPanel';
import { MemberRow } from '@/features/groups/GroupMembers';
import { sortMembers, useChatMembers } from '@/features/groups/members';
import { matchesUser } from '@/features/groups/shared/candidates';
import { setMuted } from '@/features/groups/shared/chatActions';
import { EditTextModal, MuteModal } from '@/features/groups/shared/dialogs';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { InfoPage, InfoRow, InfoSection, QuickAction } from '@/features/groups/shared/InfoLayout';
import { InviteLinkView } from '@/features/groups/shared/InviteLinkView';
import { MediaGalleryView } from '@/features/groups/shared/MediaGallery';
import { RichText } from '@/features/groups/shared/RichText';
import { afterPaint, shareLink } from '@/features/groups/shared/share';
import { StarredView } from '@/features/groups/shared/StarredView';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { formatCount, formatShortDate } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { useChat } from '@/stores/chats';
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

type View = 'main' | 'settings' | 'invite' | 'admins' | 'media' | 'starred';

export function ChannelInfoPanel({ chatId, onClose }: InfoPanelProps) {
  const chat = useChat(chatId);
  const [view, setView] = useState<View>('main');
  if (!chat) return null;
  return (
    <div className="contents" data-testid="channel-info">
      <ChannelInfoView chat={chat} view={view} setView={setView} onClose={onClose} />
    </div>
  );
}

function ChannelInfoView({
  chat,
  view,
  setView,
  onClose,
}: {
  chat: ChatSummary;
  view: View;
  setView: (v: View) => void;
  onClose: () => void;
}) {
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

function ChannelInfoMain({
  chat,
  onClose,
  go,
}: {
  chat: ChatSummary;
  onClose: () => void;
  go: (v: View) => void;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const p = chat.permissions;
  const owner = chat.myRole === 'owner';
  const isPublic = chat.channelSettings?.isPublic ?? false;
  const muted = isMuted(chat.mutedUntil);
  const [edit, setEdit] = useState<'name' | 'description' | null>(null);
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
      void navigate('/updates', { replace: true });
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
      void navigate('/updates', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PaneHeader
        title="Channel info"
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
      />
      <InfoPage>
        <section className="flex flex-col items-center bg-surface px-6 pt-7 pb-5 text-center">
          <EditableAvatar
            src={chat.avatarUrl}
            name={title}
            colorSeed={chat.id}
            kind="channel"
            size={desktop ? 160 : 136}
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
          <div className="mt-4 flex max-w-full items-center gap-1">
            <h2 className="min-w-0 truncate text-[24px] leading-tight font-semibold text-fg">
              {title}
            </h2>
            {p.canEditInfo ? (
              <IconButton
                icon={Pencil}
                label="Edit channel name"
                size="sm"
                onClick={() => setEdit('name')}
              />
            ) : null}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[15px] text-muted">
            {isPublic ? <Globe size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
            {isPublic ? 'Public channel' : 'Private channel'} · {formatCount(chat.memberCount)}{' '}
            {chat.memberCount === 1 ? 'follower' : 'followers'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            {isPublic || p.canInvite ? (
              <QuickAction icon={Share2} label="Share" onClick={share} />
            ) : null}
            <QuickAction
              icon={Bell}
              label={muted ? 'Unmute' : 'Mute'}
              onClick={() =>
                muted
                  ? void setMuted(chat.id, null)
                      .then(() => toast.success('Channel unmuted'))
                      .catch((e: unknown) => toast.error(e))
                  : setMuteOpen(true)
              }
            />
            {p.canViewMembers ? (
              <QuickAction icon={Users} label="Followers" onClick={() => go('admins')} />
            ) : null}
          </div>
        </section>

        {chat.description || p.canEditInfo ? (
          <InfoSection>
            {chat.description ? (
              <div className="flex items-start gap-2 px-5 py-2">
                <div className="min-w-0 flex-1">
                  <RichText
                    text={chat.description}
                    className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg"
                  />
                  <p className="mt-2 text-[13px] text-muted">
                    Created {formatShortDate(chat.createdAt)}
                  </p>
                </div>
                {p.canEditInfo ? (
                  <IconButton
                    icon={Pencil}
                    label="Edit channel description"
                    size="sm"
                    onClick={() => setEdit('description')}
                  />
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEdit('description')}
                className="block w-full px-5 py-2 text-left hover:bg-hover"
              >
                <span className="text-[15px] font-medium text-brand-ink">
                  Add channel description
                </span>
                <span className="mt-1 block text-[13px] text-muted">
                  Created {formatShortDate(chat.createdAt)}
                </span>
              </button>
            )}
          </InfoSection>
        ) : null}

        <InfoSection>
          <InfoRow icon={ImageIcon} label="Media, links and docs" onClick={() => go('media')} />
          <InfoRow icon={Star} label="Starred messages" onClick={() => go('starred')} />
        </InfoSection>

        <InfoSection>
          <InfoRow
            icon={Bell}
            label="Mute notifications"
            description="Muted channels don't show new-post badges"
            trailing={
              <Switch
                aria-label="Mute notifications"
                checked={muted}
                onChange={(on) =>
                  on
                    ? setMuteOpen(true)
                    : void setMuted(chat.id, null).catch((e: unknown) => toast.error(e))
                }
              />
            }
          />
          {p.canEditInfo ? (
            <InfoRow
              icon={SlidersHorizontal}
              label="Channel settings"
              description="Visibility and reactions"
              onClick={() => go('settings')}
            />
          ) : null}
          {p.canInvite ? (
            <InfoRow icon={Link2} label="Invite link" onClick={() => go('invite')} />
          ) : null}
          {p.canViewMembers ? (
            <InfoRow
              icon={ShieldCheck}
              label={p.canManageAdmins ? 'Admins & followers' : 'Followers'}
              value={formatCount(chat.memberCount)}
              onClick={() => go('admins')}
            />
          ) : null}
        </InfoSection>

        <InfoSection>
          {p.canLeave ? (
            <InfoRow
              icon={LogOut}
              label="Unfollow channel"
              danger
              onClick={() => void unfollow()}
            />
          ) : null}
          {owner ? (
            <>
              <p className="px-5 py-2 text-[13px] text-muted">
                You own this channel. To stop following it, transfer ownership to an admin first.
              </p>
              <InfoRow icon={Trash2} label="Delete channel" danger onClick={() => void remove()} />
            </>
          ) : null}
        </InfoSection>
      </InfoPage>

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
    </div>
  );
}

function ChannelSettingsView({ chat, onBack }: { chat: ChatSummary; onBack: () => void }) {
  const [pending, setPending] = useState<Partial<ChannelSettings>>({});
  const value: ChannelSettings = {
    isPublic: true,
    reactions: 'all',
    ...chat.channelSettings,
    ...pending,
  };
  const change = async (patch: Partial<ChannelSettings>) => {
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
    <div className="flex min-h-full flex-col">
      <PaneHeader title="Channel settings" back={onBack} border />
      <InfoPage>
        <InfoSection title="Who can find this channel">
          <RadioGroup
            className="px-5"
            aria-label="Visibility"
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
            className="px-5"
            aria-label="Reactions"
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
        <p className="px-5 text-[13px] leading-relaxed text-muted">
          Followers never see each other, and reactions and poll votes stay anonymous.
        </p>
      </InfoPage>
    </div>
  );
}

function ChannelPeopleView({ chat, onBack }: { chat: ChatSummary; onBack: () => void }) {
  const { members, error, reload } = useChatMembers(chat.id, chat.permissions.canViewMembers);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ member: ChatMember; anchor: MenuAnchor } | null>(null);
  const meId = getMyId();
  const list = useMemo(
    () => sortMembers(members ?? [], meId).filter((m) => matchesUser(m.user, query)),
    [members, meId, query],
  );
  const admins = list.filter((m) => m.role !== 'member');
  const followers = list.filter((m) => m.role === 'member');
  const canManage = chat.permissions.canManageAdmins;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const items: MenuEntry[] = [];
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

  const row = (m: ChatMember) => (
    <li key={m.user.id}>
      <MemberRow
        member={m}
        meId={meId}
        kind="channel"
        onClick={
          canManage && m.role !== 'owner'
            ? (anchor) => afterPaint(() => setMenu({ member: m, anchor }))
            : undefined
        }
      />
    </li>
  );

  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader
        title={canManage ? 'Admins & followers' : 'Followers'}
        subtitle={`${formatCount(chat.memberCount)} ${chat.memberCount === 1 ? 'follower' : 'followers'}`}
        back={onBack}
        border
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search followers"
          aria-label="Search followers"
        />
      </PaneHeader>
      {members === null && !error ? (
        <ListItemSkeleton count={5} />
      ) : error ? (
        <EmptyState compact icon={Users} title="Couldn't load followers" description={error} />
      ) : (
        <>
          {admins.length ? (
            <section aria-label="Admins">
              <h3 className="px-5 pt-3 pb-1 text-[13px] font-semibold text-brand-ink">Admins</h3>
              <ul>{admins.map(row)}</ul>
            </section>
          ) : null}
          <section aria-label="Followers">
            <h3 className="px-5 pt-3 pb-1 text-[13px] font-semibold text-brand-ink">Followers</h3>
            {followers.length ? (
              <ul>{followers.map(row)}</ul>
            ) : (
              <p className="px-5 py-2 text-[14px] text-muted">
                {query
                  ? 'No matches.'
                  : 'No followers yet. Share the channel to grow your audience.'}
              </p>
            )}
          </section>
          {canManage ? (
            <p className="px-5 py-3 text-[13px] text-muted">
              Admins can post, edit channel info and settings, and delete posts. Tap a follower to
              make them an admin.
            </p>
          ) : null}
        </>
      )}
      <Menu
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={items}
        align="end"
        aria-label="Follower options"
      />
    </div>
  );
}
