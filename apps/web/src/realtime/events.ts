/**
 * Realtime: scheduled events → events store (stores/events.ts).
 *
 * - `space:event` (viewer-neutral, to the Space room): created, edited, started, ended,
 *   canceled, or a new Interested count; my own `interested` stays.
 * - `space:event-deleted`: the event leaves the list.
 * - `space:event-started` (only to the interested): the event (with `interested: true`), and
 *   the reminder: a toast "Event starting: <name>" with a Go button; like a message it also
 *   plays the notification sound while I'm looking at Enbox, or shows a system notification
 *   (tag `event:<id>`, the same as its push, so the two collapse) while I'm not — neither in
 *   do not disturb.
 * - `space:removed` (left, kicked, banned, deleted): the Space's events go.
 * Every `ready` marks the loaded lists stale: the open Space's list reloads at once (its
 * sidebar uses it), the others when next shown.
 */
import { isDnd, type ID, type SpaceEvent } from '@enbox/shared';
import { goToEvent } from '@/features/events/actions';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useEvents } from '@/stores/events';
import { useSpaces } from '@/stores/spaces';
import { toast, useUi } from '@/stores/ui';

/** The in-app reminder of an event I am interested in that just started. */
export function announceEventStarted(spaceId: ID, event: SpaceEvent): void {
  const spaceName = useSpaces.getState().byId[spaceId]?.name;
  toast.info(`Event starting: ${event.name}`, {
    id: `event-started:${event.id}`,
    ...(spaceName ? { description: spaceName } : {}),
    action: { label: 'Go', onClick: () => goToEvent(event) },
  });
  const me = useAuth.getState().user;
  if (!me || isDnd(me)) return;
  const { prefs } = useUi.getState();
  if (isAppFocused() || !prefs.desktopNotifications) {
    if (prefs.sounds) playSound('notification');
    return;
  }
  void showNotification({
    title: `Event starting: ${event.name}`,
    body: spaceName ?? '',
    tag: `event:${event.id}`,
    url: `/spaces/${spaceId}?event=${event.id}`,
  });
}

export function registerEventHandlers(socket: AppSocket): void {
  const events = () => useEvents.getState();
  socket.on('space:event', ({ event }) => events().applyEvent(event, { neutral: true }));
  socket.on('space:event-deleted', ({ spaceId, eventId }) => events().applyDeleted(spaceId, eventId));
  socket.on('space:event-started', ({ spaceId, event }) => {
    events().applyEvent(event);
    announceEventStarted(spaceId, event);
  });
  socket.on('space:removed', ({ spaceId }) => events().dropSpace(spaceId));
}

export async function resyncEvents(_info: ReadyInfo): Promise<void> {
  useEvents.getState().invalidate();
}
