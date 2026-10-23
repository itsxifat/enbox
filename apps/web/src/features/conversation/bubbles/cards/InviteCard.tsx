/**
 * An invite link (`/join/<code>`, `/invite/<code>`) as Discord's invite card: "You've been
 * invited to join a Space", its icon, name, online and member counts, and Join — or Joined
 * (which opens it) when I'm in already. `GET /api/invites/:code` (a session cache; a reset,
 * expired or unknown code shows "Invalid invite"); Join is `POST /api/invites/:code/join`,
 * then the stores learn the new Space / chat and it opens, as from the invite page.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link2Off } from 'lucide-react';
import type { ID, InviteJoinResult, InvitePreview } from '@enbox/shared';
import { Avatar, Button, toast } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';
import { useSpaces } from '@/stores/spaces';
import { EmbedFrame, useGrowNotice, type RemoveEmbeds } from './EmbedFrame';
import type { InternalLink } from './internalLinks';

type InviteLink = Extract<InternalLink, { kind: 'invite' }>;
type Entry = { preview: InvitePreview } | { invalid: true };

const RETRY_AFTER_MS = 30_000;
const cache = new Map<string, Entry>();
const failedAt = new Map<string, number>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function load(code: string): void {
  if (cache.has(code) || pending.has(code)) return;
  const failed = failedAt.get(code);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return;
  pending.add(code);
  api
    .get<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`)
    .then(
      (preview) => cache.set(code, { preview }),
      (e: unknown) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 400 || e.status === 410))
          cache.set(code, { invalid: true });
        else failedAt.set(code, Date.now());
      },
    )
    .finally(() => {
      pending.delete(code);
      notify();
    });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests: forget every looked-up invite. */
export function resetInviteCards(): void {
  cache.clear();
  failedAt.clear();
  pending.clear();
}

function useInvite(code: string): Entry | undefined {
  const entry = useSyncExternalStore(subscribe, () => cache.get(code));
  useEffect(() => load(code), [code]);
  return entry;
}

/** Where a joined (or already joined) invite target opens. */
function targetPath(kind: InvitePreview['kind'], id: ID, channelId?: ID | null): string {
  if (kind === 'space') return channelId ? `/spaces/${id}/${channelId}` : `/spaces/${id}`;
  if (kind === 'channel') return `/updates/channels/${id}`;
  if (kind === 'community') return `/communities/${id}`;
  return `/chats/${id}`;
}

const NOUN: Record<InvitePreview['kind'], string> = {
  space: 'Space',
  group: 'group',
  community: 'community',
  channel: 'channel',
};

async function join(code: string, p: InvitePreview): Promise<void> {
  try {
    const r = await api.post<InviteJoinResult>(`/api/invites/${encodeURIComponent(code)}/join`);
    if (r.chat) useChats.getState().upsertChat(r.chat);
    if (r.community) useCommunities.getState().upsertCommunity(r.community);
    if (r.space) {
      useSpaces.getState().upsertSpace(r.space);
      void useSpaces.getState().loadSpace(r.space.id);
    }
    cache.set(code, { preview: { ...p, isMember: true, canJoin: false } });
    notify();
    toast.success(p.kind === 'channel' ? `You're following ${p.name}` : `You joined “${p.name}”`);
    bus.emit('navigate', { to: targetPath(r.kind, r.id, r.channelId) });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'conflict') {
      // Already in (joined on another device): just open it.
      bus.emit('navigate', { to: targetPath(p.kind, p.id) });
      return;
    }
    if (e instanceof ApiError && e.status === 404) {
      cache.set(code, { invalid: true });
      notify();
    }
    toast.error(e);
  }
}

function InviteIcon({ p }: { p: InvitePreview }) {
  const square = p.kind === 'space' || p.kind === 'community';
  return (
    <span
      className={cn(
        'flex size-12 shrink-0 overflow-hidden',
        square ? 'rounded-2xl' : 'rounded-full',
      )}
    >
      <Avatar
        src={p.avatarUrl}
        name={p.name}
        colorSeed={p.id}
        size={48}
        kind={p.kind === 'group' ? 'group' : p.kind === 'channel' ? 'channel' : 'community'}
        decorative
        className="rounded-none!"
      />
    </span>
  );
}

function Counts({ p }: { p: InvitePreview }) {
  const members = p.kind === 'channel' ? 'Followers' : 'Members';
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
      {p.onlineCount != null ? (
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-online" aria-hidden />
          {p.onlineCount.toLocaleString()} Online
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-full bg-muted/60" aria-hidden />
        {p.memberCount.toLocaleString()} {members}
      </span>
    </span>
  );
}

export function InviteCard({ link, onRemove }: { link: InviteLink; onRemove?: RemoveEmbeds }) {
  const entry = useInvite(link.code);
  const [joining, setJoining] = useState(false);
  useGrowNotice(entry !== undefined);
  if (!entry) return null;
  const p = 'preview' in entry ? entry.preview : null;
  const heading = !p
    ? "You've been invited, but…"
    : p.kind === 'channel'
      ? "You've been invited to follow a channel"
      : `You've been invited to join a ${NOUN[p.kind]}`;
  return (
    <EmbedFrame onRemove={onRemove}>
      <div
        className="w-[min(432px,72vw)] max-w-full rounded-lg bg-black/[0.04] p-4 whitespace-normal dark:bg-white/[0.05]"
        data-testid="invite-embed"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-[12px] font-bold tracking-wide text-muted uppercase">{heading}</p>
        {p ? (
          <div className="flex items-center gap-3">
            <InviteIcon p={p} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-semibold text-fg">{p.name}</span>
              {!p.isMember && !p.canJoin && p.reason ? (
                <span className="mt-0.5 block truncate text-[12.5px] text-muted">{p.reason}</span>
              ) : (
                <Counts p={p} />
              )}
            </span>
            {p.isMember ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => bus.emit('navigate', { to: targetPath(p.kind, p.id) })}
              >
                Joined
              </Button>
            ) : (
              <Button
                size="sm"
                loading={joining}
                disabled={!p.canJoin}
                onClick={() => {
                  setJoining(true);
                  void join(link.code, p).finally(() => setJoining(false));
                }}
              >
                {p.kind === 'channel' ? 'Follow' : 'Join'}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-danger/15 text-danger">
              <Link2Off size={22} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold text-danger">Invalid invite</span>
              <span className="block text-[12.5px] text-muted">Try sending a new invite!</span>
            </span>
          </div>
        )}
      </div>
    </EmbedFrame>
  );
}
