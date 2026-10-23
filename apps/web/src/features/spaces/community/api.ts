/**
 * Community settings of a Space (GET/PATCH /api/spaces/:id/community) and onboarding answers.
 * Members read the settings when a Space opens and onboarding or the welcome screen may be
 * due, so they are cached for a minute (settings pages force a fresh read; a save replaces
 * the cached copy).
 */
import {
  type ID,
  type Space,
  type SpaceCommunity,
  type SpaceOnboarding,
  type UpdateSpaceCommunityRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useSpaces } from '@/stores/spaces';

const TTL_MS = 60_000;
const cache = new Map<ID, { at: number; data: SpaceCommunity }>();
const inflight = new Map<ID, Promise<SpaceCommunity>>();

registerSessionReset(() => {
  cache.clear();
  inflight.clear();
});

/** Onboarding runs for new members: switched on, with at least one question (as the server). */
export function onboardingActive(o: SpaceOnboarding | null | undefined): o is SpaceOnboarding {
  return !!o?.enabled && o.prompts.length > 0;
}

/** The cached settings (null when not loaded or older than the TTL). */
export function peekCommunity(spaceId: ID): SpaceCommunity | null {
  const hit = cache.get(spaceId);
  return hit && Date.now() - hit.at < TTL_MS ? hit.data : null;
}

export function getCommunity(spaceId: ID, opts: { force?: boolean } = {}): Promise<SpaceCommunity> {
  if (!opts.force) {
    const hit = peekCommunity(spaceId);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(spaceId);
    if (pending) return pending;
  }
  const epoch = sessionEpoch();
  const p = api
    .get<SpaceCommunity>(`/api/spaces/${spaceId}/community`)
    .then((data) => {
      if (epoch === sessionEpoch()) cache.set(spaceId, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (inflight.get(spaceId) === p) inflight.delete(spaceId);
    });
  inflight.set(spaceId, p);
  return p;
}

/** Save (one PATCH); my Space gets the listing flag and vanity code at once. */
export async function updateCommunity(
  spaceId: ID,
  body: UpdateSpaceCommunityRequest,
): Promise<SpaceCommunity> {
  const data = await api.patch<SpaceCommunity>(`/api/spaces/${spaceId}/community`, body);
  cache.set(spaceId, { at: Date.now(), data });
  const space = useSpaces.getState().byId[spaceId];
  if (space && (space.isDiscoverable !== data.isDiscoverable || space.vanityCode !== data.vanityCode))
    useSpaces.getState().upsertSpace({ ...space, isDiscoverable: data.isDiscoverable, vanityCode: data.vanityCode });
  return data;
}

/** Finish onboarding with my picks: the roles they hand out and `me.onboardedAt` arrive in the Space. */
export async function submitOnboarding(spaceId: ID, optionIds: string[]): Promise<Space> {
  const space = await api.post<Space>(`/api/spaces/${spaceId}/onboarding/answers`, { optionIds });
  useSpaces.getState().upsertSpace(space);
  return space;
}

/** My Space as the server has it now (`me.onboardedAt` may be newer than the loaded copy). */
export async function refreshMySpace(spaceId: ID): Promise<Space> {
  const space = await api.get<Space>(`/api/spaces/${spaceId}/members/me`);
  useSpaces.getState().upsertSpace(space);
  return space;
}

// ---------------------------------------------------------------------------
// The welcome screen: once per device and Space
// ---------------------------------------------------------------------------

const WELCOME_KEY = 'enbox.spaces.welcomeSeen';

function seenWelcomes(): string[] {
  try {
    const raw = localStorage.getItem(WELCOME_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function welcomeSeen(spaceId: ID): boolean {
  return seenWelcomes().includes(spaceId);
}

/** Remember that this device showed the Space's welcome screen (the newest 500 Spaces). */
export function markWelcomeSeen(spaceId: ID): void {
  try {
    const list = seenWelcomes().filter((id) => id !== spaceId);
    list.push(spaceId);
    localStorage.setItem(WELCOME_KEY, JSON.stringify(list.slice(-500)));
  } catch {
    /* private mode / quota: it may show again */
  }
}
