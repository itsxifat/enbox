import { useCallback, useEffect, useState } from 'react';
import { Laptop, LogOut, MonitorSmartphone, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import type { SessionInfo } from '@enbox/shared';
import { Button, EmptyState, ListItemSkeleton, confirm, toast } from '@/components/ui';
import { useBus } from '@/hooks/useBus';
import { api, errorMessage } from '@/lib/api';
import { formatRelativeShort, formatShortDate } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { SettingsGroup, SettingsHero, SettingsNote, SettingsScroller } from './ui';

function deviceIcon(s: SessionInfo) {
  const text = `${s.deviceName} ${s.userAgent ?? ''}`;
  if (/iPad|Tablet/i.test(text)) return Tablet;
  if (/Android|iPhone|iOS|Mobile/i.test(text)) return Smartphone;
  return Laptop;
}

function lastActive(s: SessionInfo): string {
  if (s.current) return 'Active now';
  const when = formatRelativeShort(s.lastActiveAt);
  return `Last active ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}

/** Settings → Linked devices: every session of my account; revoke one or all others. */
export function DevicesPage() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await api.get<SessionInfo[]>('/api/auth/sessions'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBus('realtime:ready', () => void load());

  const revoke = async (s: SessionInfo) => {
    if (s.current) {
      const ok = await confirm({
        title: 'Log out of this device?',
        confirmLabel: 'Log out',
        danger: true,
      });
      if (ok) await useAuth.getState().logout();
      return;
    }
    const ok = await confirm({
      title: `Log out ${s.deviceName}?`,
      message: 'That device will need your password to use Enbox again.',
      confirmLabel: 'Log out',
      danger: true,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await api.delete(`/api/auth/sessions/${s.id}`);
      setSessions((list) => list?.filter((x) => x.id !== s.id) ?? null);
      toast.success('Device logged out');
    } catch (e) {
      toast.error(e);
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    const ok = await confirm({
      title: 'Log out all other devices?',
      message: 'Every device except this one will be logged out.',
      confirmLabel: 'Log out all',
      danger: true,
    });
    if (!ok) return;
    setBusyAll(true);
    try {
      await api.delete('/api/auth/sessions');
      setSessions((list) => list?.filter((x) => x.current) ?? null);
      toast.success('All other devices were logged out');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyAll(false);
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <SettingsScroller>
      <SettingsHero icon={MonitorSmartphone} title="Use Enbox on other devices">
        Log in with your username and password on another phone, tablet or computer. Your chats stay
        in sync everywhere.
      </SettingsHero>

      {error && !sessions ? (
        <EmptyState
          compact
          title="Couldn't load your devices"
          description={error}
          action={
            <Button variant="soft" leftIcon={RefreshCw} onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <SettingsGroup
          title={sessions ? `Active sessions (${sessions.length})` : 'Active sessions'}
          footer="Tap a device to log it out. Changing your password also logs out every other device."
        >
          {!sessions ? (
            <ListItemSkeleton count={2} />
          ) : (
            <ul aria-label="Linked devices" data-testid="sessions-list">
              {sessions.map((s) => {
                const Icon = deviceIcon(s);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => void revoke(s)}
                      disabled={busyId === s.id}
                      className="flex w-full items-center gap-4 px-4 py-3 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:opacity-50 lg:px-5"
                      aria-label={`${s.deviceName}${s.current ? ' (this device)' : ''}. ${lastActive(s)}. Log out`}
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                        <Icon size={22} aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[16px] text-fg">{s.deviceName}</span>
                          {s.current ? (
                            <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                              This device
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate text-[13.5px] text-muted">
                          {lastActive(s)}
                          {s.ip ? ` · ${s.ip}` : ''}
                        </span>
                        <span className="truncate text-[12.5px] text-subtle">
                          Linked {formatShortDate(s.createdAt)}
                        </span>
                      </span>
                      <LogOut size={18} className="shrink-0 text-subtle" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsGroup>
      )}

      {others > 0 ? (
        <div className="px-4 pt-2 lg:px-0 lg:pt-0">
          <Button
            variant="outline"
            fullWidth
            leftIcon={LogOut}
            loading={busyAll}
            onClick={() => void revokeOthers()}
            className="text-danger"
          >
            Log out all other devices
          </Button>
        </div>
      ) : sessions ? (
        <SettingsNote>This is the only device logged in to your account.</SettingsNote>
      ) : null}
    </SettingsScroller>
  );
}
