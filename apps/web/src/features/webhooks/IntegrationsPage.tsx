/**
 * Space Settings ▸ Integrations (MANAGE_WEBHOOKS; docs/design/discord-parity.md W10-E, W10-F).
 *
 * Webhooks: "New Webhook" adds one to the first text channel I manage webhooks in, under a
 * friendly default name, and opens its card. Cards are grouped by channel (sidebar order)
 * and show the avatar, name, channel, creator and date; expanding one edits it — avatar,
 * name, channel — with Save / Reset. Its secret URL can be copied right after it was created
 * or regenerated (the server keeps only a hash, so it can't be shown again later); otherwise
 * "Regenerate URL", behind a warning that the old one stops working. Delete asks first.
 * Follower webhooks are listed under Channels Followed (features/announcements), not here.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  PERM,
  WEBHOOK_NAME_MAX_LENGTH,
  hasPerm,
  userDisplayName,
  type ChatSummary,
  type ID,
  type Space,
  type UpdateWebhookRequest,
  type Webhook,
} from '@enbox/shared';
import { Avatar, Button, Field, Input, Spinner, confirm, toast } from '@/components/ui';
import { FollowedChannels } from '@/features/announcements/FollowedChannels';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { copyText } from '@/features/groups/shared/share';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { channelBitsFor, useSpaceChannels } from '@/stores/spaces';
import { useUser, useUsers } from '@/stores/users';
import {
  createWebhook,
  defaultWebhookName,
  deleteWebhook,
  listSpaceWebhooks,
  regenerateWebhookUrl,
  updateWebhook,
} from './actions';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Failed to load');

const createdOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function IntegrationsPage({ space }: { space: Space }) {
  const me = useAuth((s) => s.user?.id);
  const channels = useSpaceChannels(space.id);
  const textChannels = useMemo(() => channels.filter((c) => c.type === 'space_text'), [channels]);
  // Where I may add or move webhooks: text channels where my bits hold MANAGE_WEBHOOKS.
  const manageable = useMemo(
    () =>
      me
        ? textChannels.filter((c) => hasPerm(channelBitsFor(space, c, me), PERM.MANAGE_WEBHOOKS))
        : [],
    [textChannels, space, me],
  );
  const [list, setList] = useState<Webhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Secret URLs known this session (just created or regenerated). */
  const [urls, setUrls] = useState<Record<ID, string>>({});
  const [open, setOpen] = useState<ID | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    listSpaceWebhooks(space.id).then(
      (l) => live && setList(l),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [space.id]);

  useEffect(() => {
    const ids = (list ?? []).map((w) => w.createdBy).filter((x): x is string => !!x);
    if (ids.length)
      void useUsers
        .getState()
        .fetchUsers(ids)
        .catch(() => undefined);
  }, [list]);

  const incoming = useMemo(() => (list ?? []).filter((w) => w.kind === 'incoming'), [list]);
  const groups = useMemo(() => {
    const byChannel = new Map<ID, Webhook[]>();
    for (const w of incoming)
      byChannel.set(w.channelId, [...(byChannel.get(w.channelId) ?? []), w]);
    const ordered = textChannels.filter((c) => byChannel.has(c.id));
    const known = new Set(ordered.map((c) => c.id));
    const rest = [...byChannel.keys()].filter((id) => !known.has(id));
    return [
      ...ordered.map((c) => ({
        channelId: c.id,
        name: c.name ?? 'channel',
        hooks: byChannel.get(c.id)!,
      })),
      ...rest.map((id) => ({ channelId: id, name: 'unknown-channel', hooks: byChannel.get(id)! })),
    ];
  }, [incoming, textChannels]);

  const add = async () => {
    const channel = manageable[0];
    if (!channel) return;
    setCreating(true);
    try {
      const { url, ...hook } = await createWebhook(channel.id, {
        name: defaultWebhookName(incoming.map((w) => w.name)),
      });
      setList((l) => [...(l ?? []), hook]);
      setUrls((u) => ({ ...u, [hook.id]: url }));
      setOpen(hook.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-10" data-testid="integrations-page">
      <section className="flex flex-col gap-4" aria-labelledby="integrations-webhooks">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="integrations-webhooks" className="text-[16px] font-bold">
              Webhooks
            </h3>
            <p className="mt-1 text-[14px] text-muted">
              Webhooks let other apps and services post messages and rich embeds into your text
              channels. Each one has a secret URL: anyone who has it can post, so keep it safe.
            </p>
          </div>
          <Button
            leftIcon={Plus}
            onClick={() => void add()}
            loading={creating}
            disabled={!list || manageable.length === 0}
          >
            New Webhook
          </Button>
        </div>
        {error ? (
          <p className="text-danger">{error}</p>
        ) : !list ? (
          <Spinner />
        ) : incoming.length === 0 ? (
          <p className="card-inset p-6 text-center text-[14px] text-muted">
            {manageable.length
              ? 'No webhooks yet. Create one to start posting from another app.'
              : 'Webhooks post in text channels. Create a text channel first.'}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.channelId} className="flex flex-col gap-2" data-testid="webhook-group">
              <h4 className="section-label">#{g.name}</h4>
              <ul className="flex flex-col gap-2">
                {g.hooks.map((hook) => (
                  <WebhookCard
                    key={hook.id}
                    hook={hook}
                    channelName={g.name}
                    url={urls[hook.id] ?? null}
                    open={open === hook.id}
                    onToggle={() => setOpen(open === hook.id ? null : hook.id)}
                    channels={manageable}
                    onSaved={(next) =>
                      setList((l) => (l ?? []).map((w) => (w.id === next.id ? next : w)))
                    }
                    onUrl={(url) => setUrls((u) => ({ ...u, [hook.id]: url }))}
                    onDeleted={() => {
                      setList((l) => (l ?? []).filter((w) => w.id !== hook.id));
                      if (open === hook.id) setOpen(null);
                    }}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="integrations-followed">
        <div>
          <h3 id="integrations-followed" className="text-[16px] font-bold">
            Channels Followed
          </h3>
          <p className="mt-1 text-[14px] text-muted">
            Announcement channels from other Spaces that publish into this one.
          </p>
        </div>
        <FollowedChannels space={space} />
      </section>
    </div>
  );
}

function Creator({ userId }: { userId: ID | null }) {
  const user = useUser(userId);
  if (!userId) return null;
  return <> by {userDisplayName(user)}</>;
}

interface CardProps {
  hook: Webhook;
  channelName: string;
  url: string | null;
  open: boolean;
  onToggle: () => void;
  /** Channels it may move to. */
  channels: ChatSummary[];
  onSaved: (hook: Webhook) => void;
  onUrl: (url: string) => void;
  onDeleted: () => void;
}

function WebhookCard({ hook, channelName, url, open, onToggle, ...rest }: CardProps) {
  const panelId = `webhook-panel-${hook.id}`;
  return (
    <li className="card-inset overflow-hidden" data-testid="webhook-card" data-webhook-id={hook.id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <Avatar src={hook.avatarUrl} name={hook.name} colorSeed={hook.id} size={40} decorative />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{hook.name}</span>
          <span className="block truncate text-[13px] text-muted">
            #{channelName} · Created on {createdOn(hook.createdAt)}
            <Creator userId={hook.createdBy} />
          </span>
        </span>
        <ChevronDown
          size={20}
          aria-hidden
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div id={panelId} className="px-4 pt-1 pb-4">
          <WebhookEditor key={hook.id} hook={hook} channelName={channelName} url={url} {...rest} />
        </div>
      ) : null}
    </li>
  );
}

/** The expanded card: avatar, name and channel (staged until Save), URL, Delete. */
function WebhookEditor({
  hook,
  channelName,
  url,
  channels,
  onSaved,
  onUrl,
  onDeleted,
}: Omit<CardProps, 'open' | 'onToggle'>) {
  const [name, setName] = useState(hook.name);
  const [channelId, setChannelId] = useState(hook.channelId);
  /** A new avatar (`id` null removes it); undefined = unchanged. */
  const [avatar, setAvatar] = useState<{ id: ID | null; url: string | null } | undefined>();
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const dirty = trimmed !== hook.name || channelId !== hook.channelId || avatar !== undefined;
  const shownAvatar = avatar !== undefined ? avatar.url : hook.avatarUrl;
  // The current channel is always listed, even where I couldn't move it back to.
  const options = channels.some((c) => c.id === hook.channelId)
    ? channels
    : [{ id: hook.channelId, name: channelName } as ChatSummary, ...channels];

  const reset = () => {
    setName(hook.name);
    setChannelId(hook.channelId);
    setAvatar(undefined);
  };

  const save = async () => {
    const body: UpdateWebhookRequest = {};
    if (trimmed !== hook.name) body.name = trimmed;
    if (channelId !== hook.channelId) body.channelId = channelId;
    if (avatar !== undefined) body.avatarMediaId = avatar.id;
    setBusy(true);
    try {
      const next = await updateWebhook(hook.id, body);
      setAvatar(undefined);
      setName(next.name);
      setChannelId(next.channelId);
      onSaved(next);
      toast.success('Webhook saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (url && (await copyText(url))) toast.success('Webhook URL copied', { id: 'copied' });
    else toast.error("Couldn't copy to the clipboard");
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: 'Regenerate Webhook URL',
      message: `The current URL of “${hook.name}” stops working right away: anything that posts with it will need the new one.`,
      confirmLabel: 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      onUrl((await regenerateWebhookUrl(hook.id)).url);
      toast.success('New webhook URL ready to copy');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete Webhook',
      message: `“${hook.name}” will be deleted and its URL will stop working. Messages it already posted stay.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteWebhook(hook.id);
      onDeleted();
      toast.success('Webhook deleted');
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="webhook-editor">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-col items-center gap-1.5">
          <EditableAvatar
            src={shownAvatar}
            name={trimmed || hook.name}
            colorSeed={hook.id}
            kind="user"
            size={80}
            label="Change webhook avatar"
            onUploaded={(m) =>
              setAvatar({ id: m.id, url: m.animated && m.thumbnailUrl ? m.thumbnailUrl : m.url })
            }
            onRemove={shownAvatar ? () => setAvatar({ id: null, url: null }) : undefined}
          />
          <span className="text-[12px] text-muted">Minimum 128×128</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Field
            label="Name"
            htmlFor={`wh-name-${hook.id}`}
            error={trimmed ? undefined : 'A webhook needs a name'}
          >
            <Input
              id={`wh-name-${hook.id}`}
              value={name}
              maxLength={WEBHOOK_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Channel" htmlFor={`wh-channel-${hook.id}`}>
            <select
              id={`wh-channel-${hook.id}`}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="h-11 w-full rounded-xl bg-surface-2 px-3"
            >
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name ?? 'channel'}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {url ? (
            <Button size="sm" leftIcon={Copy} onClick={() => void copyUrl()} disabled={busy}>
              Copy Webhook URL
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={RefreshCw}
              onClick={() => void regenerate()}
              disabled={busy}
            >
              Regenerate URL
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            leftIcon={Trash2}
            className="text-danger"
            onClick={() => void remove()}
            disabled={busy}
          >
            Delete Webhook
          </Button>
        </div>
        <p className="text-[12px] text-muted">
          {url
            ? 'Copy the URL now: for your safety it is shown only once.'
            : 'The URL was shown when it was made. Regenerate it to get a new one; the old one stops working.'}
        </p>
      </div>

      {dirty ? (
        <div
          className="flex flex-wrap items-center justify-end gap-2 rounded-xl bg-elevated px-3 py-2 shadow-elevated"
          role="status"
        >
          <span className="mr-auto text-[13px]">Careful — you have unsaved changes!</span>
          <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
            Reset
          </Button>
          <Button size="sm" onClick={() => void save()} loading={busy} disabled={!trimmed}>
            Save Changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
