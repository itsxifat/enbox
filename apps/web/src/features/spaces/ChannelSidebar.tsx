import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CopyPlus,
  Hash,
  IdCard,
  Link2,
  Pencil,
  PlusCircle,
  Settings,
  Trash2,
  UserPlus,
  Volume2,
} from 'lucide-react';
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type ID,
  type SpaceCategory,
} from '@enbox/shared';
import {
  Badge,
  DropdownMenu,
  Menu,
  confirm,
  contextMenuAnchor,
  toast,
  type MenuAnchor,
  type MenuEntry,
} from '@/components/ui';
import { UserPanel } from '@/components/layout/UserPanel';
import { cn } from '@/lib/cn';
import { copyText } from '@/features/groups/shared/share';
import { patchPrefs } from '@/features/chats/chatActions';
import { joinVoiceChannel } from '@/features/voice/actions';
import { VoiceChannelOccupants } from '@/features/voice/VoiceChannelOccupants';
import { markChatRead } from '@/realtime';
import { useSpace, useSpaceChannels } from '@/stores/spaces';
import { deleteCategory, deleteChannel, moveChannels, setChannelsMuted, spaceMemory } from './actions';
import { CategoryDialog } from './dialogs/CategoryDialog';
import { ChannelDialog } from './dialogs/ChannelDialog';
import { CloneChannelDialog } from './dialogs/CloneChannelDialog';
import { InviteDialog } from './dialogs/InviteDialog';
import { copyId, muteEntry, notifyLevelEntries, spaceNotifyLevel, tidy, useSpaceMenu } from './menus';
import {
  groupsOf,
  isCategoryMuted,
  isChannelMuted,
  isChannelUnread,
  visibleGroups,
} from './sidebar';

export { isChannelUnread };

function ChannelRow({
  chat,
  active,
  onMenu,
  onInvite,
  onEdit,
}: {
  chat: ChatSummary;
  active: boolean;
  onMenu: (chat: ChatSummary, anchor: MenuAnchor) => void;
  onInvite: (chat: ChatSummary) => void;
  onEdit: (chat: ChatSummary) => void;
}) {
  const unread = isChannelUnread(chat);
  const muted = isChannelMuted(chat);
  const voice = chat.type === 'space_voice';
  const Icon = voice ? Volume2 : Hash;
  const canManage = hasPerm(chat.spacePermissions, PERM.MANAGE_CHANNELS);
  const canInvite = hasPerm(chat.spacePermissions, PERM.CREATE_INVITE);
  return (
    <div className="group/ch relative px-2">
      {/* Unread pill on the sidebar edge (Discord). */}
      {unread && !active ? (
        <span aria-hidden className="absolute top-1/2 left-0 h-2 w-1 -translate-y-1/2 rounded-r-full bg-fg" />
      ) : null}
      <Link
        to={`/spaces/${chat.space!.spaceId}/${chat.id}`}
        aria-current={active ? 'page' : undefined}
        // Discord: clicking a voice channel connects at once (and shows it).
        onClick={voice ? () => joinVoiceChannel(chat) : undefined}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          onMenu(chat, contextMenuAnchor(e));
        }}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-lg px-2 text-[15px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
          active
            ? 'bg-selected font-semibold text-fg'
            : unread
              ? 'font-semibold text-fg hover:bg-hover'
              : muted
                ? 'text-subtle hover:bg-hover hover:text-muted'
                : 'text-muted hover:bg-hover hover:text-fg',
        )}
        data-testid="space-channel-row"
        data-channel-name={chat.name}
      >
        <Icon size={18} className="shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{chat.name}</span>
        {chat.unreadMentionCount > 0 ? (
          <Badge count={chat.unreadMentionCount} size="sm" tone="danger" />
        ) : null}
        {canInvite ? (
          <button
            type="button"
            aria-label={`Create invite to ${chat.name}`}
            title="Create Invite"
            className={cn('rounded p-0.5 text-muted hover:text-fg', active ? 'block' : 'hidden group-focus-within/ch:block group-hover/ch:block')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInvite(chat);
            }}
          >
            <UserPlus size={15} aria-hidden />
          </button>
        ) : null}
        {canManage ? (
          <button
            type="button"
            aria-label={`Edit channel ${chat.name}`}
            title="Edit Channel"
            className={cn('rounded p-0.5 text-muted hover:text-fg', active ? 'block' : 'hidden group-focus-within/ch:block group-hover/ch:block')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(chat);
            }}
          >
            <Settings size={15} aria-hidden />
          </button>
        ) : null}
      </Link>
      {voice ? <VoiceChannelOccupants chat={chat} /> : null}
    </div>
  );
}

type SidebarDialog =
  | { kind: 'channel'; chat?: ChatSummary; categoryId?: ID | null }
  | { kind: 'clone'; chat: ChatSummary }
  | { kind: 'category'; category: SpaceCategory }
  | { kind: 'invite'; channelId?: ID };

type ContextMenu =
  | { kind: 'channel'; chatId: ID; anchor: MenuAnchor }
  | { kind: 'category'; categoryId: ID; anchor: MenuAnchor };

/** Channel list of one Space (Discord's left column), with the Space menu in its header. */
export function ChannelSidebar({ spaceId }: { spaceId: ID }) {
  const space = useSpace(spaceId);
  const channels = useSpaceChannels(spaceId);
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId?: string }>();
  const [collapsed, setCollapsed] = useState(spaceMemory.collapsed);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const spaceMenu = useSpaceMenu(space);
  const groups = useMemo(() => (space ? groupsOf(space, channels) : []), [space, channels]);
  const hideMuted = !!space?.me.hideMutedChannels;
  const shown = useMemo(
    () => visibleGroups(groups, { collapsed, hideMuted, activeId: chatId }),
    [groups, collapsed, hideMuted, chatId],
  );

  if (!space) {
    return (
      <aside aria-label="Channels" className="lg:card-pane flex w-[260px] min-w-0 flex-1 flex-col bg-surface lg:flex-none" />
    );
  }

  const manageChannels = hasPerm(space.myPermissions, PERM.MANAGE_CHANNELS);
  const closeDialog = () => setDialog(null);

  const toggle = (id: ID) => {
    const next = !collapsed[id];
    spaceMemory.setCollapsed(id, next);
    setCollapsed((c) => {
      const out = { ...c };
      if (next) out[id] = true;
      else delete out[id];
      return out;
    });
  };
  const collapseAll = () => setCollapsed(spaceMemory.setCollapsedMany(space.categories.map((c) => c.id), true));

  const mute = (list: ChatSummary[], until: string | null) => void setChannelsMuted(list, until);

  /** Swap with the neighbour of the same type in its category (text always sorts before voice). */
  const move = (c: ChatSummary, dir: -1 | 1) => {
    const catId = c.space?.categoryId ?? null;
    const row = channels
      .filter((x) => x.type === c.type && (x.space?.categoryId ?? null) === catId)
      .sort((a, b) => (a.space?.position ?? 0) - (b.space?.position ?? 0));
    const i = row.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= row.length) return;
    [row[i], row[j]] = [row[j]!, row[i]!];
    void moveChannels(
      spaceId,
      row.map((x, position) => ({ id: x.id, categoryId: catId, position })),
    ).catch((e: unknown) => toast.error(e));
  };

  const removeChannel = (c: ChatSummary) =>
    void confirm({
      title: `Delete ${c.type === 'space_voice' ? '' : '#'}${c.name}?`,
      message: 'Its messages are deleted for everyone. This cannot be undone.',
      confirmLabel: 'Delete Channel',
      danger: true,
    }).then(async (ok) => {
      if (!ok) return;
      try {
        await deleteChannel(spaceId, c.id);
        if (chatId === c.id) navigate(`/spaces/${spaceId}`, { replace: true });
      } catch (e) {
        toast.error(e);
      }
    });

  const channelItems = (c: ChatSummary): MenuEntry[] => {
    const canManage = hasPerm(c.spacePermissions, PERM.MANAGE_CHANNELS);
    const muted = isChannelMuted(c);
    const unread = c.lastSeq > c.lastReadSeq || c.unreadMentionCount > 0;
    return tidy([
      {
        label: 'Mark As Read',
        icon: CheckCheck,
        disabled: !unread,
        onSelect: () => markChatRead(c.id, { force: true }),
      },
      'separator',
      hasPerm(c.spacePermissions, PERM.CREATE_INVITE) && {
        label: 'Invite People',
        icon: UserPlus,
        onSelect: () => setDialog({ kind: 'invite', channelId: c.id }),
      },
      {
        label: 'Copy Link',
        icon: Link2,
        onSelect: () =>
          void copyText(`${location.origin}/spaces/${spaceId}/${c.id}`).then((ok) => ok && toast.success('Link copied')),
      },
      'separator',
      muteEntry('Channel', c.mutedUntil, muted, (until) => mute([c], until)),
      {
        label: 'Notification Settings',
        submenu: notifyLevelEntries(
          c.notifyLevel,
          (level) => void patchPrefs(c, { notifyLevel: level }),
          { spaceLevel: spaceNotifyLevel(space) },
        ),
      },
      canManage && 'separator',
      canManage && { label: 'Edit Channel', icon: Pencil, onSelect: () => setDialog({ kind: 'channel', chat: c }) },
      canManage && manageChannels && { label: 'Clone Channel', icon: CopyPlus, onSelect: () => setDialog({ kind: 'clone', chat: c }) },
      canManage && { label: 'Move Up', icon: ArrowUp, onSelect: () => move(c, -1) },
      canManage && { label: 'Move Down', icon: ArrowDown, onSelect: () => move(c, 1) },
      canManage && { label: 'Delete Channel', icon: Trash2, danger: true, onSelect: () => removeChannel(c) },
      'separator',
      { label: 'Copy Channel ID', icon: IdCard, onSelect: () => copyId(c.id, 'Channel') },
    ]);
  };

  const categoryItems = (category: SpaceCategory): MenuEntry[] => {
    const inside = channels.filter((c) => c.space?.categoryId === category.id);
    const unread = inside.filter((c) => c.lastSeq > c.lastReadSeq || c.unreadMentionCount > 0);
    const muted = isCategoryMuted(inside);
    return tidy([
      {
        label: 'Mark As Read',
        icon: CheckCheck,
        disabled: unread.length === 0,
        onSelect: () => {
          for (const c of unread) markChatRead(c.id, { force: true });
        },
      },
      'separator',
      {
        label: 'Collapse Category',
        checked: !!collapsed[category.id],
        keepOpen: true,
        onSelect: () => toggle(category.id),
      },
      { label: 'Collapse All Categories', icon: ChevronsDownUp, onSelect: collapseAll },
      'separator',
      // A category mute is the mute of each of its channels (per-channel prefs).
      inside.length > 0 &&
        muteEntry(
          'Category',
          muted ? (inside.map((c) => c.mutedUntil!).sort()[0] ?? null) : null,
          muted,
          (until) => mute(inside, until),
        ),
      manageChannels && 'separator',
      manageChannels && { label: 'Edit Category', icon: Pencil, onSelect: () => setDialog({ kind: 'category', category }) },
      manageChannels && {
        label: 'Delete Category',
        icon: Trash2,
        danger: true,
        onSelect: () =>
          void confirm({
            title: `Delete ‘${category.name}’?`,
            message: 'Its channels are kept and move out of the category.',
            confirmLabel: 'Delete Category',
            danger: true,
          }).then(
            (ok) => ok && void deleteCategory(spaceId, category.id).catch((e: unknown) => toast.error(e)),
          ),
      },
      'separator',
      { label: 'Copy Category ID', icon: IdCard, onSelect: () => copyId(category.id, 'Category') },
    ]);
  };

  const menuItems = (): MenuEntry[] => {
    if (!menu) return [];
    if (menu.kind === 'channel') {
      const chat = channels.find((c) => c.id === menu.chatId);
      return chat ? channelItems(chat) : [];
    }
    const category = space.categories.find((c) => c.id === menu.categoryId);
    return category ? categoryItems(category) : [];
  };

  return (
    <aside aria-label="Channels" className="lg:card-pane flex w-[260px] min-w-0 flex-1 flex-col bg-surface lg:flex-none">
      <DropdownMenu
        aria-label={`${space.name} menu`}
        align="start"
        items={spaceMenu.headerItems()}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            className="flex h-14 w-full shrink-0 items-center gap-2 px-4 text-left font-bold text-fg transition-colors hover:bg-hover lg:rounded-t-[var(--radius-card)]"
            data-testid="space-header"
          >
            <span className="min-w-0 flex-1 truncate text-[16px]">{space.name}</span>
            <ChevronDown size={18} className={cn('shrink-0 transition-transform', p.active && 'rotate-180')} aria-hidden />
          </button>
        )}
      />
      {space.bannerUrl ? (
        <div className="mx-3 mb-2 h-24 shrink-0 overflow-hidden rounded-xl bg-surface-2">
          <img src={space.bannerUrl} alt="" className="size-full object-cover" />
        </div>
      ) : null}
      <nav className="min-h-0 flex-1 overflow-y-auto pb-4" aria-label={`${space.name} channels`}>
        {shown.map(({ group: g, shown: list }) => {
          const isCollapsed = g.category ? !!collapsed[g.category.id] : false;
          return (
            <div key={g.category?.id ?? 'none'} className="pt-4">
              {g.category ? (
                <div
                  className="group/cat flex items-center pr-3 pl-2"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ kind: 'category', categoryId: g.category!.id, anchor: contextMenuAnchor(e) });
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggle(g.category!.id)}
                    className="flex min-w-0 flex-1 items-center gap-0.5 rounded px-1 py-1 text-[12px] font-bold tracking-wide text-muted uppercase hover:text-fg"
                  >
                    {isCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                    <span className="truncate">{g.category.name}</span>
                  </button>
                  {manageChannels ? (
                    <button
                      type="button"
                      aria-label={`Create channel in ${g.category.name}`}
                      title="Create Channel"
                      onClick={() => setDialog({ kind: 'channel', categoryId: g.category!.id })}
                      className="rounded p-0.5 text-muted opacity-0 group-hover/cat:opacity-100 hover:text-fg focus-visible:opacity-100"
                    >
                      <PlusCircle size={16} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-0.5 flex flex-col gap-0.5">
                {list.map((c) => (
                  <ChannelRow
                    key={c.id}
                    chat={c}
                    active={c.id === chatId}
                    onMenu={(chat, anchor) => setMenu({ kind: 'channel', chatId: chat.id, anchor })}
                    onInvite={(chat) => setDialog({ kind: 'invite', channelId: chat.id })}
                    onEdit={(chat) => setDialog({ kind: 'channel', chat })}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {channels.length === 0 ? (
          <p className="px-4 pt-6 text-sm text-muted">No channels you can see yet.</p>
        ) : null}
      </nav>
      <UserPanel className="hidden lg:flex" />

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? null}
        items={menuItems()}
        aria-label={menu?.kind === 'category' ? 'Category menu' : 'Channel menu'}
      />
      {spaceMenu.dialogs}
      {dialog?.kind === 'channel' ? (
        <ChannelDialog spaceId={spaceId} chat={dialog.chat} categoryId={dialog.categoryId} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'clone' ? <CloneChannelDialog spaceId={spaceId} chat={dialog.chat} onClose={closeDialog} /> : null}
      {dialog?.kind === 'category' ? (
        <CategoryDialog spaceId={spaceId} category={dialog.category} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === 'invite' ? <InviteDialog space={space} channelId={dialog.channelId} onClose={closeDialog} /> : null}
    </aside>
  );
}
