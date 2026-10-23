/**
 * Menu entries of the safety features, built by the safety builder: Report Message (message
 * menu), Ignore / Unignore and Report User (profile menu), and the Ignore confirmations.
 */
import { createElement } from 'react';
import { EyeOff, Flag } from 'lucide-react';
import { userDisplayName, type ChatSummary, type ID, type UserPublic } from '@enbox/shared';
import { confirm, toast, type MenuEntry } from '@/components/ui';
import { isLocalId } from '@/lib/ids';
import { getMyId } from '@/stores/auth';
import { isIgnored, useIgnores, useIsIgnored } from '@/stores/ignores';
import type { ClientMessage } from '@/stores/messages';
import { nameOf } from '@/stores/users';
import { openReport } from './report';

/** Someone else's sent, live, non-system message (webhook posts included). */
export function canReportMessage(m: ClientMessage, meId: ID | null | undefined): boolean {
  if (!meId || m.senderId === meId) return false;
  if (m.type === 'system' || m.type === 'call' || m.deletedAt) return false;
  if (!m.senderId && !m.authorOverride) return false;
  return !isLocalId(m.id) && !m.pending && !m.failed;
}

export function reportMessageItem(
  _chat: ChatSummary,
  m: ClientMessage,
  meId: ID | undefined,
): MenuEntry {
  if (!canReportMessage(m, meId)) return null;
  const from = m.senderId ? nameOf(m.senderId) : (m.authorOverride?.name ?? 'a webhook');
  return {
    label: 'Report Message',
    icon: Flag,
    danger: true,
    onSelect: () =>
      openReport({ targetType: 'message', targetId: m.id, userId: m.senderId, label: from }),
  };
}

/** "Ignore" / "Unignore", live (the menu's items may be built before a change). */
function IgnoreLabel({ userId }: { userId: ID }) {
  return useIsIgnored(userId) ? 'Unignore' : 'Ignore';
}

export async function confirmIgnore(user: UserPublic): Promise<boolean> {
  const name = userDisplayName(user);
  const ok = await confirm({
    title: `Ignore ${name}?`,
    message:
      'Their messages will be hidden behind “Ignored message”, and you won’t see them typing or get notifications from them. They won’t be told.',
    confirmLabel: 'Ignore',
  });
  if (!ok) return false;
  try {
    await useIgnores.getState().ignore(user.id);
    toast.success(`${name} is ignored`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export async function confirmUnignore(user: UserPublic): Promise<boolean> {
  const name = userDisplayName(user);
  const ok = await confirm({
    title: `Unignore ${name}?`,
    message: 'Their messages, typing and notifications will show again.',
    confirmLabel: 'Unignore',
  });
  if (!ok) return false;
  try {
    await useIgnores.getState().unignore(user.id);
    toast.success(`${name} is no longer ignored`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

export function userSafetyItems(user: UserPublic): MenuEntry[] {
  if (user.isDeleted || user.id === getMyId()) return [];
  return [
    {
      label: createElement(IgnoreLabel, { userId: user.id }),
      icon: EyeOff,
      onSelect: () => void (isIgnored(user.id) ? confirmUnignore(user) : confirmIgnore(user)),
    },
    {
      label: 'Report User',
      icon: Flag,
      danger: true,
      onSelect: () =>
        openReport({
          targetType: 'user',
          targetId: user.id,
          userId: user.id,
          label: userDisplayName(user),
        }),
    },
  ];
}
