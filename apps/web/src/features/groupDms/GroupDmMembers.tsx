/**
 * A group DM's member list (Discord's right-hand list), in a side sheet: the group icon (any
 * member changes it), then every member with their presence and a crown on the owner. A row
 * opens the profile; right-click or its ⋯ button opens the member menu: Profile, Message, and
 * for the owner Remove from Group / Make Group Owner; on my own row, Leave Group (also at the
 * bottom for everyone).
 */
import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  Crown,
  IdCard,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  UserMinus,
  UserRound,
} from 'lucide-react';
import { userDisplayName, type ChatMember, type ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  Button,
  IconButton,
  Menu,
  Sheet,
  Spinner,
  confirm,
  contextMenuAnchor,
  toast,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { useChatMembers } from '@/features/conversation/members';
import { copyId, useDeveloperMode } from '@/features/conversation/moreActions';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { openProfile } from '@/features/profile/open';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUsers } from '@/stores/users';
import { leaveGroupDm, makeGroupDmOwner, removeFromGroupDm } from './actions';
import { useChatTitle } from './title';

async function setIcon(chat: ChatSummary, avatarMediaId: string | null): Promise<void> {
  try {
    const updated = await api.patch<ChatSummary>(`/api/groups/${chat.id}`, { avatarMediaId });
    useChats.getState().upsertChat(updated);
  } catch (e) {
    toast.error(e);
  }
}

export function GroupDmMemberList({ chat, onLeft }: { chat: ChatSummary; onLeft?: () => void }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  const members = useChatMembers(chat);
  const byId = useUsers((s) => s.byId);
  const devMode = useDeveloperMode();
  const title = useChatTitle(chat);
  const [menu, setMenu] = useState<{ member: ChatMember; anchor: MenuAnchor } | null>(null);
  const active = chat.membership === 'active';
  const owner = active && chat.myRole === 'owner';

  const leave = async () => {
    if (!(await leaveGroupDm(chat, title))) return;
    onLeft?.();
    void navigate('/chats', { replace: true });
  };

  const message = async (userId: string) => {
    try {
      const dm = await ensureDirectChat(userId);
      onLeft?.();
      void navigate(`/chats/${dm.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  const transfer = async (m: ChatMember) => {
    const name = userDisplayName(byId[m.user.id] ?? m.user);
    const ok = await confirm({
      title: 'Transfer Group Ownership',
      message: `${name} will become the owner of this group. You can’t undo this unless they give it back.`,
      confirmLabel: 'Transfer',
    });
    if (ok) await makeGroupDmOwner(chat.id, m.user.id);
  };

  const itemsFor = (m: ChatMember, anchor: MenuAnchor): MenuEntry[] => {
    const self = m.user.id === me;
    const theirs = owner && !self;
    return [
      { label: 'Profile', icon: UserRound, onSelect: () => openProfile(m.user.id, anchor) },
      !self && { label: 'Message', icon: MessageCircle, onSelect: () => void message(m.user.id) },
      theirs && 'separator',
      theirs && {
        label: 'Remove from Group',
        icon: UserMinus,
        danger: true,
        onSelect: () => void removeFromGroupDm(chat.id, m.user.id),
      },
      theirs && { label: 'Make Group Owner', icon: Crown, onSelect: () => void transfer(m) },
      self && active && 'separator',
      self &&
        active && {
          label: 'Leave Group',
          icon: LogOut,
          danger: true,
          onSelect: () => void leave(),
        },
      devMode && 'separator',
      devMode && {
        label: 'Copy User ID',
        icon: IdCard,
        onSelect: () => void copyId(m.user.id, 'User ID'),
      },
    ];
  };

  const openMenu = (m: ChatMember, anchor: MenuAnchor) => setMenu({ member: m, anchor });

  return (
    <div className="flex min-h-full flex-col px-2 pb-3" data-testid="group-dm-members">
      <section className="flex flex-col items-center gap-2 px-4 pt-2 pb-4 text-center">
        <EditableAvatar
          src={chat.avatarUrl}
          name={title}
          colorSeed={chat.id}
          kind="group"
          size={80}
          editable={active && chat.permissions.canEditInfo}
          label="Change group icon"
          onUploaded={(m) => setIcon(chat, m.id)}
          onRemove={chat.avatarUrl ? () => setIcon(chat, null) : undefined}
        />
        <h3 className="max-w-full truncate text-[16px] font-semibold text-fg">{title}</h3>
      </section>
      {!members ? (
        active ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-[14px] text-muted">You’re no longer a member.</p>
        )
      ) : (
        <ul aria-label="Members" className="flex flex-col gap-0.5">
          {members.map((m) => {
            const user = byId[m.user.id] ?? m.user;
            const name = userDisplayName(user);
            const onContextMenu = (e: MouseEvent<HTMLElement>) => {
              e.preventDefault();
              openMenu(m, contextMenuAnchor(e));
            };
            return (
              <li
                key={m.user.id}
                className="group/member relative flex items-center rounded-md hover:bg-hover"
                data-testid="group-dm-member"
                data-animate-avatars
              >
                <button
                  type="button"
                  onClick={(e) => openProfile(m.user.id, e.currentTarget)}
                  onContextMenu={onContextMenu}
                  className="flex h-[42px] min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <UserAvatar user={user} size={32} showPresence />
                  <span className="truncate text-[15px] font-medium text-fg">{name}</span>
                  {m.role === 'owner' ? (
                    <Crown
                      size={14}
                      className="shrink-0 text-warning"
                      aria-label="Group Owner"
                      role="img"
                    />
                  ) : null}
                </button>
                <span className="mr-1 opacity-0 group-hover/member:opacity-100 focus-within:opacity-100">
                  <IconButton
                    icon={MoreHorizontal}
                    label={`More for ${name}`}
                    size="xs"
                    variant="ghost"
                    onClick={(e) => openMenu(m, e.currentTarget)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {active ? (
        <div className="mt-auto px-2 pt-4">
          <Button variant="danger" fullWidth leftIcon={LogOut} onClick={() => void leave()}>
            Leave Group
          </Button>
        </div>
      ) : null}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        aria-label={menu ? `${userDisplayName(menu.member.user)} menu` : 'Member menu'}
        items={menu ? itemsFor(menu.member, menu.anchor) : []}
      />
    </div>
  );
}

/** The member list beside a group DM (a side sheet; full screen on phones). */
export function GroupDmMembersSheet({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const members = useChatMembers(chat);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Members — ${members?.length ?? chat.memberCount}`}
      width={340}
      aria-label="Members"
    >
      <GroupDmMemberList chat={chat} onLeft={onClose} />
    </Sheet>
  );
}
