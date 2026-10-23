/**
 * "Reactions" (Discord's reactor list): a tab per emoji with its count, and one more marked
 * with a sparkle for its super reactions (before it, as the chips), and for the selected one
 * who reacted (oldest first). Direct chats and groups have the lists already; Space channels
 * page through `GET /messages/:id/reactions/:emoji[?burst=true]`. Remove: my own reaction,
 * and anyone's for moderators (MANAGE_MESSAGES / chat admins). Broadcast channels are
 * anonymous: counts only.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Sparkles, X } from 'lucide-react';
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
  burstCountOf,
  canModerateReactions,
  isMyBurstReaction,
  isMyReaction,
  normalCountOf,
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

/** One tab: an emoji's normal or super reactions. */
interface Tab {
  r: ReactionSummary;
  burst: boolean;
  count: number;
}

/** The tabs in chip order: an emoji's super reactions, then its normal ones. */
function tabsOf(reactions: ReactionSummary[]): Tab[] {
  return reactions.flatMap((r) => [
    ...(burstCountOf(r) > 0 ? [{ r, burst: true, count: burstCountOf(r) }] : []),
    ...(normalCountOf(r) > 0 ? [{ r, burst: false, count: normalCountOf(r) }] : []),
  ]);
}

const tabKey = (t: Pick<Tab, 'burst'> & { emoji: string }) =>
  `${t.burst ? 'burst' : 'normal'}|${reactionKey(t.emoji)}`;

export function ReactionsModal({
  chat,
  m,
  initialEmoji,
  initialBurst = false,
  onClose,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  /** The tab to open on (default: the first emoji). */
  initialEmoji?: string | null;
  /** With `initialEmoji`: its super reactions' tab. */
  initialBurst?: boolean;
  onClose: () => void;
}) {
  const me = useAuth((s) => s.user?.id);
  const [tab, setTab] = useState<{ emoji: string; burst: boolean } | null>(
    initialEmoji ? { emoji: initialEmoji, burst: initialBurst } : null,
  );
  const tabs = tabsOf(m.reactions);
  const current =
    (tab
      ? (tabs.find((t) => t.burst === tab.burst && sameReaction(t.r.emoji, tab.emoji)) ??
        tabs.find((t) => sameReaction(t.r.emoji, tab.emoji)))
      : undefined) ?? tabs[0];
  const at = current ? tabs.indexOf(current) : -1;
  const ids = useId();
  const tabEls = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step || at === -1) return;
    e.preventDefault();
    const next = (at + step + tabs.length) % tabs.length;
    setTab({ emoji: tabs[next]!.r.emoji, burst: tabs[next]!.burst });
    tabEls.current[next]?.focus();
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
            {tabs.map((t, i) => {
              const selected = t === current;
              const mine = t.burst
                ? isMyBurstReaction(m, me, t.r.emoji)
                : isMyReaction(m, me, t.r.emoji);
              return (
                <button
                  key={tabKey({ emoji: t.r.emoji, burst: t.burst })}
                  ref={(el) => {
                    tabEls.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${i}`}
                  aria-selected={selected}
                  aria-controls={`${ids}-panel`}
                  aria-label={`${t.burst ? 'Super Reactions ' : ''}${reactionLabel(t.r.emoji)} ${t.count}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab({ emoji: t.r.emoji, burst: t.burst })}
                  className={cn(
                    'flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-[14px] font-semibold tabular-nums transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-brand',
                    selected ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                    mine && !selected && 'text-brand-ink',
                  )}
                >
                  <span className="relative inline-flex shrink-0">
                    <ReactionEmoji emoji={t.r.emoji} size={20} />
                    {t.burst ? (
                      <Sparkles
                        size={11}
                        strokeWidth={2.25}
                        aria-hidden
                        className="absolute -top-1 -right-1.5 text-brand-ink"
                      />
                    ) : null}
                  </span>
                  {t.count}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel`}
            aria-labelledby={`${ids}-tab-${at}`}
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin"
          >
            {reactorsHidden(chat) ? (
              <AnonymousCount m={m} tab={current} />
            ) : (
              <ReactorList
                key={tabKey({ emoji: current.r.emoji, burst: current.burst })}
                chat={chat}
                m={m}
                r={current.r}
                burst={current.burst}
              />
            )}
          </div>
        </div>
      ) : (
        <p className="px-6 pb-6 text-[14px] text-muted">No reactions yet.</p>
      )}
    </Modal>
  );
}

/** Broadcast channels: how many, and whether I'm one of them. */
function AnonymousCount({ m, tab }: { m: ClientMessage; tab: Tab }) {
  const me = useAuth((s) => s.user?.id);
  const { r, count, burst } = tab;
  const label = reactionLabel(r.emoji);
  const mine = burst ? isMyBurstReaction(m, me, r.emoji) : isMyReaction(m, me, r.emoji);
  return (
    <p className="px-2 py-3 text-[14px] text-muted">
      {burst
        ? `${count} ${count === 1 ? 'Super Reaction' : 'Super Reactions'} with ${label}`
        : `${count} ${count === 1 ? 'person' : 'people'} reacted with ${label}`}
      {mine ? ', you included' : ''}. Reactions in channels are anonymous.
    </p>
  );
}

interface Page {
  ids: ID[];
  done: boolean;
  loading: boolean;
  failed: boolean;
}

function ReactorList({
  chat,
  m,
  r,
  burst,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  r: ReactionSummary;
  /** The emoji's super reactors. */
  burst: boolean;
}) {
  const me = useAuth((s) => s.user?.id);
  const listed = reactorsListed(chat);
  const count = burst ? burstCountOf(r) : normalCountOf(r);
  const [page, setPage] = useState<Page>({ ids: [], done: false, loading: false, failed: false });
  const busy = useRef(false);
  const more = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (after?: ID) => {
      if (busy.current) return;
      busy.current = true;
      setPage((p) => ({ ...p, loading: true, failed: false }));
      try {
        const users = await fetchReactors(m.id, r.emoji, {
          after,
          limit: REACTORS_PAGE_LIMIT,
          burst,
        });
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
    [m.id, r.emoji, burst],
  );

  useEffect(() => {
    if (!listed) void load();
  }, [listed, load]);

  // A complete Space list that no longer matches the count (someone reacted meanwhile): reload.
  const complete = !listed && page.done && !page.loading;
  const stale = complete && page.ids.length !== count;
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

  const ids = listed ? (burst ? (r.burstUserIds ?? []) : r.userIds) : page.ids;
  const moderator = canModerateReactions(chat);
  const mineHere = burst ? isMyBurstReaction(m, me, r.emoji) : isMyReaction(m, me, r.emoji);
  const own = canRemoveOwnReaction(chat, m) && mineHere;
  const remove = (userId: ID) => {
    const done = () => setPage((p) => ({ ...p, ids: p.ids.filter((id) => id !== userId) }));
    if (userId === me) {
      void removeReaction(chat, m, r.emoji, { burst });
      done();
    } else void removeUserReaction(chat, m, r.emoji, userId, { burst }).then((ok) => ok && done());
  };
  const label = reactionLabel(r.emoji);

  return (
    <div className="flex flex-col">
      <ul
        aria-label={burst ? `Super reacted with ${label}` : `Reacted with ${label}`}
        className="flex flex-col gap-0.5"
      >
        {ids.map((id) => (
          <ReactorRow
            key={id}
            userId={id}
            spaceId={chat.space?.spaceId}
            burst={burst}
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
  burst,
  onRemove,
}: {
  userId: ID;
  spaceId: ID | null | undefined;
  /** A super reaction (the remove button says so). */
  burst: boolean;
  onRemove?: () => void;
}) {
  const self = useAuth((s) => (s.user?.id === userId ? s.user : null));
  const user = useUser(self ? null : userId);
  const nickname = useSpaces((s) =>
    spaceId ? (s.members[spaceId]?.[userId]?.nickname ?? null) : null,
  );
  const name = nickname || (self ? self.displayName : userDisplayName(user));
  const username = self ? self.username : user?.isDeleted ? null : user?.username;
  const what = burst ? 'Super Reaction' : 'reaction';
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
          label={self ? `Remove my ${what}` : `Remove the ${what} of ${name}`}
          onClick={onRemove}
          className="opacity-100 lg:opacity-0 lg:group-hover/reactor:opacity-100 lg:focus-visible:opacity-100"
        />
      ) : null}
    </li>
  );
}
