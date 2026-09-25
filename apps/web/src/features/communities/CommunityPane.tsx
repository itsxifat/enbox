/**
 * Community home (/communities/:communityId): header, announcements, groups I'm in, groups I
 * can join, admin tools (edit, members, invite link, add/create/unlink groups, deactivate)
 * and leave. Admin pages open in a side <Sheet>.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
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
} from 'lucide-react';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  type Community,
  type CommunityGroup,
} from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  PageSpinner,
  Sheet,
  confirm,
  toast,
  type MenuEntry,
} from '@/components/ui';
import { EditInfoModal, EditTextModal } from '@/features/groups/shared/dialogs';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { InfoPage, InfoRow, InfoSection, QuickAction } from '@/features/groups/shared/InfoLayout';
import { InviteLinkView } from '@/features/groups/shared/InviteLinkView';
import { RichText } from '@/features/groups/shared/RichText';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { ApiError, errorMessage } from '@/lib/api';
import { formatShortDate } from '@/lib/format';
import { useChats } from '@/stores/chats';
import { isCommunityAdmin, useCommunities, useCommunity } from '@/stores/communities';
import { useUserName } from '@/stores/users';
import { AddGroupsView } from './AddGroupsView';
import { CommunityChatRow } from './CommunityChatRow';
import { CommunityMembersView } from './CommunityMembersView';

type SheetView = 'members' | 'invite' | 'groups' | null;

export function CommunityPane() {
  const { communityId } = useParams<{ communityId: string }>();
  const community = useCommunity(communityId);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!communityId) return;
    let alive = true;
    setChecking(true);
    setFailed(null);
    useCommunities
      .getState()
      .refreshCommunity(communityId)
      .catch((e: unknown) => {
        if (alive && !(e instanceof ApiError && (e.status === 404 || e.status === 403)))
          setFailed(errorMessage(e));
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [communityId]);

  if (!community) {
    if (failed)
      return (
        <div className="flex flex-1 flex-col bg-app">
          <PaneHeader title="Community" back="/communities" border />
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={UsersRound}
              title="Couldn't load the community"
              description={failed}
            />
          </div>
        </div>
      );
    // Not (or no longer) a member: 404 from the refresh, or removed/deactivated live.
    if (!checking)
      return (
        <div className="flex flex-1 flex-col bg-app">
          <PaneHeader title="Community" back="/communities" border />
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={UsersRound}
              title="Community not available"
              description="It may have been deactivated, or you're no longer a member."
            />
          </div>
        </div>
      );
    return <PageSpinner />;
  }
  return <CommunityHome key={community.id} community={community} />;
}

function CommunityHome({ community: c }: { community: Community }) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const admin = isCommunityAdmin(c);
  const owner = c.myRole === 'owner';
  const [sheet, setSheet] = useState<SheetView>(null);
  const [edit, setEdit] = useState<'name' | 'description' | 'all' | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const chatsLoaded = useChats((s) => s.loaded);

  const groups = useMemo(() => c.groups.filter((g) => !g.isAnnouncement), [c.groups]);
  const mine = groups.filter((g) => g.isMember);
  const others = groups.filter((g) => !g.isMember);
  const store = useCommunities.getState;

  // Make sure the chats we link to are in the list (e.g. right after a join from another device).
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

  const join = async (g: CommunityGroup) => {
    setJoining(g.chatId);
    try {
      const chat = await store().joinGroup(c.id, g.chatId);
      toast.success(`You joined “${g.name}”`, {
        action: { label: 'Open', onClick: () => void navigate(`/chats/${chat.id}`) },
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setJoining(null);
    }
  };

  const unlink = async (g: CommunityGroup) => {
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
      void navigate('/communities', { replace: true });
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
      void navigate('/communities', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };

  const menu: MenuEntry[] = [
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
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <PaneHeader
        title={c.name}
        subtitle={`Community · ${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
        back={desktop ? undefined : '/communities'}
        leading={
          <Avatar
            src={c.avatarUrl}
            name={c.name}
            colorSeed={c.id}
            kind="community"
            size="md"
            className="mx-1"
          />
        }
        border
        actions={
          <DropdownMenu
            aria-label="Community options"
            items={menu}
            trigger={(t) => <IconButton {...t} icon={EllipsisVertical} label="Community options" />}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-3xl">
          <InfoPage className="lg:gap-3 lg:py-4">
            <section className="flex flex-col items-center bg-surface px-6 pt-8 pb-6 text-center lg:rounded-2xl">
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
              <div className="mt-4 flex max-w-full items-center gap-1">
                <h2 className="min-w-0 truncate text-[24px] leading-tight font-semibold text-fg">
                  {c.name}
                </h2>
                {admin ? (
                  <IconButton
                    icon={Pencil}
                    label="Edit community name"
                    size="sm"
                    onClick={() => setEdit('name')}
                  />
                ) : null}
              </div>
              <p className="mt-1 text-[15px] text-muted">
                Community · {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'} ·{' '}
                {groups.length} {groups.length === 1 ? 'group' : 'groups'}
              </p>
              {c.description ? (
                <div className="mt-3 max-w-xl text-[15px] leading-relaxed text-fg">
                  <RichText text={c.description} />
                </div>
              ) : admin ? (
                <button
                  type="button"
                  onClick={() => setEdit('description')}
                  className="mt-3 text-[15px] font-medium text-brand-ink hover:underline"
                >
                  Add community description
                </button>
              ) : null}
              <p className="mt-2 text-[13px] text-subtle">
                <CreatedBy userId={c.createdBy} /> · {formatShortDate(c.createdAt)}
              </p>
              {admin ? (
                <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                  <QuickAction icon={UserPlus} label="Invite" onClick={() => setSheet('invite')} />
                  <QuickAction icon={Plus} label="Add groups" onClick={() => setSheet('groups')} />
                  <QuickAction
                    icon={UsersRound}
                    label="Members"
                    onClick={() => setSheet('members')}
                  />
                </div>
              ) : null}
            </section>

            <InfoSection className="lg:rounded-2xl" aria-label="Announcements">
              <CommunityChatRow
                chatId={c.announcementChatId}
                name={c.name}
                avatarUrl={c.avatarUrl}
                announcement
                fallback={
                  admin
                    ? 'Send an announcement to all members'
                    : 'Only admins can send announcements'
                }
              />
            </InfoSection>

            <InfoSection
              className="lg:rounded-2xl"
              title="Groups you're in"
              aria-label="Groups you're in"
            >
              {mine.length ? (
                <ul>
                  {mine.map((g) => (
                    <li key={g.chatId} className="group/row relative">
                      <CommunityChatRow
                        chatId={g.chatId}
                        name={g.name}
                        avatarUrl={g.avatarUrl}
                        fallback={`${g.memberCount} members`}
                      />
                      {admin ? <UnlinkButton onClick={() => void unlink(g)} name={g.name} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-2 text-[14px] text-muted">
                  You haven't joined any groups in this community yet.
                </p>
              )}
            </InfoSection>

            {others.length ? (
              <InfoSection
                className="lg:rounded-2xl"
                title="Groups you can join"
                aria-label="Groups you can join"
              >
                <ul>
                  {others.map((g) => (
                    <li key={g.chatId} className="group/row relative">
                      <CommunityChatRow
                        chatId={g.chatId}
                        name={g.name}
                        avatarUrl={g.avatarUrl}
                        fallback={
                          <>
                            {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                            {g.description ? ` · ${g.description}` : ''}
                          </>
                        }
                        end={
                          <span className="flex items-center gap-1">
                            {admin ? (
                              <IconButton
                                icon={Unlink}
                                label={`Remove ${g.name} from community`}
                                size="sm"
                                onClick={() => void unlink(g)}
                              />
                            ) : null}
                            <Button
                              size="sm"
                              variant="soft"
                              loading={joining === g.chatId}
                              onClick={() => void join(g)}
                              aria-label={`Join ${g.name}`}
                            >
                              Join
                            </Button>
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </InfoSection>
            ) : null}

            {admin ? (
              <InfoSection className="lg:rounded-2xl">
                <InfoRow
                  icon={Plus}
                  label="Add groups"
                  description="Create a new group or add groups you manage"
                  onClick={() => setSheet('groups')}
                />
                <InfoRow
                  icon={UsersRound}
                  label="Members"
                  value={String(c.memberCount)}
                  onClick={() => setSheet('members')}
                />
                <InfoRow icon={Link2} label="Invite link" onClick={() => setSheet('invite')} />
              </InfoSection>
            ) : null}

            <InfoSection className="lg:rounded-2xl">
              <InfoRow icon={LogOut} label="Exit community" danger onClick={() => void leave()} />
              {owner ? (
                <InfoRow
                  icon={Power}
                  label="Deactivate community"
                  danger
                  onClick={() => void deactivate()}
                />
              ) : null}
            </InfoSection>
          </InfoPage>
        </div>
      </div>

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} aria-label="Community">
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
            backIcon={desktop ? 'close' : 'arrow'}
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
    </div>
  );
}

function UnlinkButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    // Touch screens have no hover: keep it visible there (it's a real tap target).
    <span className="absolute top-1/2 right-3 -translate-y-1/2 transition-opacity group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100">
      <IconButton
        icon={Unlink}
        label={`Remove ${name} from community`}
        size="sm"
        variant="solid"
        onClick={onClick}
      />
    </span>
  );
}

function CreatedBy({ userId }: { userId: string | null }) {
  const name = useUserName(userId);
  return <>{userId ? `Created by ${name}` : 'Created'}</>;
}
