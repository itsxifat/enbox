/**
 * Group info (shown by the conversation in a <Sheet>; contract `{ chatId, onClose }`).
 * WhatsApp-style drill-in pages: main → members / add members / invite link / settings /
 * media / starred. Everything is gated by `chat.permissions`; the member list refreshes on
 * `chat:members-changed`, the rest follows the chats store (`chat:updated` / `chat:upsert`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Bell,
  ChevronRight,
  Clock3,
  Eraser,
  Image as ImageIcon,
  Link2,
  LogOut,
  Megaphone,
  Pencil,
  Phone,
  Search,
  Settings2,
  Star,
  Trash2,
  UserPlus,
  UsersRound,
  Video,
} from 'lucide-react';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  chatTitle,
  isMuted,
  type ChatMember,
  type ChatSummary,
  type GroupSettings,
  type UserPublic,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, IconButton, Switch, confirm, toast } from '@/components/ui';
import type { InfoPanelProps } from '@/features/contacts/ContactInfoPanel';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { formatShortDate } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { useUserName } from '@/stores/users';
import { GroupPermissionsFields } from './GroupPermissions';
import { MemberRow, MembersView, useGroupMemberMenu } from './GroupMembers';
import { sortMembers, useChatMembers } from './members';
import { AddResultModal, hasProblems, type AddOutcome } from './shared/AddResultModal';
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
import { MediaGalleryView, MediaPreviewStrip } from './shared/MediaGallery';
import { mediaTotal, useChatMediaCounts, useStarredCount } from './shared/mediaCounts';
import { RichText } from './shared/RichText';
import { StarredView } from './shared/StarredView';
import { UserPicker } from './shared/UserPicker';

type View = 'main' | 'members' | 'add' | 'invite' | 'settings' | 'media' | 'starred';

const PREVIEW_MEMBERS = 10;

export function GroupInfoPanel({ chatId, onClose }: InfoPanelProps) {
  const chat = useChat(chatId);
  const [view, setView] = useState<View>('main');
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
  return (
    <div className="contents" data-testid="group-info">
      <GroupInfoView
        chat={chat}
        view={view}
        setView={setView}
        members={members}
        onClose={onClose}
      />
    </div>
  );
}

function GroupInfoView({
  chat,
  view,
  setView,
  members,
  onClose,
}: {
  chat: ChatSummary;
  view: View;
  setView: (v: View) => void;
  members: ReturnType<typeof useChatMembers>;
  onClose: () => void;
}) {
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

/** Owner or admin of the group (group settings and invite reset are admin-only server-side). */
function isAdmin(chat: ChatSummary): boolean {
  return chat.membership === 'active' && (chat.myRole === 'owner' || chat.myRole === 'admin');
}

function GroupInfoMain({
  chat,
  onClose,
  go,
  members,
  membersError,
  reloadMembers,
}: {
  chat: ChatSummary;
  onClose: () => void;
  go: (v: View) => void;
  members: ChatMember[] | null;
  membersError: string | null;
  reloadMembers: () => void;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const meId = getMyId();
  const p = chat.permissions;
  const active = chat.membership === 'active';
  const announcement = chat.isAnnouncement;
  const community = useCommunities((s) =>
    chat.communityId ? s.byId[chat.communityId] : undefined,
  );
  const communitiesLoaded = useCommunities((s) => s.loaded);
  // `createdBy` is viewer-neutral (announcements: the community's creator); a deleted
  // creator keeps their id and renders as a deleted account.
  const creator = chat.createdBy;
  const creatorName = useUserName(creator);
  const mediaCounts = useChatMediaCounts(chat.id);
  const starredCount = useStarredCount(chat.id);
  const muted = isMuted(chat.mutedUntil);
  const [edit, setEdit] = useState<'name' | 'description' | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
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
      void navigate('/chats', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };

  const createdLine = [
    creator ? `Created by ${creatorName}` : 'Created',
    formatShortDate(chat.createdAt),
  ].join(', ');

  return (
    <div className="flex min-h-full flex-col">
      <PaneHeader
        title={announcement ? 'Announcements info' : 'Group info'}
        back={onClose}
        backIcon={desktop ? 'close' : 'arrow'}
        border
      />
      <InfoPage>
        {/* Hero */}
        <section className="flex flex-col items-center bg-surface px-6 pt-7 pb-5 text-center">
          <EditableAvatar
            src={chat.avatarUrl}
            name={title}
            colorSeed={chat.id}
            kind={announcement ? 'community' : 'group'}
            size={desktop ? 160 : 136}
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
          <div className="mt-4 flex max-w-full items-center gap-1">
            <h2 className="min-w-0 truncate text-[24px] leading-tight font-semibold text-fg">
              {title}
            </h2>
            {active && p.canEditInfo ? (
              <IconButton
                icon={Pencil}
                label="Edit group name"
                size="sm"
                onClick={() => setEdit('name')}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[15px] text-muted">
            {noun} · {chat.memberCount} {chat.memberCount === 1 ? 'member' : 'members'}
          </p>
          {active && (p.canCall || p.canAddMembers) ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              {p.canCall ? (
                <>
                  <QuickAction
                    icon={Phone}
                    label="Audio"
                    onClick={() => void useCalls.getState().startCall(chat.id, 'audio')}
                  />
                  <QuickAction
                    icon={Video}
                    label="Video"
                    onClick={() => void useCalls.getState().startCall(chat.id, 'video')}
                  />
                </>
              ) : null}
              {p.canAddMembers ? (
                <QuickAction icon={UserPlus} label="Add" onClick={() => go('add')} />
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Description */}
        {chat.description || (active && p.canEditInfo) ? (
          <InfoSection className="px-0">
            {chat.description ? (
              <div className="flex items-start gap-2 px-5 py-2">
                <div className="min-w-0 flex-1">
                  <RichText
                    text={chat.description}
                    className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg"
                  />
                  <p className="mt-2 text-[13px] text-muted">{createdLine}</p>
                </div>
                {active && p.canEditInfo ? (
                  <IconButton
                    icon={Pencil}
                    label="Edit group description"
                    size="sm"
                    onClick={() => setEdit('description')}
                  />
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEdit('description')}
                className="block w-full px-5 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span className="text-[15px] font-medium text-brand-ink">
                  Add group description
                </span>
                <span className="mt-1 block text-[13px] text-muted">{createdLine}</span>
              </button>
            )}
          </InfoSection>
        ) : (
          <InfoSection>
            <p className="px-5 py-1 text-[13px] text-muted">{createdLine}</p>
          </InfoSection>
        )}

        {/* Community */}
        {chat.communityId ? (
          <InfoSection>
            <InfoRow
              icon={announcement ? Megaphone : UsersRound}
              label={
                community ? (
                  <>
                    {announcement ? 'Announcements of ' : 'Part of '}
                    <span className="font-semibold">{community.name}</span>
                  </>
                ) : (
                  'Part of a community'
                )
              }
              description={
                announcement
                  ? 'Only community admins can send messages here.'
                  : 'Community members can find and join this group.'
              }
              to={`/communities/${chat.communityId}`}
            />
          </InfoSection>
        ) : null}

        {/* Media & starred */}
        <InfoSection>
          <InfoRow
            icon={ImageIcon}
            label="Media, links and docs"
            value={mediaCounts ? String(mediaTotal(mediaCounts)) : undefined}
            onClick={() => go('media')}
          />
          <MediaPreviewStrip chatId={chat.id} onOpen={() => go('media')} />
          <InfoRow
            icon={Star}
            label="Starred messages"
            value={starredCount ? String(starredCount) : undefined}
            onClick={() => go('starred')}
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
                    : `Muted until ${formatShortDate(chat.mutedUntil!)}`
                  : undefined
              }
              trailing={
                <Switch
                  aria-label="Mute notifications"
                  checked={muted}
                  onChange={(on) => {
                    if (on) setMuteOpen(true);
                    else
                      void setMuted(chat.id, null)
                        .then(() => toast.success('Notifications unmuted'))
                        .catch((e: unknown) => toast.error(e));
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
              onClick={p.canEditInfo ? () => setTimerOpen(true) : undefined}
            />
            {isAdmin(chat) && !announcement ? (
              <InfoRow icon={Settings2} label="Group settings" onClick={() => go('settings')} />
            ) : null}
          </InfoSection>
        ) : (
          <InfoSection>
            <p className="px-5 py-2 text-[14px] leading-relaxed text-muted" role="status">
              {chat.membership === 'removed'
                ? 'You were removed from this group. You can still read the messages sent while you were a member.'
                : "You're no longer a member of this group. You can still read the messages sent while you were a member."}
            </p>
          </InfoSection>
        )}

        {/* Members */}
        {active && p.canViewMembers ? (
          <InfoSection
            aria-label="Members"
            title={`${chat.memberCount} ${chat.memberCount === 1 ? 'member' : 'members'}`}
            action={
              <IconButton
                icon={Search}
                label="Search members"
                size="sm"
                onClick={() => go('members')}
              />
            }
          >
            {p.canAddMembers ? (
              <ActionRow icon={UserPlus} label="Add members" onClick={() => go('add')} />
            ) : null}
            {p.canInvite ? (
              <ActionRow icon={Link2} label="Invite via link" onClick={() => go('invite')} />
            ) : null}
            {members === null && !membersError ? (
              <div className="flex flex-col gap-3 px-5 py-3" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="size-10 animate-pulse rounded-full bg-surface-2" />
                    <span className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" />
                  </div>
                ))}
              </div>
            ) : membersError ? (
              <p className="px-5 py-3 text-[14px] text-danger">{membersError}</p>
            ) : (
              <ul>
                {sorted.slice(0, PREVIEW_MEMBERS).map((m) => (
                  <li key={m.user.id}>
                    <MemberRow member={m} meId={meId} onClick={(a) => menu.open(m, a)} />
                  </li>
                ))}
              </ul>
            )}
            {sorted.length > PREVIEW_MEMBERS ? (
              <button
                type="button"
                onClick={() => go('members')}
                className="flex w-full items-center justify-between px-5 py-3 text-[15px] font-medium text-brand-ink hover:bg-hover"
              >
                View all ({sorted.length - PREVIEW_MEMBERS} more)
                <ChevronRight size={18} aria-hidden />
              </button>
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
              to={`/communities/${chat.communityId}`}
            />
          ) : null}
          {active && p.canLeave ? (
            <InfoRow icon={LogOut} label="Exit group" danger onClick={() => void exit()} />
          ) : null}
          <InfoRow icon={Eraser} label="Clear chat" danger onClick={() => void clear()} />
          {!active ? (
            <InfoRow icon={Trash2} label="Delete group" danger onClick={() => void remove()} />
          ) : null}
        </InfoSection>
      </InfoPage>

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
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof UserPlus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-5 py-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-brand text-on-brand">
        <Icon size={20} aria-hidden />
      </span>
      <span className="text-[15.5px] font-medium text-fg">{label}</span>
    </button>
  );
}

function GroupSettingsView({ chat, onBack }: { chat: ChatSummary; onBack: () => void }) {
  const [pending, setPending] = useState<Partial<GroupSettings>>({});
  const value: GroupSettings = { ...chat.groupSettings!, ...pending };
  const change = async (key: keyof GroupSettings, next: boolean) => {
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
    <div className="flex min-h-full flex-col">
      <PaneHeader title="Group settings" back={onBack} border />
      <InfoPage>
        <InfoSection className="px-5">
          <GroupPermissionsFields value={value} onChange={(k, v) => void change(k, v)} />
        </InfoSection>
        <p className="px-5 text-[13px] leading-relaxed text-muted">
          Admins can always send messages, edit group info and add members. Every change is
          announced in the chat.
        </p>
      </InfoPage>
    </div>
  );
}

function AddMembersView({
  chat,
  members,
  onBack,
  onDone,
  onInvite,
}: {
  chat: ChatSummary;
  members: ChatMember[] | null;
  onBack: () => void;
  onDone: () => void;
  onInvite: () => void;
}) {
  const [selected, setSelected] = useState<UserPublic[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AddOutcome | null>(null);
  const disabled = useMemo(
    () => new Map((members ?? []).map((m) => [m.user.id, 'Already added to the group'] as const)),
    [members],
  );

  const toggle = (u: UserPublic) =>
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
    <div className="relative flex h-full min-h-full flex-col bg-surface">
      <PaneHeader
        title="Add members"
        subtitle={selected.length ? `${selected.length} selected` : chatTitle(chat)}
        back={onBack}
        border
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
            <ActionRow icon={Link2} label="Invite via link" onClick={onInvite} />
          ) : null
        }
      />
      {selected.length ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <Button fullWidth size="lg" loading={busy} onClick={() => void add()} leftIcon={UserPlus}>
            Add{' '}
            {selected.length === 1
              ? selected[0]!.displayName.split(' ')[0]
              : `${selected.length} people`}
          </Button>
        </div>
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
    </div>
  );
}
