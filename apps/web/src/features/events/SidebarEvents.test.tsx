/** The sidebar's events part: the "N Events" row (who sees it), the Live card and Join, the modal and event links. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { PERM, type SpaceEvent } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { joinVoiceChannel } from '@/features/voice/actions';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useEvents } from '@/stores/events';
import { makeMe } from '@/test/factories';
import { SidebarEvents } from './SidebarEvents';
import { makeEvent, makeVoiceChannel } from './testUtils';

vi.mock('@/features/voice/actions', () => ({ joinVoiceChannel: vi.fn() }));

let search = '';
function Search() {
  search = useLocation().search;
  return null;
}

function renderSidebar(events: SpaceEvent[] | null, permissions = 0, url = '/spaces/s1') {
  if (events) useEvents.setState({ bySpace: { s1: events } });
  const space = makeSpace({ id: 's1', name: 'Lab', myPermissions: permissions });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/spaces/:spaceId"
          element={
            <>
              <SidebarEvents space={space} />
              <Search />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSessionState();
  vi.mocked(joinVoiceChannel).mockClear();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  useChats.setState({ byId: {} });
});

describe('SidebarEvents', () => {
  it('shows "N Events" when there are events, for everyone', () => {
    renderSidebar([makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })]);
    expect(screen.getByTestId('sidebar-events-row')).toHaveTextContent('3 Events');
    act(() => useEvents.setState({ bySpace: { s1: [makeEvent()] } }));
    expect(screen.getByTestId('sidebar-events-row')).toHaveTextContent('1 Event');
  });

  it('without events: hidden from members, "Events" for those who can create them', () => {
    const { unmount } = renderSidebar([]);
    expect(screen.queryByTestId('sidebar-events-row')).toBeNull();
    unmount();
    renderSidebar([], PERM.MANAGE_CHANNELS);
    expect(screen.getByTestId('sidebar-events-row')).toHaveTextContent(/^Events$/);
  });

  it('loads the Space’s events when shown', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([makeEvent({ name: 'Loaded' })] as never);
    renderSidebar(null);
    await waitFor(() => expect(screen.getByTestId('sidebar-events-row')).toHaveTextContent('1 Event'));
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/events');
  });

  it('a live voice event: the green Live card with Join, which connects', () => {
    const voice = makeVoiceChannel();
    useChats.setState({ byId: { [voice.id]: voice } });
    renderSidebar([makeEvent({ status: 'active', name: 'Jam session' }), makeEvent({ id: 'later', name: 'Later' })]);
    const card = screen.getByTestId('live-event-card');
    expect(card).toHaveTextContent('Live');
    expect(card).toHaveTextContent('Jam session');
    expect(card).toHaveTextContent('Lounge');
    fireEvent.click(screen.getByRole('button', { name: 'Join Jam session' }));
    expect(joinVoiceChannel).toHaveBeenCalledWith(voice);
    expect(screen.getAllByTestId('live-event-card')).toHaveLength(1);
  });

  it('a live event elsewhere has no Join', () => {
    renderSidebar([makeEvent({ status: 'active', entityType: 'external', channelId: null, location: 'Park' })]);
    expect(screen.getByTestId('live-event-card')).toHaveTextContent('Park');
    expect(screen.queryByRole('button', { name: /^Join/ })).toBeNull();
  });

  it('the row opens the events modal', () => {
    renderSidebar([makeEvent({ name: 'Movie night' })]);
    fireEvent.click(screen.getByTestId('sidebar-events-row'));
    expect(screen.getByRole('dialog', { name: '1 Event' })).toBeInTheDocument();
    expect(screen.getAllByTestId('event-card')).toHaveLength(1);
  });

  it('?event= opens the modal on that event and drops the parameter', async () => {
    renderSidebar([makeEvent({ id: 'e1' }), makeEvent({ id: 'e2', name: 'Other' })], 0, '/spaces/s1?event=e2');
    await waitFor(() => expect(useEvents.getState().modal).toEqual({ spaceId: 's1', eventId: 'e2' }));
    await waitFor(() => expect(search).toBe(''));
    const cards = screen.getAllByTestId('event-card');
    expect(cards.find((c) => c.getAttribute('aria-label') === 'Other')!.className).toContain('ring-brand');
  });
});
