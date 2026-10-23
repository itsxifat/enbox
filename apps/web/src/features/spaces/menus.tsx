/**
 * Discord's Space menus: the header dropdown of the channel sidebar and the right-click menu
 * of a Space in the rail share one hook (`useSpaceMenu`) that builds the items from my
 * permissions and owns the dialogs they open. Mute / notification submenu builders are shared
 * with the channel and category menus (ChannelSidebar).
 */
import { Suspense, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Bell,
  BellOff,
  CalendarPlus,
  CheckCheck,
  EyeOff,
  FolderPlus,
  IdCard,
  LogOut,
  PlusCircle,
  Settings,
  UserPen,
  UserPlus,
} from 'lucide-react';
import {
  PERM,
  SPACE_MUTE_DURATIONS,
  hasPerm,
  type ID,
  type NotifyLevel,
  type Space,
} from '@enbox/shared';
import { confirm, toast, type MenuEntry } from '@/components/ui';
import { copyText } from '@/features/groups/shared/share';
import { lazyNamed } from '@/lib/lazy';
import { useMe } from '@/stores/auth';
import { useEvents } from '@/stores/events';
import { isSpaceMuted } from '@/stores/spaces';
import { leaveSpace, markSpaceRead, updateMyMember } from './actions';
import { CategoryDialog } from './dialogs/CategoryDialog';
import { ChannelDialog } from './dialogs/ChannelDialog';
import { InviteDialog } from './dialogs/InviteDialog';
import { NicknameDialog } from './dialogs/NicknameDialog';
import { NotificationDialog } from './dialogs/NotificationDialog';
import { canOpenSpaceSettings, settingsPath, visibleSettingsSections } from './settings/sections';
import { NOTIFY_LABELS, muteUntilIso, mutedUntilText } from './sidebar';

// The per-server profile editor (crop, pickers, profile card preview) loads when opened.
const ServerProfileDialog = lazyNamed(
  () => import('./serverProfile/ServerProfileDialog'),
  'ServerProfileDialog',
);

/** Copy an id to the clipboard ("Copy Space ID" etc.). */
export function copyId(id: ID, what: string): void {
  void copyText(id).then((ok) => (ok ? toast.success(`${what} ID copied`) : toast.error('Could not copy')));
}

/**
 * Mute ▸ durations, or "Unmute …" with when the mute ends. `onChange(null)` unmutes.
 */
export function muteEntry(
  what: 'Space' | 'Channel' | 'Category',
  mutedUntil: string | null,
  muted: boolean,
  onChange: (until: string | null) => void,
): MenuEntry {
  if (muted)
    return {
      label: `Unmute ${what}`,
      icon: Bell,
      description: mutedUntilText(mutedUntil) ?? undefined,
      onSelect: () => onChange(null),
    };
  return {
    label: `Mute ${what}`,
    icon: BellOff,
    submenu: SPACE_MUTE_DURATIONS.map((d) => ({ label: d.label, onSelect: () => onChange(muteUntilIso(d.ms)) })),
  };
}

/** Radio items of the notification levels; `withDefault` adds "Use Space Default" (channels). */
export function notifyLevelEntries(
  current: NotifyLevel | null,
  onChange: (level: NotifyLevel | null) => void,
  withDefault?: { spaceLevel: NotifyLevel },
): MenuEntry[] {
  return [
    withDefault && {
      label: 'Use Space Default',
      description: NOTIFY_LABELS[withDefault.spaceLevel],
      checked: current === null,
      radio: true,
      onSelect: () => onChange(null),
    },
    ...(['all', 'mentions', 'none'] as const).map((l) => ({
      label: NOTIFY_LABELS[l],
      checked: current === l,
      radio: true,
      onSelect: () => onChange(l),
    })),
  ];
}

/** My effective level for the whole Space. */
export function spaceNotifyLevel(space: Space): NotifyLevel {
  return space.me.notifyLevel ?? space.defaultNotifyLevel;
}

type SpaceDialog =
  | { kind: 'invite' }
  | { kind: 'channel' }
  | { kind: 'category' }
  | { kind: 'nickname' }
  | { kind: 'serverProfile' }
  | { kind: 'notifications' };

export interface SpaceMenu {
  /** The channel sidebar header dropdown (Discord's server name menu). */
  headerItems: () => MenuEntry[];
  /** Right-click on the Space in the rail. */
  railItems: () => MenuEntry[];
  /** Render once next to the menu: the dialogs its items open. */
  dialogs: ReactNode;
}

/** Items and dialogs of a Space's menus (only what my permissions allow). */
export function useSpaceMenu(space: Space | undefined): SpaceMenu {
  const navigate = useNavigate();
  const me = useMe();
  const [dialog, setDialog] = useState<SpaceDialog | null>(null);
  const close = () => setDialog(null);

  if (!space) return { headerItems: () => [], railItems: () => [], dialogs: null };
  const bits = space.myPermissions;
  const owner = space.ownerId === me?.id;
  const manageChannels = hasPerm(bits, PERM.MANAGE_CHANNELS);
  const muted = isSpaceMuted(space);
  const save = (body: Parameters<typeof updateMyMember>[1]) =>
    void updateMyMember(space.id, body).catch((e: unknown) => toast.error(e));

  const leave = async () => {
    if (owner) {
      const go = await confirm({
        title: 'You own this Space',
        message: 'Transfer ownership to another member before leaving: Space Settings → Members → Transfer Ownership.',
        confirmLabel: 'Open Members',
      });
      if (go) navigate(settingsPath(space.id, 'members'));
      return;
    }
    const ok = await confirm({
      title: `Leave '${space.name}'`,
      message: `Are you sure you want to leave ${space.name}? You won’t be able to rejoin this Space unless you are re-invited.`,
      confirmLabel: 'Leave Space',
      danger: true,
    });
    if (!ok) return;
    try {
      await leaveSpace(space.id);
      navigate('/spaces', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };

  const invite: MenuEntry = hasPerm(bits, PERM.CREATE_INVITE) && {
    label: 'Invite People',
    icon: UserPlus,
    onSelect: () => setDialog({ kind: 'invite' }),
  };
  const createChannel: MenuEntry = manageChannels && {
    label: 'Create Channel',
    icon: PlusCircle,
    onSelect: () => setDialog({ kind: 'channel' }),
  };
  const createCategory: MenuEntry = manageChannels && {
    label: 'Create Category',
    icon: FolderPlus,
    onSelect: () => setDialog({ kind: 'category' }),
  };
  const createEvent: MenuEntry = manageChannels && {
    label: 'Create Event',
    icon: CalendarPlus,
    onSelect: () => useEvents.getState().openModal(space.id, { create: true }),
  };
  const profile: MenuEntry = hasPerm(bits, PERM.CHANGE_NICKNAME) && {
    label: 'Edit Space Profile',
    icon: UserPen,
    onSelect: () => setDialog({ kind: 'nickname' }),
  };
  // Nickname, avatar, banner, bio… for this Space only (the nickname field follows CHANGE_NICKNAME).
  const serverProfile: MenuEntry = {
    label: 'Edit Per-server Profile',
    icon: UserPen,
    onSelect: () => setDialog({ kind: 'serverProfile' }),
  };
  const hideMuted: MenuEntry = {
    label: 'Hide Muted Channels',
    icon: EyeOff,
    checked: space.me.hideMutedChannels,
    keepOpen: true,
    onSelect: () => save({ hideMutedChannels: !space.me.hideMutedChannels }),
  };
  const leaveItem: MenuEntry = { label: 'Leave Space', icon: LogOut, danger: true, onSelect: () => void leave() };
  const copy: MenuEntry = { label: 'Copy Space ID', icon: IdCard, onSelect: () => copyId(space.id, 'Space') };
  const settings = canOpenSpaceSettings(space);

  const headerItems = (): MenuEntry[] =>
    tidy([
      invite,
      settings && { label: 'Space Settings', icon: Settings, onSelect: () => navigate(settingsPath(space.id)) },
      createChannel,
      createCategory,
      createEvent,
      'separator',
      { label: 'Notification Settings', icon: Bell, onSelect: () => setDialog({ kind: 'notifications' }) },
      'separator',
      serverProfile,
      hideMuted,
      'separator',
      leaveItem,
      'separator',
      copy,
    ]);

  const railItems = (): MenuEntry[] => {
    const sections = visibleSettingsSections(space);
    return tidy([
      { label: 'Mark As Read', icon: CheckCheck, onSelect: () => void markSpaceRead(space.id).catch((e: unknown) => toast.error(e)) },
      'separator',
      invite,
      'separator',
      muteEntry('Space', space.me.mutedUntil, muted, (until) => save({ mutedUntil: until })),
      {
        label: 'Notification Settings',
        icon: Bell,
        submenu: [
          ...notifyLevelEntries(spaceNotifyLevel(space), (l) => save({ notifyLevel: l })),
          'separator',
          {
            label: 'Suppress @everyone and @here',
            checked: space.me.suppressEveryone,
            keepOpen: true,
            onSelect: () => save({ suppressEveryone: !space.me.suppressEveryone }),
          },
          {
            label: 'Suppress All Role @mentions',
            checked: space.me.suppressRoles,
            keepOpen: true,
            onSelect: () => save({ suppressRoles: !space.me.suppressRoles }),
          },
          'separator',
          { label: 'More Notification Settings', onSelect: () => setDialog({ kind: 'notifications' }) },
        ],
      },
      hideMuted,
      'separator',
      settings &&
        sections.length > 0 && {
          label: 'Space Settings',
          icon: Settings,
          submenu: sections.map((s) => ({ label: s.label, onSelect: () => navigate(settingsPath(space.id, s.id)) })),
        },
      profile,
      'separator',
      createChannel,
      createCategory,
      'separator',
      leaveItem,
      'separator',
      copy,
    ]);
  };

  const dialogs = (
    <>
      {dialog?.kind === 'invite' ? <InviteDialog space={space} onClose={close} /> : null}
      {dialog?.kind === 'channel' ? <ChannelDialog spaceId={space.id} onClose={close} /> : null}
      {dialog?.kind === 'category' ? <CategoryDialog spaceId={space.id} onClose={close} /> : null}
      {dialog?.kind === 'nickname' ? <NicknameDialog space={space} onClose={close} /> : null}
      {dialog?.kind === 'serverProfile' ? (
        <Suspense fallback={null}>
          <ServerProfileDialog space={space} onClose={close} />
        </Suspense>
      ) : null}
      {dialog?.kind === 'notifications' ? <NotificationDialog space={space} onClose={close} /> : null}
    </>
  );

  return { headerItems, railItems, dialogs };
}

/** Separators at the start, end or doubled (items hidden by permissions) are dropped. */
export function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue;
    out.push(it);
  }
  while (out[out.length - 1] === 'separator') out.pop();
  return out;
}
