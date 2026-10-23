/** The event card: what it shows, the Interested toggle and count, the "…" menu by permission. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PERM, type Space, type SpaceEvent } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useEvents } from '@/stores/events';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { EventCard, eventMenuItems } from './EventCard';
import { formatEventDate } from './format';
import { makeEvent, makeVoiceChannel } from './testUtils';

const space = (myPermissions = 0) => makeSpace({ id: 's1', myPermissions });

/** The card as the store has it (it re-renders from the store like the modal's list). */
function Live({ id, space: sp }: { id: string; space: Space }) {
  const event = useEvents((s) => s.bySpace.s1?.find((e) => e.id === id));
  return event ? <EventCard event={event} space={sp} /> : null;
}

function renderCard(event: SpaceEvent, sp = space()) {
  useEvents.setState({ bySpace: { s1: [event] } });
  return render(<Live id={event.id} space={sp} />);
}

const labels = (event: SpaceEvent, canManage: boolean, now?: number) =>
  eventMenuItems(event, { canManage, onEdit: () => undefined, now })
    .filter((e): e is Exclude<typeof e, 'separator' | null | false | undefined> => !!e && e !== 'separator')
    .map((e) => e.label);

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
  const voice = makeVoiceChannel();
  useChats.setState({ byId: { [voice.id]: voice } });
});
afterEach(() => {
  vi.restoreAllMocks();
  useChats.setState({ byId: {} });
});

describe('EventCard', () => {
  it('shows the date line, name, description, the voice channel and the count; a colour band without a cover', () => {
    renderCard(makeEvent({ description: 'Bring snacks', interestedCount: 12 }));
    expect(screen.getByTestId('event-date')).toHaveTextContent(formatEventDate('2026-10-25T19:00:00.000Z'));
    expect(screen.getByRole('heading', { name: 'Movie night' })).toBeInTheDocument();
    expect(screen.getByText('Bring snacks')).toBeInTheDocument();
    expect(screen.getByTestId('event-place')).toHaveTextContent('Lounge');
    expect(screen.getByTestId('event-interested-count')).toHaveTextContent('12 Interested');
    expect(screen.getByTestId('event-band')).toBeInTheDocument();
  });

  it('a cover image; a link location opens in a new tab; "Live now" once started', () => {
    renderCard(
      makeEvent({
        imageUrl: '/uploads/cover.jpg',
        entityType: 'external',
        channelId: null,
        location: 'https://example.com/stream',
        status: 'active',
      }),
    );
    expect(screen.queryByTestId('event-band')).toBeNull();
    expect(screen.getByRole('link', { name: 'https://example.com/stream' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Live now')).toBeInTheDocument();
  });

  it('Interested toggles at once (bell, count) and settles on the response', async () => {
    let resolve!: (v: unknown) => void;
    const put = vi.spyOn(api, 'put').mockReturnValue(new Promise((r) => (resolve = r)) as never);
    renderCard(makeEvent({ interestedCount: 2 }));
    const button = screen.getByRole('button', { name: 'Interested' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/events/e1/interested');
    expect(screen.getByRole('button', { name: 'Interested' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-interested-count')).toHaveTextContent('3 Interested');
    await act(async () => resolve(makeEvent({ interested: true, interestedCount: 5 })));
    expect(screen.getByTestId('event-interested-count')).toHaveTextContent('5 Interested');
    // Off again; a failure puts it back with a toast.
    vi.spyOn(api, 'delete').mockRejectedValue(new Error('Nope'));
    fireEvent.click(screen.getByRole('button', { name: 'Interested' }));
    await waitFor(() => expect(useUi.getState().toasts.map((t) => t.message)).toContain('Nope'));
    expect(screen.getByRole('button', { name: 'Interested' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('event-interested-count')).toHaveTextContent('5 Interested');
  });

  it('the menu: Copy Link for everyone; organizers get edit and the status actions that apply', () => {
    const start = Date.parse('2026-10-25T19:00:00.000Z');
    const scheduled = makeEvent();
    expect(labels(scheduled, false)).toEqual(['Copy Link']);
    expect(labels(scheduled, true, start - 60 * 60_000)).toEqual(['Edit Event', 'Cancel Event', 'Copy Link', 'Delete Event']);
    expect(labels(scheduled, true, start - 10 * 60_000)).toEqual([
      'Edit Event',
      'Start Event',
      'Cancel Event',
      'Copy Link',
      'Delete Event',
    ]);
    expect(labels({ ...scheduled, status: 'active' }, true)).toEqual(['Edit Event', 'End Event', 'Copy Link', 'Delete Event']);
  });

  it('who manages: the creator and MANAGE_SPACE see the organizer menu, others only the link', () => {
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const items = () => screen.getAllByRole('menuitem').map((m) => m.textContent);
    const { unmount } = renderCard(makeEvent({ creatorId: 'bob' }), space(PERM.MANAGE_CHANNELS));
    open();
    expect(items()).toEqual(['Copy Link']);
    unmount();
    const mine = renderCard(makeEvent({ creatorId: 'me' }));
    open();
    expect(items()).toContain('Delete Event');
    mine.unmount();
    renderCard(makeEvent({ creatorId: 'bob' }), space(PERM.MANAGE_SPACE));
    open();
    expect(items()).toContain('Cancel Event');
  });

  it('a live voice event has Join; Delete asks first and removes it', async () => {
    renderCard(makeEvent({ status: 'active', creatorId: 'me' }));
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Event' }));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Delete ‘Movie night’?');
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/spaces/s1/events/e1'));
    await waitFor(() => expect(screen.queryByTestId('event-card')).toBeNull());
  });
});
