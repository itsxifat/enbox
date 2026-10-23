/**
 * Security actions (Safety Setup, and the Members page for moderators): Pause Invites and
 * Pause DMs for 1, 6, 12 or 24 hours with Resume (MANAGE_SPACE or MODERATE_MEMBERS), and the
 * safety alerts channel with the raid alerts switch (MANAGE_SPACE). Reads `space.security`
 * (kept current by `space:security`), fetching it once when the Space came without it.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, MessageSquareOff, ShieldAlert, UserX } from 'lucide-react';
import { PERM, hasPerm, type Space, type SpaceSecurity } from '@enbox/shared';
import { Button, DropdownMenu, Spinner, Switch, toast, type IconType } from '@/components/ui';
import { useSpaceChannels } from '@/stores/spaces';
import { canSeeSecurity, fetchSecurity, liveUntil, updateSecurity } from './api';
import { PAUSE_CHOICES, untilLabel } from './labels';
import { useNow } from './useNow';

function PauseRow({
  icon: Icon,
  title,
  description,
  pausedText,
  until,
  busy,
  onChange,
}: {
  icon: IconType;
  title: string;
  description: string;
  pausedText: string;
  until: string | null;
  busy: boolean;
  onChange: (seconds: number | null) => void;
}) {
  const paused = liveUntil(until);
  return (
    <div className="flex items-center gap-3 py-2.5" data-testid={`pause-${title}`}>
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${paused ? 'bg-danger-soft text-danger' : 'bg-surface text-muted'}`}
        aria-hidden
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-fg">{title}</p>
        <p className={`text-[13px] ${paused ? 'text-danger' : 'text-muted'}`}>
          {paused ? `${pausedText} ${untilLabel(paused)}` : description}
        </p>
      </div>
      {paused ? (
        <Button size="sm" variant="soft" loading={busy} onClick={() => onChange(null)}>
          Resume
        </Button>
      ) : (
        <DropdownMenu
          aria-label={`${title} for`}
          trigger={({ active: _active, ...p }) => (
            <Button {...p} size="sm" variant="secondary" rightIcon={ChevronDown} loading={busy}>
              {title}
            </Button>
          )}
          items={PAUSE_CHOICES.map((c) => ({
            label: `For ${c.label}`,
            onSelect: () => onChange(c.seconds),
          }))}
        />
      )}
    </div>
  );
}

export function SecurityCard({ space, compact = false }: { space: Space; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const channels = useSpaceChannels(space.id).filter((c) => c.type === 'space_text');
  const security = space.security;
  const manage = hasPerm(space.myPermissions, PERM.MANAGE_SPACE);
  const allowed = canSeeSecurity(space);
  // Re-render when a pause runs out.
  useNow(30_000);
  useEffect(() => {
    if (allowed && security === undefined) void fetchSecurity(space.id).catch(() => undefined);
  }, [allowed, security, space.id]);
  if (!allowed) return null;

  const change = async (key: string, body: Parameters<typeof updateSecurity>[1], done?: string) => {
    setBusy(key);
    try {
      await updateSecurity(space.id, body);
      if (done) toast.success(done);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const s: SpaceSecurity | null = security ?? null;

  return (
    <section className="card-inset flex flex-col px-4 py-3" aria-label="Security actions">
      <div className="flex items-center gap-2 pb-1">
        <ShieldAlert size={18} className="text-brand-ink" aria-hidden />
        <h3 className="text-[15px] font-semibold">Security actions</h3>
      </div>
      <p className="text-[13px] text-muted">
        Under attack? Stop new people from joining, or from messaging members, for a while.
      </p>
      {!s ? (
        <div className="py-3">
          <Spinner size={20} />
        </div>
      ) : (
        <>
          <PauseRow
            icon={UserX}
            title="Pause Invites"
            description="No one can join with an invite, a vanity link or Discovery."
            pausedText="Invites are paused"
            until={s.invitesPausedUntil}
            busy={busy === 'invites'}
            onChange={(sec) =>
              void change(
                'invites',
                { pauseInvitesSec: sec },
                sec === null ? 'Invites resumed' : 'Invites paused',
              )
            }
          />
          <PauseRow
            icon={MessageSquareOff}
            title="Pause DMs"
            description="Members who aren’t friends can’t start DMs with each other through this Space."
            pausedText="DMs are paused"
            until={s.dmsPausedUntil}
            busy={busy === 'dms'}
            onChange={(sec) =>
              void change('dms', { pauseDmsSec: sec }, sec === null ? 'DMs resumed' : 'DMs paused')
            }
          />
          {manage && !compact ? (
            <div className="mt-2 flex flex-col gap-1.5 pt-2">
              <label htmlFor={`${space.id}-alerts-channel`} className="text-sm font-medium text-fg">
                Safety alerts channel
              </label>
              <select
                id={`${space.id}-alerts-channel`}
                className="h-10 rounded-xl border border-line-strong bg-surface px-3 text-[15px] text-fg"
                value={s.safetyAlertsChannelId ?? ''}
                disabled={busy === 'channel'}
                onChange={(e) =>
                  void change('channel', { safetyAlertsChannelId: e.target.value || null })
                }
              >
                <option value="">No alerts channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
              <p className="text-[13px] text-muted">
                {s.safetyAlertsChannelId
                  ? 'Raid alerts and other safety notices are posted here. Keep it to moderators.'
                  : 'Choose a channel to get raid alerts. Keep it to moderators.'}
              </p>
              <Switch
                label="Raid alerts"
                description="Alert the safety channel when many accounts join in a short time."
                checked={s.raidAlerts}
                disabled={busy === 'raid'}
                onChange={(on) => void change('raid', { raidAlerts: on })}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
