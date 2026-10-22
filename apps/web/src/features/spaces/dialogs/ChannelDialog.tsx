import { useMemo, useState } from 'react';
import { Check, Hash, Minus, Plus, Volume2, X } from 'lucide-react';
import {
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
  SLOWMODE_OPTIONS,
  normalizeTextChannelName,
  type ChatSummary,
  type ID,
  type PermissionOverwrite,
} from '@enbox/shared';
import { Button, DropdownMenu, Field, Input, Modal, Switch, Tabs, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useSpace } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { createChannel, setChannelOverwrite, syncChannel, updateChannel } from '../actions';
import { PERMISSION_GROUPS } from '../permissionLabels';

function slowmodeLabel(s: number): string {
  if (s === 0) return 'Off';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${s / 60}m`;
  return `${s / 3600}h`;
}

/** Create (no `chat`) or edit a channel. Editing has a Permissions tab (overwrites). */
export function ChannelDialog({
  spaceId,
  chat,
  categoryId,
  onClose,
}: {
  spaceId: ID;
  chat?: ChatSummary;
  categoryId?: ID | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  return (
    <Modal open onClose={onClose} size="lg" title={chat ? `#${chat.name}` : 'Create channel'}>
      {chat ? (
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as 'overview' | 'permissions')}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'permissions', label: 'Permissions' },
          ]}
          className="mb-4"
        />
      ) : null}
      {tab === 'overview' || !chat ? (
        <Overview spaceId={spaceId} chat={chat} categoryId={categoryId ?? null} onClose={onClose} />
      ) : (
        <Permissions spaceId={spaceId} chat={chat} />
      )}
    </Modal>
  );
}

function Overview({ spaceId, chat, categoryId, onClose }: { spaceId: ID; chat?: ChatSummary; categoryId: ID | null; onClose: () => void }) {
  const space = useSpace(spaceId);
  const [type, setType] = useState<'space_text' | 'space_voice'>(chat ? (chat.type as 'space_text') : 'space_text');
  const [name, setName] = useState(chat?.name ?? '');
  const [topic, setTopic] = useState(chat?.space?.topic ?? '');
  const [slowmode, setSlowmode] = useState(chat?.space?.slowmodeSeconds ?? 0);
  const [nsfw, setNsfw] = useState(chat?.space?.nsfw ?? false);
  const [userLimit, setUserLimit] = useState(chat?.space?.userLimit ?? 0);
  const [cat, setCat] = useState<ID | null>(chat?.space?.categoryId ?? categoryId);
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = type === 'space_text' ? normalizeTextChannelName(name) : name.trim();

  const save = async () => {
    if (!shown) return;
    setBusy(true);
    try {
      if (chat) {
        await updateChannel(spaceId, chat.id, {
          name: shown,
          ...(type === 'space_text' ? { topic: topic.trim() || null, slowmodeSeconds: slowmode as 0, nsfw } : { userLimit: userLimit || null }),
        });
      } else {
        await createChannel(spaceId, {
          type,
          name: shown,
          categoryId: cat,
          ...(type === 'space_text' ? { topic: topic.trim() || undefined } : {}),
          privateRoleIds: isPrivate ? [] : undefined,
        });
      }
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
    >
      {!chat ? (
        <div role="radiogroup" aria-label="Channel type" className="flex flex-col gap-2">
          {(
            [
              { v: 'space_text', icon: Hash, title: 'Text', sub: 'Messages, images, links, polls' },
              { v: 'space_voice', icon: Volume2, title: 'Voice', sub: 'Talk, video and screen share' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={type === o.v}
              onClick={() => setType(o.v)}
              className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors', type === o.v ? 'bg-selected' : 'bg-surface-2 hover:bg-hover')}
            >
              <o.icon size={22} className="text-muted" aria-hidden />
              <span className="flex-1">
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-[13px] text-muted">{o.sub}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <Field label="Channel name" htmlFor="ch-name" hint={type === 'space_text' && name && shown !== name ? `Will be #${shown}` : undefined}>
        <Input id="ch-name" value={name} maxLength={CHANNEL_NAME_MAX_LENGTH} placeholder={type === 'space_text' ? 'new-channel' : 'Lounge'} onChange={(e) => setName(e.target.value)} autoFocus data-testid="channel-name" />
      </Field>
      {!chat && space && space.categories.length ? (
        <Field label="Category" htmlFor="ch-cat">
          <select id="ch-cat" value={cat ?? ''} onChange={(e) => setCat(e.target.value || null)} className="h-11 w-full rounded-xl bg-surface-2 px-3">
            <option value="">No category</option>
            {[...space.categories].sort((a, b) => a.position - b.position).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {type === 'space_text' ? (
        <Field label="Topic" htmlFor="ch-topic">
          <Textarea id="ch-topic" value={topic} maxLength={CHANNEL_TOPIC_MAX_LENGTH} rows={2} placeholder="Let everyone know how to use this channel" onChange={(e) => setTopic(e.target.value)} />
        </Field>
      ) : null}
      {chat && type === 'space_text' ? (
        <>
          <Field label={`Slowmode: ${slowmodeLabel(slowmode)}`} htmlFor="ch-slow" hint="Members wait this long between messages. Moderators are exempt.">
            <input
              id="ch-slow"
              type="range"
              min={0}
              max={SLOWMODE_OPTIONS.length - 1}
              value={SLOWMODE_OPTIONS.indexOf(slowmode as (typeof SLOWMODE_OPTIONS)[number])}
              onChange={(e) => setSlowmode(SLOWMODE_OPTIONS[Number(e.target.value)] ?? 0)}
              className="w-full accent-[var(--color-brand)]"
            />
          </Field>
          <Switch checked={nsfw} onChange={setNsfw} label="Age-restricted channel" description="Members confirm they are 18+ before viewing it." />
        </>
      ) : null}
      {chat && type === 'space_voice' ? (
        <Field label={`User limit: ${userLimit ? userLimit : 'none'}`} htmlFor="ch-limit">
          <input id="ch-limit" type="range" min={0} max={99} value={userLimit} onChange={(e) => setUserLimit(Number(e.target.value))} className="w-full accent-[var(--color-brand)]" />
        </Field>
      ) : null}
      {!chat ? (
        <Switch checked={isPrivate} onChange={setPrivate} label="Private channel" description="Only you can see it until you add roles or members in its permissions." />
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!shown} data-testid="channel-save">
          {chat ? 'Save changes' : 'Create channel'}
        </Button>
      </div>
    </form>
  );
}

type Tri = 'allow' | 'neutral' | 'deny';

function TriState({ value, onChange, label }: { value: Tri; onChange: (v: Tri) => void; label: string }) {
  const btn = (v: Tri, Icon: typeof Check, tone: string) => (
    <button
      type="button"
      aria-label={`${label}: ${v}`}
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={cn('flex size-8 items-center justify-center rounded-lg transition-colors', value === v ? tone : 'text-muted hover:bg-hover')}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg bg-surface-2">
      {btn('deny', X, 'bg-danger text-on-brand')}
      {btn('neutral', Minus, 'bg-line-strong text-fg')}
      {btn('allow', Check, 'bg-success text-on-brand')}
    </div>
  );
}

function Permissions({ spaceId, chat }: { spaceId: ID; chat: ChatSummary }) {
  const space = useSpace(spaceId);
  const users = useUsers((s) => s.byId);
  const overwrites = chat.space?.overwrites;
  const everyoneId = space?.roles.find((r) => r.isDefault)?.id;
  const [selected, setSelected] = useState<string | null>(everyoneId ? `role:${everyoneId}` : null);
  const [draft, setDraft] = useState<Record<string, PermissionOverwrite>>({});
  const [busy, setBusy] = useState(false);

  const targets = useMemo(() => {
    const out = new Map<string, PermissionOverwrite>();
    if (everyoneId) out.set(`role:${everyoneId}`, { targetType: 'role', targetId: everyoneId, allow: 0, deny: 0 });
    for (const o of overwrites ?? []) out.set(`${o.targetType}:${o.targetId}`, o);
    for (const [k, o] of Object.entries(draft)) out.set(k, o);
    return out;
  }, [overwrites, everyoneId, draft]);

  if (!space) return null;
  const roleName = (id: string) => space.roles.find((r) => r.id === id)?.name ?? 'Role';
  const labelOf = (o: PermissionOverwrite) =>
    o.targetType === 'role' ? roleName(o.targetId) : (users[o.targetId]?.displayName ?? 'Member');
  const current = selected ? targets.get(selected) : undefined;
  const groups = PERMISSION_GROUPS.filter((g) => g.channel.includes(chat.type as 'space_text'));
  const valueOf = (bit: number): Tri =>
    !current ? 'neutral' : current.allow & bit ? 'allow' : current.deny & bit ? 'deny' : 'neutral';
  const set = (bit: number, v: Tri) => {
    if (!current || !selected) return;
    const next = {
      ...current,
      allow: v === 'allow' ? current.allow | bit : current.allow & ~bit,
      deny: v === 'deny' ? current.deny | bit : current.deny & ~bit,
    };
    setDraft((d) => ({ ...d, [selected]: next }));
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const o of Object.values(draft)) {
        const empty = o.allow === 0 && o.deny === 0;
        await setChannelOverwrite(spaceId, chat.id, { type: o.targetType, id: o.targetId }, empty ? null : { allow: o.allow, deny: o.deny });
      }
      setDraft({});
      toast.success('Permissions saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const addable = space.roles.filter((r) => !targets.has(`role:${r.id}`));

  return (
    <div className="flex flex-col gap-4">
      {chat.space?.categoryId ? (
        <div className="card-inset flex items-center gap-3 p-3 text-[14px]">
          <span className="flex-1 text-muted">
            {chat.space.permissionsSynced ? 'Synced with its category.' : 'Not synced with its category.'}
          </span>
          {!chat.space.permissionsSynced ? (
            <Button size="sm" variant="soft" onClick={() => void syncChannel(spaceId, chat.id).catch((e: unknown) => toast.error(e))}>
              Sync now
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 flex-col gap-1 sm:w-48">
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] font-bold tracking-wide text-muted uppercase">Roles / members</span>
            <DropdownMenu
              aria-label="Add a role"
              items={addable.map((r) => ({
                label: r.name,
                onSelect: () => {
                  const k = `role:${r.id}`;
                  setDraft((d) => ({ ...d, [k]: { targetType: 'role', targetId: r.id, allow: 0, deny: 0 } }));
                  setSelected(k);
                },
              }))}
              trigger={(p) => (
                <button type="button" {...p} aria-label="Add a role" className="rounded p-1 text-muted hover:text-fg" disabled={!addable.length}>
                  <Plus size={16} aria-hidden />
                </button>
              )}
            />
          </div>
          {[...targets.entries()].map(([k, o]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSelected(k)}
              className={cn('truncate rounded-lg px-3 py-2 text-left text-[14px]', selected === k ? 'bg-selected font-semibold' : 'hover:bg-hover')}
            >
              {labelOf(o)}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          {groups.map((g) => (
            <section key={g.title} className="mb-4">
              <h3 className="mb-1 text-[12px] font-bold tracking-wide text-muted uppercase">{g.title}</h3>
              {g.items.map((p) => (
                <div key={p.bit} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">{p.label}</div>
                    <div className="text-[13px] text-muted">{p.description}</div>
                  </div>
                  <TriState label={p.label} value={valueOf(p.bit)} onChange={(v) => set(p.bit, v)} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!Object.keys(draft).length} onClick={() => setDraft({})}>
          Reset
        </Button>
        <Button loading={busy} disabled={!Object.keys(draft).length} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
