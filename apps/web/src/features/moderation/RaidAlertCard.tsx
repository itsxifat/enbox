/**
 * A `raid_alert` system message (the safety alerts channel): "Unusual join activity: N
 * members joined in M minutes", with Pause Invites (moderators who may: MANAGE_SPACE or
 * MODERATE_MEMBERS; "Invites paused" while they are), "Open Members (joined in the last
 * hour)" (moderators who see the Members page) and Dismiss, which folds it into its one-line
 * notice on this device. SystemPill renders it for this kind.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { systemEventText, type SystemEvent } from '@enbox/shared';
import { Button, choose, toast } from '@/components/ui';
import { visibleSettingsSections, settingsPath } from '@/features/spaces/settings/sections';
import { formatTime } from '@/lib/format';
import { storage } from '@/lib/storage';
import { useChats } from '@/stores/chats';
import type { ClientMessage } from '@/stores/messages';
import { useSpace } from '@/stores/spaces';
import { canSeeSecurity, liveUntil, updateSecurity } from './api';
import { PAUSE_CHOICES, untilLabel } from './labels';

type RaidEvent = Extract<SystemEvent, { kind: 'raid_alert' }>;

const dismissedKey = (messageId: string) => `enbox.raidAlert.dismissed.${messageId}`;

export function RaidAlertCard({ m, event }: { m: ClientMessage; event: RaidEvent }) {
  const spaceId = useChats((s) => s.byId[m.chatId]?.space?.spaceId ?? null);
  const space = useSpace(spaceId);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => storage.get(dismissedKey(m.id)) === '1');
  const [busy, setBusy] = useState(false);
  const text = systemEventText(event, () => '');
  if (dismissed)
    return (
      <div className="flex justify-center px-4 py-1">
        <p className="rounded-lg bg-surface/95 px-3 py-1.5 text-[12.5px] text-muted">{text}</p>
      </div>
    );
  const paused = liveUntil(space?.security?.invitesPausedUntil);
  const canPause = !!space && canSeeSecurity(space);
  const canOpenMembers = !!space && visibleSettingsSections(space).some((s) => s.id === 'members');

  const pause = () =>
    void choose({
      title: 'Pause Invites',
      message:
        'No one can join this Space with an invite, a vanity link or Discovery until it ends.',
      options: PAUSE_CHOICES.map((c) => ({ value: String(c.seconds), label: `For ${c.label}` })),
    }).then(async (v) => {
      if (!v || !space) return;
      setBusy(true);
      try {
        await updateSecurity(space.id, { pauseInvitesSec: Number(v) });
        toast.success('Invites paused');
      } catch (e) {
        toast.error(e);
      } finally {
        setBusy(false);
      }
    });

  const dismiss = () => {
    storage.set(dismissedKey(m.id), '1');
    setDismissed(true);
  };

  return (
    <div className="flex items-start gap-3 px-3 py-1.5 lg:px-5" data-testid="raid-alert">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
        aria-hidden
      >
        <ShieldAlert size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[15px]">
          <span className="font-semibold text-fg">Safety alert</span>
          <span className="rounded-[4px] bg-brand px-1 text-[10px] leading-4 font-bold tracking-wide text-on-brand uppercase">
            System
          </span>
          <span className="text-[12px] text-subtle">{formatTime(m.createdAt)}</span>
        </p>
        <div className="mt-1.5 max-w-xl rounded-lg border-l-4 border-danger bg-surface-2 px-3 py-2.5">
          <p className="text-[14px] font-medium text-fg">{text}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            That’s a lot of new people at once. If it looks like a raid, pause invites while you
            clean up.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {canPause ? (
            <Button size="sm" variant="danger" loading={busy} disabled={!!paused} onClick={pause}>
              {paused ? `Invites paused ${untilLabel(paused)}` : 'Pause Invites'}
            </Button>
          ) : null}
          {canOpenMembers && space ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(`${settingsPath(space.id, 'members')}?joined=1h`)}
            >
              Open Members (joined in the last hour)
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
