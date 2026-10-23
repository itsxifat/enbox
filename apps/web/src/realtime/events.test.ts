/**
 * Realtime events: `space:event` (neutral) / `-deleted` / `-started` / `space:removed` reach the
 * events store; the reminder toasts "Event starting" with Go (a live voice event joins its
 * channel, others open the modal), plays the sound in the app, notifies away from it, never
 * in do not disturb; every `ready` marks the lists stale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerToClientEvents } from '@enbox/shared';
import { makeEvent, makeVoiceChannel } from '@/features/events/testUtils';
import { joinVoiceChannel } from '@/features/voice/actions';
import { bus } from '@/lib/bus';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import type * as NotifyModule from '@/lib/notify';
import { resetSessionState } from '@/lib/session';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useEvents } from '@/stores/events';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe } from '@/test/factories';
import { registerEventHandlers, resyncEvents } from './events';

vi.mock('@/lib/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof NotifyModule>();
  return {
    ...actual,
    isAppFocused: vi.fn(() => true),
    playSound: vi.fn(),
    showNotification: vi.fn(async () => true),
  };
});
vi.mock('@/features/voice/actions', () => ({ joinVoiceChannel: vi.fn() }));

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on(event: string, fn: (payload: unknown) => void) {
      handlers.set(event, fn);
      return socket;
    },
  } as unknown as AppSocket;
  registerEventHandlers(socket);
  return <E extends keyof ServerToClientEvents>(event: E, payload: Parameters<ServerToClientEvents[E]>[0]) =>
    handlers.get(event)!(payload);
}

const s = () => useEvents.getState();

beforeEach(() => {
  resetSessionState();
  vi.mocked(isAppFocused).mockReturnValue(true);
  vi.mocked(playSound).mockClear();
  vi.mocked(showNotification).mockClear();
  vi.mocked(joinVoiceChannel).mockClear();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useUi.getState().setPref('sounds', true);
  useUi.getState().setPref('desktopNotifications', true);
  useSpaces.setState({ byId: { s1: makeSpace({ id: 's1', name: 'Lab' }) }, order: ['s1'] });
});

describe('realtime events', () => {
  it('space:event merges neutral copies, -deleted removes, space:removed drops the Space', () => {
    const fire = fakeSocket();
    useEvents.setState({ bySpace: { s1: [makeEvent({ interested: true })] } });
    fire('space:event', { spaceId: 's1', event: makeEvent({ interestedCount: 9, interested: false }) });
    expect(s().bySpace.s1![0]).toMatchObject({ interestedCount: 9, interested: true });
    fire('space:event', { spaceId: 's1', event: makeEvent({ id: 'e2', name: 'Second', startAt: '2026-10-26T00:00:00.000Z' }) });
    expect(s().bySpace.s1!.map((e) => e.id)).toEqual(['e1', 'e2']);
    fire('space:event', { spaceId: 's1', event: makeEvent({ id: 'e2', status: 'canceled' }) });
    expect(s().bySpace.s1!.map((e) => e.id)).toEqual(['e1']);
    fire('space:event-deleted', { spaceId: 's1', eventId: 'e1' });
    expect(s().bySpace.s1).toEqual([]);
    fire('space:removed', { spaceId: 's1', reason: 'left' });
    expect(s().bySpace.s1).toBeUndefined();
  });

  it('space:event-started: the event, a toast whose Go joins a live voice event, the sound in the app', () => {
    const fire = fakeSocket();
    const voice = makeVoiceChannel();
    useChats.setState({ byId: { [voice.id]: voice } });
    useEvents.setState({ bySpace: { s1: [makeEvent()] } });
    fire('space:event-started', { spaceId: 's1', event: makeEvent({ status: 'active', interested: true }) });
    expect(s().bySpace.s1![0]).toMatchObject({ status: 'active', interested: true });
    const [t] = useUi.getState().toasts;
    expect(t).toMatchObject({ message: 'Event starting: Movie night', description: 'Lab' });
    const navigate = vi.fn();
    const off = bus.on('navigate', navigate);
    t!.action!.onClick();
    off();
    expect(navigate).toHaveBeenCalledWith({ to: '/spaces/s1/v1' });
    expect(joinVoiceChannel).toHaveBeenCalledWith(voice);
    expect(playSound).toHaveBeenCalledWith('notification');
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('Go on an event elsewhere opens the Space with the modal on it', () => {
    const fire = fakeSocket();
    const fair = makeEvent({ id: 'f', name: 'Fair', entityType: 'external', channelId: null, location: 'Park', status: 'active' });
    fire('space:event-started', { spaceId: 's1', event: fair });
    const navigate = vi.fn();
    const off = bus.on('navigate', navigate);
    useUi.getState().toasts[0]!.action!.onClick();
    off();
    expect(navigate).toHaveBeenCalledWith({ to: '/spaces/s1' });
    expect(s().modal).toEqual({ spaceId: 's1', eventId: 'f' });
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('away from the app: a system notification with the push tag; nothing in do not disturb', () => {
    const fire = fakeSocket();
    vi.mocked(isAppFocused).mockReturnValue(false);
    fire('space:event-started', { spaceId: 's1', event: makeEvent({ status: 'active' }) });
    expect(showNotification).toHaveBeenCalledWith({
      title: 'Event starting: Movie night',
      body: 'Lab',
      tag: 'event:e1',
      url: '/spaces/s1?event=e1',
    });
    vi.mocked(showNotification).mockClear();
    useAuth.setState({ user: makeMe({ id: 'me', availability: 'dnd', availabilityUntil: null }) });
    fire('space:event-started', { spaceId: 's1', event: makeEvent({ id: 'e2', status: 'active' }) });
    expect(showNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    // The toast still shows.
    expect(useUi.getState().toasts).toHaveLength(2);
  });

  it('every ready marks the loaded lists stale', async () => {
    useEvents.setState({ bySpace: { s1: [], s2: [] } });
    await resyncEvents({} as ReadyInfo);
    expect(s().stale).toEqual({ s1: true, s2: true });
  });
});
