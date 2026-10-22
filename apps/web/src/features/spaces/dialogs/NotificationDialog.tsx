import { useEffect, useMemo, useState } from 'react';
import { Folder, Hash, Volume2, X } from 'lucide-react';
import {
  SPACE_MUTE_DURATIONS,
  isMuted,
  type ChatSummary,
  type ID,
  type NotifyLevel,
  type Space,
} from '@enbox/shared';
import { Button, Checkbox, Field, IconButton, Modal, RadioGroup, Switch, toast } from '@/components/ui';
import { patchPrefs } from '@/features/chats/chatActions';
import { cn } from '@/lib/cn';
import { useSpaceChannels, useSpaces } from '@/stores/spaces';
import { setChannelsMuted, setChannelsNotifyLevel, updateMyMember } from '../actions';
import { NOTIFY_LABELS, groupsOf, muteUntilIso, mutedUntilText, overrideRows, type OverrideRow } from '../sidebar';

const LEVELS = ['all', 'mentions', 'none'] as const;

/**
 * Notification settings: for the whole Space (no `chat`; Discord's dialog with mute, level,
 * suppressions and per-channel / per-category overrides, applied as you change them) or for
 * one channel (`chat`: level and mute, saved together).
 */
export function NotificationDialog({ space, chat, onClose }: { space: Space; chat?: ChatSummary; onClose: () => void }) {
  return chat ? (
    <ChannelNotifications space={space} chat={chat} onClose={onClose} />
  ) : (
    <SpaceNotifications space={space} onClose={onClose} />
  );
}

/** Mute switch + "for how long" (Discord asks when muting). */
function MuteControl({
  label,
  mutedUntil,
  onChange,
}: {
  label: string;
  mutedUntil: string | null;
  onChange: (until: string | null) => void;
}) {
  const muted = isMuted(mutedUntil);
  const [duration, setDuration] = useState(0);
  return (
    <div className="flex flex-col">
      <Switch
        checked={muted}
        onChange={(on) => onChange(on ? muteUntilIso(SPACE_MUTE_DURATIONS[duration]!.ms) : null)}
        label={label}
        description={mutedUntilText(mutedUntil) ?? 'No notifications and no unread dot. Mentions of you still show a badge.'}
      />
      {!muted ? (
        <Field label="Mute for" htmlFor="mute-for">
          <select
            id="mute-for"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="h-11 w-full rounded-xl bg-surface-2 px-3"
          >
            {SPACE_MUTE_DURATIONS.map((d, i) => (
              <option key={d.label} value={i}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
  );
}

function SpaceNotifications({ space: initial, onClose }: { space: Space; onClose: () => void }) {
  // Live: the settings apply right away and the Space updates under the dialog.
  const space = useSpaces((s) => s.byId[initial.id]) ?? initial;
  const channels = useSpaceChannels(space.id);
  const loaded = useSpaces((s) => !!s.channelsLoaded[space.id]);
  const [added, setAdded] = useState<{ kind: 'channel' | 'category'; id: ID }[]>([]);
  useEffect(() => {
    if (!loaded)
      void useSpaces
        .getState()
        .loadSpace(space.id)
        .catch(() => undefined);
  }, [loaded, space.id]);

  const save = (body: Parameters<typeof updateMyMember>[1]) =>
    void updateMyMember(space.id, body).catch((e: unknown) => toast.error(e));
  const level: NotifyLevel = space.me.notifyLevel ?? space.defaultNotifyLevel;
  const rows = useMemo(() => overrideRows(space, channels, added), [space, channels, added]);
  const groups = useMemo(() => groupsOf(space, channels), [space, channels]);
  const listed = new Set(rows.flatMap((r) => [r.id, ...r.channels.map((c) => c.id)]));

  const add = (value: string) => {
    const [kind, id] = value.split(':') as ['channel' | 'category', ID];
    if (id) setAdded((a) => [...a.filter((x) => x.id !== id), { kind, id }]);
  };
  const clear = (row: OverrideRow) => {
    setAdded((a) => a.filter((x) => x.id !== row.id));
    void setChannelsNotifyLevel(row.channels, null);
    if (row.muted) void setChannelsMuted(row.channels, null);
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Notification Settings" description={space.name} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-5">
        <MuteControl label={`Mute ${space.name}`} mutedUntil={space.me.mutedUntil} onChange={(until) => save({ mutedUntil: until })} />
        <section>
          <h3 className="mb-1 text-[12px] font-bold tracking-wide text-muted uppercase">Space notification settings</h3>
          <RadioGroup
            name="space-notify-level"
            aria-label="Space notification settings"
            value={level}
            onChange={(v) => save({ notifyLevel: v })}
            options={LEVELS.map((l) => ({
              value: l,
              label: NOTIFY_LABELS[l],
              description: l === space.defaultNotifyLevel && !space.me.notifyLevel ? 'The Space’s default' : undefined,
            }))}
          />
        </section>
        <div className="card-inset flex flex-col px-3">
          <Switch
            checked={space.me.suppressEveryone}
            onChange={(v) => save({ suppressEveryone: v })}
            label="Suppress @everyone and @here"
            description="They won’t notify you or count as mentions."
          />
          <Switch
            checked={space.me.suppressRoles}
            onChange={(v) => save({ suppressRoles: v })}
            label="Suppress All Role @mentions"
            description="Mentions of your roles won’t notify you or count as mentions. Mentions of you still do."
          />
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">Notification overrides</h3>
          <select
            aria-label="Add a channel or category"
            value=""
            onChange={(e) => add(e.target.value)}
            className="h-11 w-full rounded-xl bg-surface-2 px-3"
          >
            <option value="">Select a channel or category…</option>
            {groups.map((g) => (
              <optgroup key={g.category?.id ?? 'none'} label={g.category?.name ?? 'No category'}>
                {g.category && !listed.has(g.category.id) ? (
                  <option value={`category:${g.category.id}`}>{g.category.name} (category)</option>
                ) : null}
                {g.channels
                  .filter((c) => !listed.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={`channel:${c.id}`}>
                      {c.type === 'space_voice' ? '' : '#'}
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {rows.length === 0 ? (
            <p className="text-[13px] text-muted">Channels and categories you set differently from the Space show up here.</p>
          ) : (
            <div className="card-inset flex flex-col p-1" role="list" aria-label="Notification overrides">
              {rows.map((r) => (
                <OverrideRowView key={`${r.kind}:${r.id}`} row={r} spaceLevel={level} onClear={() => clear(r)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function OverrideRowView({ row, spaceLevel, onClear }: { row: OverrideRow; spaceLevel: NotifyLevel; onClear: () => void }) {
  const Icon = row.kind === 'category' ? Folder : row.channels[0]?.type === 'space_voice' ? Volume2 : Hash;
  const choices: { value: NotifyLevel | null; label: string }[] = [
    { value: null, label: `Default (${NOTIFY_LABELS[spaceLevel]})` },
    ...LEVELS.map((l) => ({ value: l, label: NOTIFY_LABELS[l] })),
  ];
  return (
    <div role="listitem" className="flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center">
      <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
        <Icon size={16} className="shrink-0 text-muted" aria-hidden />
        <span className="truncate">{row.name}</span>
        {row.kind === 'category' ? <span className="text-[12px] text-muted">{row.channels.length} channels</span> : null}
      </span>
      <div className="flex items-center gap-3">
        <select
          aria-label={`Notifications for ${row.name}`}
          value={row.level ?? ''}
          onChange={(e) => void setChannelsNotifyLevel(row.channels, (e.target.value || null) as NotifyLevel | null)}
          className={cn('h-9 rounded-lg bg-surface-2 px-2 text-[13px]', row.level && 'font-semibold')}
        >
          {choices.map((c) => (
            <option key={c.value ?? 'default'} value={c.value ?? ''}>
              {c.label}
            </option>
          ))}
        </select>
        <Checkbox
          checked={row.muted}
          onChange={(on) => void setChannelsMuted(row.channels, on ? muteUntilIso(0) : null)}
          label="Mute"
        />
        <IconButton icon={X} label={`Remove override for ${row.name}`} variant="ghost" size="sm" onClick={onClear} />
      </div>
    </div>
  );
}

function ChannelNotifications({ space, chat, onClose }: { space: Space; chat: ChatSummary; onClose: () => void }) {
  const spaceDefault: NotifyLevel = space.me.notifyLevel ?? space.defaultNotifyLevel;
  const [level, setLevel] = useState<NotifyLevel | 'default'>(chat.notifyLevel ?? 'default');
  const [mutedUntil, setMutedUntil] = useState<string | null>(isMuted(chat.mutedUntil) ? chat.mutedUntil : null);
  const [busy, setBusy] = useState(false);
  const options = [
    { value: 'default' as const, label: `Use Space default (${NOTIFY_LABELS[spaceDefault]})` },
    ...LEVELS.map((l) => ({ value: l, label: NOTIFY_LABELS[l] })),
  ];
  const save = async () => {
    setBusy(true);
    const ok = await patchPrefs(chat, { notifyLevel: level === 'default' ? null : level, mutedUntil });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Notifications for ${chat.type === 'space_voice' ? '' : '#'}${chat.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <MuteControl label="Mute channel" mutedUntil={mutedUntil} onChange={setMutedUntil} />
        <RadioGroup name="notify-level" aria-label="Channel notifications" value={level} onChange={(v) => setLevel(v)} options={options} />
      </div>
    </Modal>
  );
}
