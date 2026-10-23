/**
 * Browse Channels: every channel by category with a Show box (opt-in ones unticked), category
 * boxes, one batched save, Show All Channels, and the sidebar following at once; moderators
 * mark a channel "Hide by default" in its settings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PERM, type ChannelPref, type SpaceCategory } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { makeMe } from '@/test/factories';
import { ChannelSidebar } from '@/features/spaces/ChannelSidebar';
import { ChannelDialog } from '@/features/spaces/dialogs/ChannelDialog';
import { BrowseChannelsPage } from './BrowseChannelsPage';
import { seedSpace, spaceChannel } from './testUtils';

const cat = (id: string, name: string, position: number): SpaceCategory => ({
  id,
  name,
  position,
  overwrites: [],
});

function seed(prefs: ChannelPref[] = []) {
  seedSpace({ categories: [cat('fun', 'Fun', 0)], me: { channelPrefs: prefs } }, [
    spaceChannel('general', 'general', {}, { position: 0 }),
    spaceChannel('clubs', 'clubs', {}, { categoryId: 'fun', position: 0, optIn: true }),
    spaceChannel('memes', 'memes', {}, { categoryId: 'fun', position: 1, topic: 'Funny pictures' }),
  ]);
}

function renderBoth() {
  render(
    <MemoryRouter initialEntries={['/spaces/s1/browse']}>
      <Routes>
        <Route
          path="/spaces/:spaceId/browse"
          element={
            <>
              <ChannelSidebar spaceId="s1" />
              <BrowseChannelsPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const sidebarNames = () =>
  screen.queryAllByTestId('space-channel-row').map((r) => r.getAttribute('data-channel-name'));
const box = (name: string) => screen.getByRole('checkbox', { name: `Show ${name}` });

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  // The sidebar reads the community settings (Channels & Roles) and the events.
  vi.spyOn(api, 'get').mockImplementation(
    async (path: string) => (path.endsWith('/community') ? { onboarding: null } : []) as never,
  );
});

describe('Browse Channels', () => {
  it('opt-in channels start unticked; ticks show in the sidebar at once and save in one batch', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockImplementation(
        async (_p: string, body?: unknown) => (body as { prefs: ChannelPref[] }).prefs as never,
      );
    seed();
    renderBoth();
    expect(sidebarNames()).toEqual(['general', 'memes']);
    expect(box('general')).toBeChecked();
    expect(box('clubs')).not.toBeChecked();
    expect(screen.getByTestId('browse-count')).toHaveTextContent('2 of 3 channels shown');

    fireEvent.click(box('clubs'));
    fireEvent.click(box('general'));
    expect(box('clubs')).toBeChecked();
    expect(box('general')).not.toBeChecked();
    expect(sidebarNames()).toEqual(['clubs', 'memes']);
    expect(put).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/channel-prefs', {
      prefs: [
        { channelId: 'clubs', shown: true },
        { channelId: 'general', shown: false },
      ],
    });
  });

  it('a category box shows or hides all of it (mixed: indeterminate)', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue([] as never);
    seed();
    renderBoth();
    const fun = within(screen.getByRole('region', { name: 'Fun' }));
    const all = fun.getByRole('checkbox', { name: 'Show all of Fun' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(box('clubs')).toBeChecked();
    expect(box('memes')).toBeChecked();
    fireEvent.click(all);
    expect(box('clubs')).not.toBeChecked();
    expect(box('memes')).not.toBeChecked();
    // Every channel of Fun hidden: the category leaves the sidebar.
    expect(screen.queryByRole('button', { name: 'Fun' })).toBeNull();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toEqual({
      prefs: [
        { channelId: 'clubs', shown: false },
        { channelId: 'memes', shown: false },
      ],
    });
  });

  it('Show All Channels lists everything in the sidebar, on this device only', () => {
    const put = vi.spyOn(api, 'put');
    seed([{ channelId: 'general', shown: false }]);
    renderBoth();
    expect(sidebarNames()).toEqual(['memes']);
    fireEvent.click(screen.getByRole('switch', { name: 'Show All Channels' }));
    expect(sidebarNames()).toEqual(['general', 'clubs', 'memes']);
    expect(localStorage.getItem('enbox.spaces.showAllChannels')).toBe('{"s1":true}');
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: 'Show All Channels' }));
    expect(sidebarNames()).toEqual(['memes']);
  });

  it('moderators hide a channel by default from its settings', async () => {
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue(spaceChannel('memes', 'memes', {}, { optIn: true }) as never);
    seed();
    useSpaces.setState((s) => ({
      byId: { s1: { ...s.byId.s1!, myPermissions: PERM.MANAGE_CHANNELS } },
    }));
    const memes = spaceChannel('memes', 'memes', {
      spacePermissions: PERM.VIEW_CHANNEL | PERM.MANAGE_CHANNELS,
    });
    render(
      <MemoryRouter>
        <ChannelDialog spaceId="s1" chat={memes} onClose={() => undefined} />
      </MemoryRouter>,
    );
    const hide = screen.getByRole('switch', { name: 'Hide by default' });
    expect(hide).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(hide);
    fireEvent.click(screen.getByTestId('channel-save'));
    await vi.waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![0]).toBe('/api/spaces/s1/channels/memes');
    expect(patch.mock.calls[0]![1]).toMatchObject({ optIn: true });
  });
});
