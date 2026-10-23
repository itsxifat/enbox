/**
 * Server Guide, Browse Channels and Channels & Roles: the REST calls and what they change in
 * my copy of the Space (`space.guide`, `space.me.guideDone`, `channelPrefs`, roles, answers).
 * The realtime echoes (`space:guide`, `me:channel-prefs`, `space:upsert`) land in the same
 * place (realtime/guide.ts, realtime/spaces.ts).
 *
 * Browse Channels choices show at once: they patch my channel choices locally, then go out as
 * one batched `PUT channel-prefs` (PREFS_BATCH_MS after the last change, or `flushChannelPrefs`).
 * Until the server confirms them they stay on top of whatever list arrives.
 */
import type {
  ChannelPref,
  GuideProgress,
  ID,
  OnboardingAnswers,
  OnboardingPrompt,
  ServerGuide,
  ServerGuideRequest,
  Space,
} from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { toast } from '@/stores/ui';

/** Shallow-patch my copy of a Space (none of this changes permission bits: no recompute). */
function patchSpace(spaceId: ID, patch: (s: Space) => Partial<Space> | null): void {
  useSpaces.setState((st) => {
    const cur = st.byId[spaceId];
    const next = cur ? patch(cur) : null;
    return cur && next ? { byId: { ...st.byId, [spaceId]: { ...cur, ...next } } } : st;
  });
}

const patchMe = (spaceId: ID, me: Partial<Space['me']>) =>
  patchSpace(spaceId, (s) => ({ me: { ...s.me, ...me } }));

// ---------------------------------------------------------------------------
// Server Guide
// ---------------------------------------------------------------------------

/** `space:guide`, or my own save. */
export function setSpaceGuide(spaceId: ID, guide: ServerGuide | null): void {
  patchSpace(spaceId, () => ({ guide }));
}

/** Save the whole guide (MANAGE_SPACE); null removes it. */
export async function saveGuide(
  spaceId: ID,
  guide: ServerGuideRequest,
): Promise<ServerGuide | null> {
  const path = `/api/spaces/${spaceId}/guide`;
  // No body = remove (a bare JSON null is not a valid request body).
  const saved = await (guide ? api.put<ServerGuide>(path, guide) : api.put<null>(path));
  setSpaceGuide(spaceId, saved);
  return saved;
}

/** The to-do progress of a guide: done = to-dos whose channel I visited. Pure. */
export function guideProgress(
  guide: Pick<ServerGuide, 'todos'> | null | undefined,
  doneIds: readonly ID[] | undefined,
): { done: number; total: number } {
  const todos = guide?.todos ?? [];
  const done = new Set(doneIds ?? []);
  return { done: todos.filter((t) => done.has(t.channelId)).length, total: todos.length };
}

/** To-dos being ticked right now, or refused (no longer a to-do): one request each. */
const ticking = new Set<string>();

/**
 * I opened a channel: tick it when it is a to-do of the Space's guide I haven't done (the
 * server ignores repeats; my other devices get `space:upsert`).
 */
export function visitedChannel(space: Space, channelId: ID): void {
  const guide = space.guide;
  if (!guide?.enabled || !guide.todos.some((t) => t.channelId === channelId)) return;
  if (space.me.guideDone?.includes(channelId)) return;
  const key = `${space.id}:${channelId}`;
  if (ticking.has(key)) return;
  ticking.add(key);
  void api
    .post<GuideProgress>(`/api/spaces/${space.id}/guide/todos/${channelId}/done`)
    .then((p) => {
      ticking.delete(key);
      patchMe(space.id, { guideDone: p.doneChannelIds });
    })
    .catch((e: unknown) => {
      // A guide changed meanwhile says 404: don't ask again this session. Else try next time.
      if (!(e instanceof ApiError && e.status === 404)) ticking.delete(key);
    });
}

// ---------------------------------------------------------------------------
// Browse Channels
// ---------------------------------------------------------------------------

/** How long Browse Channels waits for more clicks before saving them together. */
export const PREFS_BATCH_MS = 400;

interface PrefQueue {
  /** My choices the server hasn't confirmed yet (sent or not). */
  local: Map<ID, boolean>;
  /** The ones not sent yet. */
  unsent: Set<ID>;
  timer: ReturnType<typeof setTimeout> | null;
}

const queues = new Map<ID, PrefQueue>();

registerSessionReset(() => {
  for (const q of queues.values()) if (q.timer) clearTimeout(q.timer);
  queues.clear();
  ticking.clear();
});

/**
 * `prefs` with my unconfirmed choices on top: a choice equal to the channel's default (opt-in:
 * hidden, else shown) is no row, as the server stores them. Pure but for the chats lookup.
 */
function withLocal(spaceId: ID, prefs: readonly ChannelPref[]): ChannelPref[] {
  const local = queues.get(spaceId)?.local;
  if (!local?.size) return [...prefs];
  const byId = useChats.getState().byId;
  const out = new Map(prefs.map((p) => [p.channelId, p.shown]));
  for (const [id, shown] of local) {
    if (shown === !byId[id]?.space?.optIn) out.delete(id);
    else out.set(id, shown);
  }
  return [...out].map(([channelId, shown]) => ({ channelId, shown }));
}

/** My choices from the server (`me:channel-prefs`, a save's answer), unconfirmed ones on top. */
export function receiveChannelPrefs(spaceId: ID, prefs: readonly ChannelPref[]): void {
  patchMe(spaceId, { channelPrefs: withLocal(spaceId, prefs) });
}

/** Show or hide channels in my sidebar (Browse Channels): at once here, saved in one batch. */
export function setChannelsShown(spaceId: ID, changes: Readonly<Record<ID, boolean>>): void {
  let q = queues.get(spaceId);
  if (!q) queues.set(spaceId, (q = { local: new Map(), unsent: new Set(), timer: null }));
  for (const [id, shown] of Object.entries(changes)) {
    q.local.set(id, shown);
    q.unsent.add(id);
  }
  const space = useSpaces.getState().byId[spaceId];
  if (space) receiveChannelPrefs(spaceId, space.me.channelPrefs ?? []);
  if (q.timer) clearTimeout(q.timer);
  q.timer = setTimeout(() => void flushChannelPrefs(spaceId), PREFS_BATCH_MS);
}

/** Send the choices waiting for the batch now (leaving Browse Channels, tests). */
export async function flushChannelPrefs(spaceId: ID): Promise<void> {
  const q = queues.get(spaceId);
  if (!q) return;
  if (q.timer) clearTimeout(q.timer);
  q.timer = null;
  const batch = [...q.unsent].map((channelId) => ({ channelId, shown: q.local.get(channelId)! }));
  q.unsent.clear();
  if (!batch.length) return;
  // Confirmed (or refused) unless I changed them again meanwhile.
  const settle = () => {
    for (const b of batch)
      if (q.local.get(b.channelId) === b.shown && !q.unsent.has(b.channelId))
        q.local.delete(b.channelId);
  };
  try {
    const saved = await api.put<ChannelPref[]>(`/api/spaces/${spaceId}/channel-prefs`, {
      prefs: batch,
    });
    settle();
    receiveChannelPrefs(spaceId, saved);
  } catch (e) {
    settle();
    toast.error(e);
    // Back to what the server has.
    void api
      .get<Space>(`/api/spaces/${spaceId}/members/me`)
      .then((s) => receiveChannelPrefs(spaceId, s.me.channelPrefs ?? []))
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Channels & Roles
// ---------------------------------------------------------------------------

/** Answers as the server keeps them: questions with picks only, in their options' order. Pure. */
export function normalizeAnswers(
  prompts: readonly OnboardingPrompt[],
  answers: Readonly<OnboardingAnswers>,
): OnboardingAnswers {
  const out: OnboardingAnswers = {};
  for (const p of prompts) {
    const picked = new Set(answers[p.id] ?? []);
    const mine = p.options.filter((o) => picked.has(o.id)).map((o) => o.id);
    if (mine.length) out[p.id] = mine;
  }
  return out;
}

/** Change my onboarding answers: my roles follow (the server decides which). */
export async function changeAnswers(
  spaceId: ID,
  prompts: readonly OnboardingPrompt[],
  answers: OnboardingAnswers,
): Promise<ID[]> {
  const next = normalizeAnswers(prompts, answers);
  const path = `/api/spaces/${spaceId}/onboarding/answers`;
  const { roleIds } = await api.put<{ roleIds: ID[] }>(path, { answers: next });
  const space = useSpaces.getState().byId[spaceId];
  // New roles change my permissions (upsert recomputes them); my channel list refetches on
  // the server's `space:channels-changed`.
  if (space) {
    const me = { ...space.me, roleIds, onboardingAnswers: next };
    useSpaces.getState().upsertSpace({ ...space, me });
  }
  return roleIds;
}
