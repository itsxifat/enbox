import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Hash,
  LogOut,
  Pencil,
  PlusCircle,
  Settings,
  Trash2,
  UserPen,
  UserPlus,
  Volume2,
} from 'lucide-react';
import {
  MUTE_FOREVER_ISO,
  PERM,
  hasPerm,
  isMuted,
  type ChatSummary,
  type ID,
  type Space,
  type SpaceCategory,
} from '@enbox/shared';
import { Badge, DropdownMenu, Menu, confirm, toast, type MenuAnchor, type MenuEntry } from '@/components/ui';
import { UserPanel } from '@/components/layout/UserPanel';
import { cn } from '@/lib/cn';
import { patchPrefs } from '@/features/chats/chatActions';
import { markChatRead } from '@/realtime';
import { useSpace, useSpaceChannels } from '@/stores/spaces';
import { useMe } from '@/stores/auth';
import { deleteChannel, leaveSpace, moveChannels, spaceMemory } from './actions';
import { ChannelDialog } from './dialogs/ChannelDialog';
import { CategoryDialog } from './dialogs/CategoryDialog';
import { InviteDialog } from './dialogs/InviteDialog';
import { NicknameDialog } from './dialogs/NicknameDialog';
import { NotificationDialog } from './dialogs/NotificationDialog';

interface Group {
  category: SpaceCategory | null;
  channels: ChatSummary[];
}

function groupsOf(space: Space, channels: ChatSummary[]): Group[] {
  const out: Group[] = [{ category: null, channels: [] }];
  const byCat = new Map<ID, Group>();
  for (const c of [...space.categories].sort((a, b) => a.position - b.position)) {
    const g = { category: c, channels: [] as ChatSummary[] };
    byCat.set(c.id, g);
    out.push(g);
  }
  for (const ch of channels) {
    const g = ch.space?.categoryId ? byCat.get(ch.space.categoryId) : undefined;
    (g ?? out[0]!).channels.push(ch);
  }
  return out;
}

export function isChannelUnread(c: ChatSummary): boolean {
  return c.type === 'space_text' && c.lastSeq > c.lastReadSeq && !isMuted(c.mutedUntil);
}

function ChannelRow({
  chat,
  active,
  onMenu,
}: {
  chat: ChatSummary;
  active: boolean;
  onMenu: (chat: ChatSummary, anchor: MenuAnchor) => void;
}) {
  const unread = isChannelUnread(chat);
  const muted = isMuted(chat.mutedUntil);
  const Icon = chat.type === 'space_voice' ? Volume2 : Hash;
  const canManage = hasPerm(chat.spacePermissions, PERM.MANAGE_CHANNELS);
  return (
    <div className="group/ch relative px-2">
      {/* Unread pill on the sidebar edge (Discord). */}
      {unread && !active ? (
        <span aria-hidden className="absolute top-1/2 left-0 h-2 w-1 -translate-y-1/2 rounded-r-full bg-fg" />
      ) : null}
      <Link
        to={`/spaces/${chat.space!.spaceId}/${chat.id}`}
        aria-current={active ? 'page' : undefined}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          onMenu(chat, { x: e.clientX, y: e.clientY });
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
        {canManage ? (
          <button
            type="button"
            aria-label={`Channel settings for ${chat.name}`}
            className="hidden rounded p-0.5 text-muted group-hover/ch:block hover:text-fg"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenu(chat, e.currentTarget);
            }}
          >
            <Settings size={15} aria-hidden />
          </button>
        ) : null}
      </Link>
    </div>
  );
}

/** Channel list of one Space (Discord's left column), with the Space menu in its header. */
export function ChannelSidebar({ spaceId }: { spaceId: ID }) {
  const space = useSpace(spaceId);
  const channels = useSpaceChannels(spaceId);
  const me = useMe();
  const navigate = useNavigate();
  const { chatId } = useParams<{ chatId?: string }>();
  const [collapsed, setCollapsed] = useState(spaceMemory.collapsed);
  const [menu, setMenu] = useState<{ chat: ChatSummary; anchor: MenuAnchor } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'channel'; chat?: ChatSummary; categoryId?: ID | null }
    | { kind: 'category' }
    | { kind: 'invite'; channelId?: ID }
    | { kind: 'nickname' }
    | { kind: 'notifications'; chat?: ChatSummary }
    | null
  >(null);
  const groups = useMemo(() => (space ? groupsOf(space, channels) : []), [space, channels]);

  if (!space) {
    return (
      <aside aria-label="Channels" className="lg:card-pane flex w-[260px] min-w-0 flex-1 flex-col bg-surface lg:flex-none" />
    );
  }

  const bits = space.myPermissions;
  const manageChannels = hasPerm(bits, PERM.MANAGE_CHANNELS);
  const canSettings = [PERM.MANAGE_SPACE, PERM.MANAGE_ROLES, PERM.KICK_MEMBERS, PERM.BAN_MEMBERS, PERM.VIEW_AUDIT_LOG, PERM.MODERATE_MEMBERS].some((p) => hasPerm(bits, p));
  const owner = space.ownerId === me?.id;

  const toggle = (id: ID) => {
    const next = !collapsed[id];
    spaceMemory.setCollapsed(id, next);
    setCollapsed((c) => ({ ...c, [id]: next }));
  };

  const spaceItems: MenuEntry[] = [
    hasPerm(bits, PERM.CREATE_INVITE) && { label: 'Invite people', icon: UserPlus, onSelect: () => setDialog({ kind: 'invite' }) },
    canSettings && { label: 'Space settings', icon: Settings, onSelect: () => navigate(`/spaces/${spaceId}/settings`) },
    manageChannels && { label: 'Create channel', icon: PlusCircle, onSelect: () => setDialog({ kind: 'channel' }) },
    manageChannels && { label: 'Create category', icon: FolderPlus, onSelect: () => setDialog({ kind: 'category' }) },
    'separator',
    { label: 'Notification settings', icon: Bell, onSelect: () => setDialog({ kind: 'notifications' }) },
    hasPerm(bits, PERM.CHANGE_NICKNAME) && { label: 'Edit Space profile', icon: UserPen, onSelect: () => setDialog({ kind: 'nickname' }) },
    !owner && 'separator',
    !owner && {
      label: 'Leave Space',
      icon: LogOut,
      danger: true,
      onSelect: () =>
        void confirm({ title: `Leave ${space.name}?`, message: 'You won’t be able to rejoin unless you are invited again.', confirmLabel: 'Leave Space', danger: true }).then(async (ok) => {
          if (!ok) return;
          try {
            await leaveSpace(spaceId);
            navigate('/spaces', { replace: true });
          } catch (e) {
            toast.error(e);
          }
        }),
    },
  ];

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

  const channelItems = (c: ChatSummary): MenuEntry[] => {
    const canManage = hasPerm(c.spacePermissions, PERM.MANAGE_CHANNELS);
    const muted = isMuted(c.mutedUntil);
    return [
      c.type === 'space_text' && isChannelUnread(c) && { label: 'Mark as read', onSelect: () => markChatRead(c.id, { force: true }) },
      c.type === 'space_text' && {
        label: muted ? 'Unmute channel' : 'Mute channel',
        icon: muted ? Bell : BellOff,
        onSelect: () => void patchPrefs(c, { mutedUntil: muted ? null : MUTE_FOREVER_ISO }),
      },
      c.type === 'space_text' && { label: 'Notification settings', icon: Bell, onSelect: () => setDialog({ kind: 'notifications', chat: c }) },
      hasPerm(c.spacePermissions, PERM.CREATE_INVITE) && { label: 'Invite people', icon: UserPlus, onSelect: () => setDialog({ kind: 'invite', channelId: c.id }) },
      {
        label: 'Copy link',
        icon: Copy,
        onSelect: () =>
          void navigator.clipboard
            .writeText(`${location.origin}/spaces/${spaceId}/${c.id}`)
            .then(() => toast.success('Link copied')),
      },
      canManage && 'separator',
      canManage && { label: 'Edit channel', icon: Pencil, onSelect: () => setDialog({ kind: 'channel', chat: c }) },
      canManage && { label: 'Move up', icon: ArrowUp, onSelect: () => move(c, -1) },
      canManage && { label: 'Move down', icon: ArrowDown, onSelect: () => move(c, 1) },
      canManage && {
        label: 'Delete channel',
        icon: Trash2,
        danger: true,
        onSelect: () =>
          void confirm({ title: `Delete #${c.name}?`, message: 'Its messages are deleted for everyone. This cannot be undone.', confirmLabel: 'Delete channel', danger: true }).then(async (ok) => {
            if (!ok) return;
            try {
              await deleteChannel(spaceId, c.id);
              if (chatId === c.id) navigate(`/spaces/${spaceId}`, { replace: true });
            } catch (e) {
              toast.error(e);
            }
          }),
      },
    ];
  };

  return (
    <aside aria-label="Channels" className="lg:card-pane flex w-[260px] min-w-0 flex-1 flex-col bg-surface lg:flex-none">
      <DropdownMenu
        aria-label={`${space.name} menu`}
        align="start"
        items={spaceItems}
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
        {groups.map((g) => {
          if (!g.category && g.channels.length === 0) return null;
          const isCollapsed = g.category ? !!collapsed[g.category.id] : false;
          const shown = isCollapsed ? g.channels.filter((c) => c.id === chatId || isChannelUnread(c)) : g.channels;
          return (
            <div key={g.category?.id ?? 'none'} className="pt-4">
              {g.category ? (
                <div className="group/cat flex items-center pr-3 pl-2">
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
                      onClick={() => setDialog({ kind: 'channel', categoryId: g.category!.id })}
                      className="rounded p-0.5 text-muted opacity-0 group-hover/cat:opacity-100 hover:text-fg focus-visible:opacity-100"
                    >
                      <PlusCircle size={16} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-0.5 flex flex-col gap-0.5">
                {shown.map((c) => (
                  <ChannelRow key={c.id} chat={c} active={c.id === chatId} onMenu={(chat, anchor) => setMenu({ chat, anchor })} />
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

      <Menu open={!!menu} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} items={menu ? channelItems(menu.chat) : []} aria-label="Channel menu" />
      {dialog?.kind === 'channel' ? (
        <ChannelDialog spaceId={spaceId} chat={dialog.chat} categoryId={dialog.categoryId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'category' ? <CategoryDialog spaceId={spaceId} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'invite' ? <InviteDialog space={space} channelId={dialog.channelId} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'nickname' ? <NicknameDialog space={space} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'notifications' ? <NotificationDialog space={space} chat={dialog.chat} onClose={() => setDialog(null)} /> : null}
    </aside>
  );
}
