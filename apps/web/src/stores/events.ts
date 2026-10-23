/**
 * Scheduled events of my Spaces (features/events).
 *
 * State
 * - `bySpace`  spaceId → its open events (scheduled and active) by start time, for the Spaces
 *              whose list was loaded (the channel sidebar of the open Space loads it)
 * - `stale`    lists to fetch again when next used (every `ready`: changes may have been missed)
 * - `modal`    the events modal: the Space it is open for, the event to show, or the wizard
 *
 * Reducers (realtime/events.ts)
 * - `applyEvent(event, { neutral })`  `space:event` and REST responses: replace or insert in
 *     start order; a completed or canceled event leaves the list. A neutral copy (the room's)
 *     keeps my own `interested`. Lists not loaded are left alone (they load fresh).
 * - `applyDeleted(spaceId, eventId)`, `dropSpace(spaceId)` (left / removed), `invalidate()`
 *
 * Actions: `load(spaceId, { force })` (deduped), `create`, `update`, `remove`, and
 * `setInterested` (optimistic: shown at once, back as it was when the request fails).
 *
 * Hooks: `useSpaceEvents(spaceId)` (loads on first use and when stale). Helpers:
 * `canCreateEvents`, `canManageEvent`, `canStartEvent`, `eventLink`.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import {
  PERM,
  hasPerm,
  type CreateSpaceEventRequest,
  type ID,
  type Space,
  type SpaceEvent,
  type UpdateSpaceEventRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { publicOrigin } from '@/lib/serverConfig';
import { registerSessionReset, sessionEpoch } from '@/lib/session';

/** Organizers may start an event this long before its start time (the server's rule). */
export const EVENT_START_EARLY_MS = 15 * 60_000;

export interface EventsModal {
  spaceId: ID;
  /** Scroll to (and ring) this event. */
  eventId?: ID;
  /** Open on the create wizard. */
  create?: boolean;
}

export interface EventsState {
  bySpace: Record<ID, SpaceEvent[]>;
  stale: Record<ID, boolean>;
  modal: EventsModal | null;

  load(spaceId: ID, opts?: { force?: boolean }): Promise<SpaceEvent[]>;
  create(spaceId: ID, body: CreateSpaceEventRequest): Promise<SpaceEvent>;
  update(spaceId: ID, eventId: ID, body: UpdateSpaceEventRequest): Promise<SpaceEvent>;
  remove(spaceId: ID, eventId: ID): Promise<void>;
  setInterested(spaceId: ID, eventId: ID, on: boolean): Promise<void>;
  applyEvent(event: SpaceEvent, opts?: { neutral?: boolean }): void;
  applyDeleted(spaceId: ID, eventId: ID): void;
  dropSpace(spaceId: ID): void;
  invalidate(): void;
  openModal(spaceId: ID, opts?: Omit<EventsModal, 'spaceId'>): void;
  closeModal(): void;
}

const initial = {
  bySpace: {} as Record<ID, SpaceEvent[]>,
  stale: {} as Record<ID, boolean>,
  modal: null as EventsModal | null,
};

const isOver = (e: Pick<SpaceEvent, 'status'>) => e.status === 'completed' || e.status === 'canceled';

/** By start time, then id (the server's order). */
export function sortEvents(list: readonly SpaceEvent[]): SpaceEvent[] {
  return [...list].sort((a, b) =>
    a.startAt === b.startAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.startAt < b.startAt ? -1 : 1,
  );
}

/** `list` with `event` applied (see `applyEvent`). */
export function mergeEvent(list: readonly SpaceEvent[], event: SpaceEvent, neutral = false): SpaceEvent[] {
  const i = list.findIndex((e) => e.id === event.id);
  if (isOver(event)) return i === -1 ? [...list] : list.filter((e) => e.id !== event.id);
  const next = neutral && i !== -1 ? { ...event, interested: list[i]!.interested } : event;
  return sortEvents(i === -1 ? [...list, next] : list.map((e, j) => (j === i ? next : e)));
}

const loads = new Map<ID, Promise<SpaceEvent[]>>();

export const useEvents = create<EventsState>((set, get) => {
  const put = (spaceId: ID, fn: (list: SpaceEvent[]) => SpaceEvent[]) =>
    set((s) => {
      const list = s.bySpace[spaceId];
      return list ? { bySpace: { ...s.bySpace, [spaceId]: fn(list) } } : s;
    });

  return {
    ...initial,

    load(spaceId, { force = false } = {}) {
      const have = get().bySpace[spaceId];
      if (have && !force && !get().stale[spaceId]) return Promise.resolve(have);
      const pending = loads.get(spaceId);
      if (pending) return pending;
      const epoch = sessionEpoch();
      const p = api
        .get<SpaceEvent[]>(`/api/spaces/${spaceId}/events`)
        .then((list) => {
          const sorted = sortEvents(list.filter((e) => !isOver(e)));
          if (epoch === sessionEpoch())
            set((s) => {
              const { [spaceId]: _done, ...stale } = s.stale;
              return { bySpace: { ...s.bySpace, [spaceId]: sorted }, stale };
            });
          return sorted;
        })
        .finally(() => loads.delete(spaceId));
      loads.set(spaceId, p);
      return p;
    },

    async create(spaceId, body) {
      const event = await api.post<SpaceEvent>(`/api/spaces/${spaceId}/events`, body);
      get().applyEvent(event);
      return event;
    },

    async update(spaceId, eventId, body) {
      const event = await api.patch<SpaceEvent>(`/api/spaces/${spaceId}/events/${eventId}`, body);
      get().applyEvent(event);
      return event;
    },

    async remove(spaceId, eventId) {
      await api.delete(`/api/spaces/${spaceId}/events/${eventId}`);
      get().applyDeleted(spaceId, eventId);
    },

    async setInterested(spaceId, eventId, on) {
      const before = get().bySpace[spaceId]?.find((e) => e.id === eventId);
      const shift = (to: boolean, count: number) =>
        put(spaceId, (list) =>
          list.map((e) => (e.id === eventId ? { ...e, interested: to, interestedCount: Math.max(0, count) } : e)),
        );
      if (before && before.interested !== on) shift(on, before.interestedCount + (on ? 1 : -1));
      const path = `/api/spaces/${spaceId}/events/${eventId}/interested`;
      try {
        const event = on ? await api.put<SpaceEvent>(path) : await api.delete<SpaceEvent>(path);
        get().applyEvent(event);
      } catch (e) {
        if (before) shift(before.interested, before.interestedCount);
        throw e;
      }
    },

    applyEvent(event, { neutral = false } = {}) {
      put(event.spaceId, (list) => mergeEvent(list, event, neutral));
    },

    applyDeleted(spaceId, eventId) {
      put(spaceId, (list) => list.filter((e) => e.id !== eventId));
    },

    dropSpace(spaceId) {
      set((s) => {
        const { [spaceId]: _gone, ...bySpace } = s.bySpace;
        const { [spaceId]: _stale, ...stale } = s.stale;
        return { bySpace, stale, modal: s.modal?.spaceId === spaceId ? null : s.modal };
      });
    },

    invalidate() {
      set((s) => ({ stale: Object.fromEntries(Object.keys(s.bySpace).map((id) => [id, true])) }));
    },

    openModal(spaceId, opts = {}) {
      set({ modal: { spaceId, ...opts } });
    },

    closeModal() {
      set({ modal: null });
    },
  };
});

registerSessionReset(() => {
  loads.clear();
  useEvents.setState(initial);
});

/** A Space's open events (loads them on first use, and again once stale); null while loading. */
export function useSpaceEvents(spaceId: ID | null | undefined): SpaceEvent[] | null {
  const list = useEvents((s) => (spaceId ? (s.bySpace[spaceId] ?? null) : null));
  const stale = useEvents((s) => (spaceId ? !!s.stale[spaceId] : false));
  useEffect(() => {
    if (spaceId && (!list || stale)) void useEvents.getState().load(spaceId).catch(() => undefined);
  }, [spaceId, list, stale]);
  return list;
}

/** Discord's CREATE_EVENTS stands on MANAGE_CHANNELS until 64-bit permissions. */
export function canCreateEvents(space: Pick<Space, 'myPermissions'>): boolean {
  return hasPerm(space.myPermissions, PERM.MANAGE_CHANNELS);
}

/** Edit, start, end, cancel and delete: the creator, or MANAGE_SPACE. */
export function canManageEvent(
  space: Pick<Space, 'myPermissions'>,
  event: Pick<SpaceEvent, 'creatorId'>,
  meId: ID | null | undefined,
): boolean {
  return (!!meId && event.creatorId === meId) || hasPerm(space.myPermissions, PERM.MANAGE_SPACE);
}

/** A scheduled event can start from EVENT_START_EARLY_MS before its start time. */
export function canStartEvent(event: Pick<SpaceEvent, 'status' | 'startAt'>, now = Date.now()): boolean {
  return event.status === 'scheduled' && now >= Date.parse(event.startAt) - EVENT_START_EARLY_MS;
}

/** The shareable link (canonical origin): the Space with the events modal open on the event. */
export function eventLink(event: Pick<SpaceEvent, 'id' | 'spaceId'>, origin = publicOrigin()): string {
  return `${origin}/spaces/${event.spaceId}?event=${event.id}`;
}
