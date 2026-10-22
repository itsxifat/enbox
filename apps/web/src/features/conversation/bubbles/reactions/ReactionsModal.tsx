/**
 * "Reactions" (Discord's reactor list): a tab per emoji with its count and, for the selected
 * one, who reacted (oldest first). Direct chats and groups have the lists already; Space
 * channels page through `GET /messages/:id/reactions/:emoji`. Remove: my own reaction, and
 * anyone's for moderators (MANAGE_MESSAGES / chat admins). Broadcast channels are anonymous:
 * counts only.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import {
  REACTORS_PAGE_LIMIT,
  userDisplayName,
  type ChatSummary,
  type ID,
  type ReactionSummary,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, IconButton, Modal, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { useUser } from '@/stores/users';
import {
  canModerateReactions,
  isMyReaction,
  reactionKey,
  reactionLabel,
  reactorsHidden,
  reactorsListed,
  sameReaction,
} from './model';
import {
  canRemoveOwnReaction,
  fetchReactors,
  removeReaction,
  removeUserReaction,
} from './reactionActions';
import { ReactionEmoji } from './ReactionEmoji';

export function ReactionsModal({
  chat,
  m,
  initialEmoji,
  onClose,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  /** The tab to open on (default: the first emoji). */
  initialEmoji?: string | null;
  onClose: () => void;
}) {
  const me = useAuth((s) => s.user?.id);
  const [tab, setTab] = useState<string | null>(initialEmoji ?? null);
  const current =
    (tab ? m.reactions.find((r) => sameReaction(r.emoji, tab)) : undefined) ?? m.reactions[0];
  const ids = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = m.reactions.findIndex((r) => r === current);
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step || at === -1) return;
    e.preventDefault();
    const next = (at + step + m.reactions.length) % m.reactions.length;
    setTab(m.reactions[next]!.emoji);
    tabs.current[next]?.focus();
  };

  return (
    <Modal open onClose={onClose} title="Reactions" size="md" bodyClassName="px-0 py-0">
      {current ? (
        <div className="flex h-[min(56dvh,420px)] flex-col sm:flex-row">
          <div
            role="tablist"
            aria-label="Reactions"
            aria-orientation="vertical"
            onKeyDown={onKeyDown}
            className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 scrollbar-thin sm:w-28 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:pr-0 sm:pb-4"
          >
            {m.reactions.map((r, i) => {
              const selected = r === current;
              return (
                <button
                  key={reactionKey(r.emoji)}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${i}`}
                  aria-selected={selected}
                  aria-controls={`${ids}-panel`}
                  aria-label={`${reactionLabel(r.emoji)} ${r.count}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(r.emoji)}
                  className={cn(
                    'flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-[14px] font-semibold tabular-nums transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-brand',
                    selected ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                    isMyReaction(m, me, r.emoji) && !selected && 'text-brand-ink',
                  )}
                >
                  <ReactionEmoji emoji={r.emoji} size={20} />
                  {r.count}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel`}
            aria-labelledby={`${ids}-tab-${m.reactions.indexOf(current)}`}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin"
          >
            {reactorsHidden(chat) ? (
              <p className="px-2 py-3 text-[14px] text-muted">
                {current.count} {current.count === 1 ? 'person' : 'people'} reacted with{' '}
                {reactionLabel(current.emoji)}
                {isMyReaction(m, me, current.emoji) ? ', you included' : ''}. Reactions in channels
                are anonymous.
              </p>
            ) : (
              <ReactorList key={reactionKey(current.emoji)} chat={chat} m={m} r={current} />
            )}
          </div>
        </div>
      ) : (
        <p className="px-6 pb-6 text-[14px] text-muted">No reactions yet.</p>
      )}
    </Modal>
  );
}

interface Page {
  ids: ID[];
  done: boolean;
  loading: boolean;
  failed: boolean;
}

function ReactorList({ chat, m, r }: { chat: ChatSummary; m: ClientMessage; r: ReactionSummary }) {
  const me = useAuth((s) => s.user?.id);
  const listed = reactorsListed(chat);
  const [page, setPage] = useState<Page>({ ids: [], done: false, loading: false, failed: false });
  const busy = useRef(false);
  const more = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (after?: ID) => {
      if (busy.current) return;
      busy.current = true;
      setPage((p) => ({ ...p, loading: true, failed: false }));
      try {
        const users = await fetchReactors(m.id, r.emoji, { after, limit: REACTORS_PAGE_LIMIT });
        const got = users.map((u) => u.id);
        setPage((p) => ({
          ids: after ? [...p.ids, ...got.filter((id) => !p.ids.includes(id))] : got,
          done: got.length < REACTORS_PAGE_LIMIT,
          loading: false,
          failed: false,
        }));
      } catch {
        setPage((p) => ({ ...p, loading: false, failed: true }));
      } finally {
        busy.current = false;
      }
    },
    [m.id, r.emoji],
  );

  useEffect(() => {
    if (!listed) void load();
  }, [listed, load]);

  // A complete Space list that no longer matches the count (someone reacted meanwhile): reload.
  const complete = !listed && page.done && !page.loading;
  const stale = complete && page.ids.length !== r.count;
  useEffect(() => {
    if (stale) void load();
  }, [stale, load]);

  // Page on as the end of the list scrolls into view (the button stays as a fallback).
  const after = page.ids.at(-1);
  const canMore = !listed && !page.done && !page.loading && page.ids.length > 0;
  useEffect(() => {
    const el = more.current;
    if (!canMore || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(after);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [canMore, after, load]);

  const ids = listed ? r.userIds : page.ids;
  const moderator = canModerateReactions(chat);
  const own = canRemoveOwnReaction(chat, m) && isMyReaction(m, me, r.emoji);
  const remove = (userId: ID) => {
    const done = () => setPage((p) => ({ ...p, ids: p.ids.filter((id) => id !== userId) }));
    if (userId === me) {
      void removeReaction(chat, m, r.emoji);
      done();
    } else void removeUserReaction(chat, m, r.emoji, userId).then((ok) => ok && done());
  };

  return (
    <div className="flex flex-col">
      <ul aria-label={`Reacted with ${reactionLabel(r.emoji)}`} className="flex flex-col gap-0.5">
        {ids.map((id) => (
          <ReactorRow
            key={id}
            userId={id}
            spaceId={chat.space?.spaceId}
            onRemove={
              (id === me ? own : moderator && chat.type !== 'channel')
                ? () => remove(id)
                : undefined
            }
          />
        ))}
      </ul>
      {!listed && page.loading ? (
        <div className="flex justify-center py-3 text-brand-ink">
          <Spinner />
        </div>
      ) : null}
      {!listed && page.failed ? (
        <div className="flex flex-col items-center gap-2 py-3 text-[13px] text-muted">
          Couldn’t load who reacted.
          <Button size="sm" variant="secondary" onClick={() => void load(after)}>
            Try again
          </Button>
        </div>
      ) : null}
      {canMore ? (
        <Button
          ref={more}
          size="sm"
          variant="ghost"
          className="mx-auto mt-2"
          onClick={() => void load(after)}
        >
          Show more
        </Button>
      ) : null}
    </div>
  );
}

function ReactorRow({
  userId,
  spaceId,
  onRemove,
}: {
  userId: ID;
  spaceId: ID | null | undefined;
  onRemove?: () => void;
}) {
  const self = useAuth((s) => (s.user?.id === userId ? s.user : null));
  const user = useUser(self ? null : userId);
  const nickname = useSpaces((s) =>
    spaceId ? (s.members[spaceId]?.[userId]?.nickname ?? null) : null,
  );
  const name = nickname || (self ? self.displayName : userDisplayName(user));
  const username = self ? self.username : user?.isDeleted ? null : user?.username;
  return (
    <li className="group/reactor flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
      <UserAvatar userId={userId} size={32} decorated={false} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[15px] font-medium text-fg">{name}</span>
        {username ? <span className="truncate text-[13px] text-muted">{username}</span> : null}
      </span>
      {onRemove ? (
        <IconButton
          icon={X}
          size="sm"
          label={self ? 'Remove my reaction' : `Remove the reaction of ${name}`}
          onClick={onRemove}
          className="opacity-100 lg:opacity-0 lg:group-hover/reactor:opacity-100 lg:focus-visible:opacity-100"
        />
      ) : null}
    </li>
  );
}
