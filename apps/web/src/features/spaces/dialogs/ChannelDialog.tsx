import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, Hash, MessagesSquare, Minus, Plus, Podcast, Trash2, Volume2, X } from 'lucide-react';
import {
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
  MAX_VOICE_CHANNEL_PARTICIPANTS,
  SLOWMODE_OPTIONS,
  VOICE_DEFAULT_BITRATE,
  VOICE_MAX_BITRATE,
  VOICE_MIN_BITRATE,
  normalizeTextChannelName,
  userDisplayName,
  type ChatSummary,
  type ID,
  type PermissionOverwrite,
  type SpaceInvite,
  type UpdateSpaceChannelRequest,
} from '@enbox/shared';
import { Button, DropdownMenu, EmptyState, Field, Input, Modal, Spinner, Switch, Tabs, Textarea, confirm, toast } from '@/components/ui';
import { ForumSettingsSection } from '@/features/forums/ForumSettingsSection';
import { shownInviteUrl, useHideInvites } from '@/features/groups/shared/share';
import { cn } from '@/lib/cn';
import { useSpace } from '@/stores/spaces';
import { useUser, useUsers } from '@/stores/users';
import {
  createChannel,
  deleteChannel,
  listInvites,
  revokeInvite,
  setChannelOverwrite,
  syncChannel,
  updateChannel,
} from '../actions';
import { PERMISSION_GROUPS } from '../permissionLabels';

/** Discord's slowmode steps: Off, 5s … 6h. */
export function slowmodeLabel(s: number): string {
  if (s === 0) return 'Off';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${s / 60}m`;
  return `${s / 3600}h`;
}

type ChannelTab = 'overview' | 'forum' | 'permissions' | 'invites';

/**
 * Create (no `chat`) or edit a channel. Editing has Discord's tabs: Overview (name, topic,
 * slowmode, age restriction; voice: user limit and bitrate; Delete Channel), Forum (forums:
 * guidelines, tags and post options), Permissions (overwrites) and Invites (this channel's,
 * revocable).
 */
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
  const [tab, setTab] = useState<ChannelTab>('overview');
  const title = chat ? `${chat.type === 'space_voice' || chat.type === 'space_stage' ? '' : '#'}${chat.name}` : 'Create Channel';
  return (
    <Modal open onClose={onClose} size="lg" title={title}>
      {chat ? (
        <Tabs
          value={tab}
          onChange={setTab}
          aria-label="Channel settings"
          items={[
            { value: 'overview', label: 'Overview' },
            ...(chat.type === 'space_forum' ? [{ value: 'forum' as const, label: 'Forum' }] : []),
            { value: 'permissions', label: 'Permissions' },
            { value: 'invites', label: 'Invites' },
          ]}
          className="mb-4"
        />
      ) : null}
      {tab === 'overview' || !chat ? (
        <Overview spaceId={spaceId} chat={chat} categoryId={categoryId ?? null} onClose={onClose} />
      ) : tab === 'forum' ? (
        <ForumSettingsSection spaceId={spaceId} chat={chat} />
      ) : tab === 'permissions' ? (
        <Permissions spaceId={spaceId} chat={chat} />
      ) : (
        <ChannelInvites spaceId={spaceId} chat={chat} />
      )}
    </Modal>
  );
}

function Overview({ spaceId, chat, categoryId, onClose }: { spaceId: ID; chat?: ChatSummary; categoryId: ID | null; onClose: () => void }) {
  const space = useSpace(spaceId);
  const navigate = useNavigate();
  const [type, setType] = useState<'space_text' | 'space_voice' | 'space_forum' | 'space_stage'>(
    chat ? (chat.type as 'space_text') : 'space_text',
  );
  const [name, setName] = useState(chat?.name ?? '');
  const [topic, setTopic] = useState(chat?.space?.topic ?? '');
  const [slowmode, setSlowmode] = useState(chat?.space?.slowmodeSeconds ?? 0);
  const [nsfw, setNsfw] = useState(chat?.space?.nsfw ?? false);
  const [userLimit, setUserLimit] = useState(chat?.space?.userLimit ?? 0);
  const initialBitrate = chat?.space?.bitrate ?? VOICE_DEFAULT_BITRATE;
  const [bitrate, setBitrate] = useState(initialBitrate);
  const [cat, setCat] = useState<ID | null>(chat?.space?.categoryId ?? categoryId);
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  // Forums are named like text channels; Stages are voice channels with a topic.
  const stage = type === 'space_stage';
  const voice = type === 'space_voice' || stage;
  const shown = voice ? name.trim() : normalizeTextChannelName(name);
  const forum = type === 'space_forum';

  const save = async () => {
    if (!shown) return;
    setBusy(true);
    try {
      if (chat) {
        const body: UpdateSpaceChannelRequest = { name: shown, nsfw };
        if (voice) {
          body.userLimit = userLimit || null;
          if (bitrate !== initialBitrate) body.bitrate = bitrate;
          if (stage) body.topic = topic.trim() || null;
        } else {
          // Forums keep their guidelines in the Forum tab.
          if (!forum) body.topic = topic.trim() || null;
          body.slowmodeSeconds = slowmode as 0;
        }
        await updateChannel(spaceId, chat.id, body);
      } else {
        await createChannel(spaceId, {
          type,
          name: shown,
          categoryId: cat,
          ...(type === 'space_text' || stage ? { topic: topic.trim() || undefined } : {}),
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

  const remove = async () => {
    if (!chat) return;
    const ok = await confirm({
      title: `Delete ${voice ? '' : '#'}${chat.name}?`,
      message: 'Its messages are deleted for everyone. This cannot be undone.',
      confirmLabel: 'Delete Channel',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChannel(spaceId, chat.id);
      onClose();
      navigate(`/spaces/${spaceId}`, { replace: true });
    } catch (e) {
      toast.error(e);
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
              { v: 'space_forum', icon: MessagesSquare, title: 'Forum', sub: 'Organized posts, each with its own replies' },
              { v: 'space_stage', icon: Podcast, title: 'Stage', sub: 'Speakers talk while an audience listens' },
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
      <Field label="Channel name" htmlFor="ch-name" hint={!voice && name && shown !== name ? `Will be #${shown}` : undefined}>
        <Input id="ch-name" value={name} maxLength={CHANNEL_NAME_MAX_LENGTH} placeholder={stage ? 'Town Hall' : voice ? 'Lounge' : forum ? 'new-forum' : 'new-channel'} onChange={(e) => setName(e.target.value)} autoFocus data-testid="channel-name" />
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
      {type === 'space_text' || stage ? (
        <Field label={stage ? 'Stage topic' : 'Channel topic'} htmlFor="ch-topic">
          <Textarea id="ch-topic" value={topic} maxLength={CHANNEL_TOPIC_MAX_LENGTH} rows={2} placeholder={stage ? 'What is the Stage about?' : 'Let everyone know how to use this channel'} onChange={(e) => setTopic(e.target.value)} />
        </Field>
      ) : null}
      {chat && !voice ? (
        <Field
          label={`Slowmode: ${slowmodeLabel(slowmode)}`}
          htmlFor="ch-slow"
          hint={
            forum
              ? 'Members can create one post per interval. Moderators are exempt.'
              : 'Members can send one message per interval. Moderators are exempt.'
          }
        >
          <input
            id="ch-slow"
            type="range"
            min={0}
            max={SLOWMODE_OPTIONS.length - 1}
            value={Math.max(0, SLOWMODE_OPTIONS.indexOf(slowmode as (typeof SLOWMODE_OPTIONS)[number]))}
            aria-valuetext={slowmodeLabel(slowmode)}
            onChange={(e) => setSlowmode(SLOWMODE_OPTIONS[Number(e.target.value)] ?? 0)}
            className="w-full accent-[var(--color-brand)]"
          />
          <div aria-hidden className="mt-1 hidden justify-between text-[11px] text-subtle sm:flex">
            {SLOWMODE_OPTIONS.map((s) => (
              <span key={s}>{slowmodeLabel(s)}</span>
            ))}
          </div>
        </Field>
      ) : null}
      {chat ? (
        <Switch checked={nsfw} onChange={setNsfw} label="Age-Restricted Channel" description="Members confirm they are over 18 before viewing its content." />
      ) : null}
      {chat && voice ? (
        <>
          <Field label={`Bitrate: ${Math.round(bitrate / 1000)}kbps`} htmlFor="ch-bitrate" hint="Higher sounds better but needs more bandwidth. Keep it at 64kbps or lower for people on slow connections.">
            <input
              id="ch-bitrate"
              type="range"
              min={VOICE_MIN_BITRATE / 1000}
              max={VOICE_MAX_BITRATE / 1000}
              step={1}
              value={Math.round(bitrate / 1000)}
              aria-valuetext={`${Math.round(bitrate / 1000)} kilobits per second`}
              onChange={(e) => setBitrate(Number(e.target.value) * 1000)}
              className="w-full accent-[var(--color-brand)]"
            />
            <div aria-hidden className="mt-1 flex justify-between text-[11px] text-subtle">
              <span>{VOICE_MIN_BITRATE / 1000}kbps</span>
              <span>{VOICE_DEFAULT_BITRATE / 1000}kbps</span>
              <span>{VOICE_MAX_BITRATE / 1000}kbps</span>
            </div>
          </Field>
          <Field label={`User limit: ${userLimit ? `${userLimit} users` : 'No limit'}`} htmlFor="ch-limit" hint="How many people can join at once. Members who can move members are not limited.">
            <input
              id="ch-limit"
              type="range"
              min={0}
              max={MAX_VOICE_CHANNEL_PARTICIPANTS}
              value={userLimit}
              aria-valuetext={userLimit ? `${userLimit} users` : 'No limit'}
              onChange={(e) => setUserLimit(Number(e.target.value))}
              className="w-full accent-[var(--color-brand)]"
            />
            <div aria-hidden className="mt-1 flex justify-between text-[11px] text-subtle">
              <span>∞</span>
              <span>{MAX_VOICE_CHANNEL_PARTICIPANTS}</span>
            </div>
          </Field>
        </>
      ) : null}
      {!chat ? (
        <Switch checked={isPrivate} onChange={setPrivate} label="Private channel" description="Only you can see it until you add roles or members in its permissions." />
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {chat ? (
          <Button variant="ghost" type="button" leftIcon={Trash2} className="mr-auto text-danger" onClick={() => void remove()}>
            Delete Channel
          </Button>
        ) : null}
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!shown} data-testid="channel-save">
          {chat ? 'Save Changes' : 'Create Channel'}
        </Button>
      </div>
    </form>
  );
}

function InviteRow({ invite, onRevoke }: { invite: SpaceInvite; onRevoke: () => void }) {
  const inviter = useUser(invite.createdBy);
  const hideInvites = useHideInvites();
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px]">{shownInviteUrl(invite.code, hideInvites)}</p>
        <p className="text-[13px] text-muted">
          {inviter ? `${userDisplayName(inviter)} · ` : ''}
          {invite.uses}
          {invite.maxUses ? ` / ${invite.maxUses}` : ''} uses · {invite.expiresAt ? `expires ${new Date(invite.expiresAt).toLocaleString()}` : 'never expires'}
        </p>
      </div>
      <Button size="sm" variant="ghost" className="text-danger" onClick={onRevoke}>
        Revoke
      </Button>
    </div>
  );
}

/** The channel's live invites (MANAGE_CHANNELS here: everyone's; else mine). */
function ChannelInvites({ spaceId, chat }: { spaceId: ID; chat: ChatSummary }) {
  const [list, setList] = useState<SpaceInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    listInvites(spaceId, chat.id)
      .then((l) => {
        setList(l);
        void useUsers
          .getState()
          .fetchUsers(l.map((i) => i.createdBy).filter((x): x is string => !!x))
          .catch(() => undefined);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [spaceId, chat.id]);
  useEffect(() => load(), [load]);
  if (error) return <p className="text-danger">{error}</p>;
  if (!list) return <Spinner />;
  if (list.length === 0)
    return <EmptyState title="No invites yet" description="Invites created from this channel's menu → Invite People land here." />;
  return (
    <div className="card-inset flex flex-col p-1">
      {list.map((inv) => (
        <InviteRow
          key={inv.code}
          invite={inv}
          onRevoke={() =>
            void revokeInvite(spaceId, inv.code)
              .then(() => setList((l) => l?.filter((x) => x.code !== inv.code) ?? null))
              .catch((e: unknown) => toast.error(e))
          }
        />
      ))}
    </div>
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
  // Forums take the text channel permissions (SEND_MESSAGES creates posts).
  const groups = PERMISSION_GROUPS.filter((g) =>
    g.channel.includes(chat.type === 'space_voice' || chat.type === 'space_stage' ? 'space_voice' : 'space_text'),
  );
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
