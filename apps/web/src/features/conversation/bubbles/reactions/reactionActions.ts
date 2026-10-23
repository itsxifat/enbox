/**
 * Reaction actions (Discord model): add / remove / toggle mine with an optimistic update and
 * a rollback on error, moderator removal and clears, and paged reactor lists. Each takes the
 * kind (`{ burst: true }`: the super reaction, `?burst=true` on the route); the rules of
 * adding are the same for both kinds.
 *
 * My changes to one emoji's kind on one message run in order, and my own delta echoes are
 * skipped while they run (pending.ts). A failed request undoes only its own change (others'
 * deltas that arrived meanwhile stay).
 */
import {
  PERM,
  hasPerm,
  parseCustomEmoji,
  type ChatSummary,
  type ID,
  type UserPublic,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { markArrival } from '@/lib/arrivals';
import { getMyId } from '@/stores/auth';
import { useEmojis } from '@/stores/emojis';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { canReact, isActionable } from '../../actions';
import {
  applyReactionChange,
  applyReactionsCleared,
  canAddNewReaction,
  isMyBurstReaction,
  isMyReaction,
  myBurstReactionsOf,
  myReactionsOf,
  reactionAllowed,
  reactorsListed,
  sameReaction,
  superArrivalKey,
  type ReactionChange,
} from './model';
import { enqueueReaction } from './pending';
import { rememberReaction } from './recent';

const enc = encodeURIComponent;

/** The kind of reaction an action is about. */
export interface ReactionKind {
  /** The super reaction of the emoji. */
  burst?: boolean;
}

/** The route suffix of a kind (normal reactions keep the plain route). */
const kindQuery = (burst: boolean) => (burst ? '?burst=true' : '');

/** Apply one change to the cached message; false when it changed nothing. */
function patch(chat: ChatSummary, messageId: ID, change: ReactionChange): boolean {
  let changed = false;
  useMessages.getState().patchReactions(chat.id, messageId, (m) => {
    const next = applyReactionChange(m, change, { me: getMyId(), listed: reactorsListed(chat) });
    changed = !!next;
    return next;
  });
  return changed;
}

/** I may remove my own reactions here (an active member, a live message). */
export function canRemoveOwnReaction(chat: ChatSummary, m: ClientMessage): boolean {
  return isActionable(m) && !m.deletedAt && chat.membership === 'active';
}

/**
 * Space channels: another Space's custom emoji needs USE_EXTERNAL_EMOJI there (unknown ids
 * count as external), as for message sends (server: services/spaceEmojis.ts).
 */
function customEmojiAllowed(chat: ChatSummary, emoji: string): boolean {
  const custom = parseCustomEmoji(emoji);
  const spaceId = chat.space?.spaceId;
  if (!custom || !spaceId || hasPerm(chat.spacePermissions, PERM.USE_EXTERNAL_EMOJI)) return true;
  return useEmojis.getState().byId[custom.id]?.spaceId === spaceId;
}

/**
 * I may add `emoji`. Joining one already on the message needs no more than seeing it; a new
 * one needs ADD_REACTIONS (and USE_EXTERNAL_EMOJI for another Space's custom emoji).
 */
export function canAddReaction(chat: ChatSummary, m: ClientMessage, emoji: string): boolean {
  if (!canReact(chat, m) || !reactionAllowed(chat, emoji)) return false;
  if (m.reactions.some((r) => sameReaction(r.emoji, emoji))) return true;
  return canAddNewReaction(chat) && customEmojiAllowed(chat, emoji);
}

/** Add mine of that kind. A super reaction plays its burst on its chip (lib/arrivals mark). */
export function addReaction(
  chat: ChatSummary,
  m: ClientMessage,
  emoji: string,
  opts: ReactionKind = {},
): Promise<void> {
  const me = getMyId();
  const burst = !!opts.burst;
  if (!me || !canAddReaction(chat, m, emoji)) return Promise.resolve();
  // Join an equivalent emoji under its stored form.
  const stored = m.reactions.find((r) => sameReaction(r.emoji, emoji))?.emoji ?? emoji;
  rememberReaction(stored);
  const change: ReactionChange = { emoji: stored, userId: me, add: true, burst };
  if (burst) markArrival(superArrivalKey(m.id, stored));
  if (!patch(chat, m.id, change)) return Promise.resolve();
  return enqueueReaction(
    m.id,
    stored,
    async () => {
      try {
        await api.put(`/api/messages/${m.id}/reactions/${enc(stored)}/@me${kindQuery(burst)}`);
      } catch (e) {
        patch(chat, m.id, { ...change, add: false });
        toast.error(e);
      }
    },
    burst,
  );
}

export function removeReaction(
  chat: ChatSummary,
  m: ClientMessage,
  emoji: string,
  opts: ReactionKind = {},
): Promise<void> {
  const me = getMyId();
  const burst = !!opts.burst;
  if (!me || !canRemoveOwnReaction(chat, m)) return Promise.resolve();
  const mine = burst ? myBurstReactionsOf(m, me) : myReactionsOf(m, me);
  const stored = mine.find((e) => sameReaction(e, emoji)) ?? emoji;
  const change: ReactionChange = { emoji: stored, userId: me, add: false, burst };
  if (!patch(chat, m.id, change)) return Promise.resolve();
  return enqueueReaction(
    m.id,
    stored,
    async () => {
      try {
        await api.delete(`/api/messages/${m.id}/reactions/${enc(stored)}/@me${kindQuery(burst)}`);
      } catch (e) {
        patch(chat, m.id, { ...change, add: true });
        toast.error(e);
      }
    },
    burst,
  );
}

/** A chip click / quick reaction: remove mine of that kind when I have it, else add it. */
export function toggleReaction(
  chat: ChatSummary,
  m: ClientMessage,
  emoji: string,
  opts: ReactionKind = {},
): Promise<void> {
  const me = getMyId();
  const mine = opts.burst ? isMyBurstReaction(m, me, emoji) : isMyReaction(m, me, emoji);
  return mine ? removeReaction(chat, m, emoji, opts) : addReaction(chat, m, emoji, opts);
}

/**
 * Moderators: remove someone's reaction (of that kind). Not applied locally (Space counts
 * can't tell a duplicate): the `message:reaction-remove` delta updates the message. Resolves
 * to success.
 */
export async function removeUserReaction(
  chat: ChatSummary,
  m: ClientMessage,
  emoji: string,
  userId: ID,
  opts: ReactionKind = {},
): Promise<boolean> {
  if (userId === getMyId()) {
    await removeReaction(chat, m, emoji, opts);
    return true;
  }
  try {
    await api.delete(
      `/api/messages/${m.id}/reactions/${enc(emoji)}/${userId}${kindQuery(!!opts.burst)}`,
    );
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

/** Moderators: clear one emoji, or every reaction (`null`). Clearing twice is harmless. */
export async function clearReactions(
  chat: ChatSummary,
  m: ClientMessage,
  emoji: string | null,
): Promise<void> {
  try {
    await api.delete(
      emoji === null
        ? `/api/messages/${m.id}/reactions`
        : `/api/messages/${m.id}/reactions/${enc(emoji)}`,
    );
    useMessages
      .getState()
      .patchReactions(chat.id, m.id, (cur) => applyReactionsCleared(cur, emoji, getMyId()));
  } catch (e) {
    toast.error(e);
  }
}

/**
 * One page of who reacted with `emoji` (`burst`: who super-reacted), oldest first; the users go
 * into the users cache.
 */
export async function fetchReactors(
  messageId: ID,
  emoji: string,
  opts: { after?: ID; limit?: number } & ReactionKind = {},
): Promise<UserPublic[]> {
  const users = await api.get<UserPublic[]>(`/api/messages/${messageId}/reactions/${enc(emoji)}`, {
    query: { after: opts.after, limit: opts.limit, ...(opts.burst ? { burst: 'true' } : {}) },
  });
  if (users.length) useUsers.getState().upsertUsers(users);
  return users;
}
