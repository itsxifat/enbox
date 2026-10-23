/**
 * Event actions shared by the cards, the sidebar's live card, the reminder toast and the
 * menus (the store does the requests; these add the navigation, confirms and toasts).
 */
import type { ChatSummary, SpaceEvent } from '@enbox/shared';
import { copyLink } from '@/features/groups/shared/share';
import { joinVoiceChannel } from '@/features/voice/actions';
import { bus } from '@/lib/bus';
import { useChats } from '@/stores/chats';
import { eventLink, useEvents } from '@/stores/events';
import { confirm, toast } from '@/stores/ui';

/** The voice channel of a voice event, when it is loaded (I can see it). */
export function eventChannel(event: Pick<SpaceEvent, 'entityType' | 'channelId'>): ChatSummary | null {
  if (event.entityType !== 'voice' || !event.channelId) return null;
  const chat = useChats.getState().byId[event.channelId];
  return chat?.type === 'space_voice' ? chat : null;
}

/** Join a live voice event: show its channel and connect (as clicking the channel row does). */
export function joinEvent(event: SpaceEvent): boolean {
  const chat = eventChannel(event);
  if (!chat) return false;
  bus.emit('navigate', { to: `/spaces/${event.spaceId}/${chat.id}` });
  joinVoiceChannel(chat);
  return true;
}

/**
 * The reminder's Go: a live voice event joins its channel; otherwise the Space opens with the
 * events modal on the event.
 */
export function goToEvent(event: SpaceEvent): void {
  if (event.status === 'active' && joinEvent(event)) return;
  bus.emit('navigate', { to: `/spaces/${event.spaceId}` });
  useEvents.getState().openModal(event.spaceId, { eventId: event.id });
}

export async function toggleInterested(event: SpaceEvent): Promise<void> {
  try {
    await useEvents.getState().setInterested(event.spaceId, event.id, !event.interested);
  } catch (e) {
    toast.error(e);
  }
}

/** Start a scheduled event (the interested get their reminder; the card turns "Live now"). */
export async function startEvent(event: SpaceEvent): Promise<void> {
  try {
    await useEvents.getState().update(event.spaceId, event.id, { status: 'active' });
  } catch (e) {
    toast.error(e);
  }
}

export async function endEvent(event: SpaceEvent): Promise<void> {
  const ok = await confirm({
    title: `End ‘${event.name}’?`,
    message: 'The event ends for everyone and leaves the events list.',
    confirmLabel: 'End Event',
    danger: true,
  });
  if (!ok) return;
  try {
    await useEvents.getState().update(event.spaceId, event.id, { status: 'completed' });
  } catch (e) {
    toast.error(e);
  }
}

export async function cancelEvent(event: SpaceEvent): Promise<void> {
  const ok = await confirm({
    title: `Cancel ‘${event.name}’?`,
    message: 'Interested members will no longer see it.',
    confirmLabel: 'Cancel Event',
    cancelLabel: 'Never Mind',
    danger: true,
  });
  if (!ok) return;
  try {
    await useEvents.getState().update(event.spaceId, event.id, { status: 'canceled' });
  } catch (e) {
    toast.error(e);
  }
}

export async function deleteEvent(event: SpaceEvent): Promise<void> {
  const ok = await confirm({
    title: `Delete ‘${event.name}’?`,
    message: 'This cannot be undone.',
    confirmLabel: 'Delete Event',
    danger: true,
  });
  if (!ok) return;
  try {
    await useEvents.getState().remove(event.spaceId, event.id);
  } catch (e) {
    toast.error(e);
  }
}

export function copyEventLink(event: SpaceEvent): Promise<void> {
  return copyLink(eventLink(event));
}
