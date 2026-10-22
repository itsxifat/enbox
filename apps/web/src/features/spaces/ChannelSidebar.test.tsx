import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type ChatSummary, type SpaceCategory } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeMe } from '@/test/factories';
import { ChannelSidebar } from './ChannelSidebar';
import { makeSpace } from './testUtils';

const MANAGE = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.MANAGE_CHANNELS;
const cat = (id: string, position: number): SpaceCategory => ({ id, name: `Cat ${id}`, position, overwrites: [] });

function channel(id: string, categoryId: string | null, position: number, bits: number): ChatSummary {
  const c = makeChat({ id, name: id, type: 'space_text', spacePermissions: bits, lastSeq: 1, lastReadSeq: 1 });
  return {
    ...c,
    space: {
      spaceId: 's1',
      categoryId,
      position,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

function seed(manage: boolean) {
  const bits = manage ? MANAGE : PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;
  const space = makeSpace({ id: 's1', name: 'Lab', categories: [cat('x', 0), cat('y', 1)] });
  useSpaces.setState({
    byId: { s1: { ...space, myPermissions: manage ? MANAGE : 0 } },
    order: ['s1'],
    loaded: true,
    channelsLoaded: { s1: true },
  });
  useChats.setState({
    byId: Object.fromEntries(
      [channel('one', 'x', 0, bits), channel('two', 'x', 1, bits), channel('three', 'y', 0, bits)].map((c) => [c.id, c]),
    ),
  });
  render(
    <MemoryRouter>
      <ChannelSidebar spaceId="s1" />
    </MemoryRouter>,
  );
}

const rowNames = () => screen.getAllByTestId('space-channel-row').map((r) => r.getAttribute('data-channel-name'));

describe('ChannelSidebar reorder', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useChats.setState({ byId: {} });
    useSpaces.setState({ byId: {}, order: [], channelsLoaded: {} });
  });

  it('without MANAGE_CHANNELS nothing drags and the menus have no moves', () => {
    seed(false);
    expect(rowNames()).toEqual(['one', 'two', 'three']);
    expect(screen.getAllByTestId('space-channel-row').every((r) => !r.hasAttribute('aria-describedby'))).toBe(true);
    fireEvent.contextMenu(screen.getAllByTestId('space-channel-row')[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Move Down' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Mark As Read' })).toBeInTheDocument();
  });

  it('with it, rows drag (keyboard instructions attached) and Move Down sends only the changed positions', () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(undefined as never);
    seed(true);
    const [one] = screen.getAllByTestId('space-channel-row');
    expect(one).toHaveAttribute('aria-describedby');
    fireEvent.contextMenu(one!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Down' }));
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/channels/positions', {
      items: [
        { id: 'two', categoryId: 'x', position: 0 },
        { id: 'one', categoryId: 'x', position: 1 },
      ],
    });
    expect(rowNames()).toEqual(['two', 'one', 'three']);
  });

  it('a refused channel move goes back where it was', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('nope'));
    seed(true);
    fireEvent.contextMenu(screen.getAllByTestId('space-channel-row')[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Down' }));
    await vi.waitFor(() => expect(rowNames()).toEqual(['one', 'two', 'three']));
  });

  it('category Move Down: optimistic, one PATCH, reverted when refused', async () => {
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(new Error('nope'));
    seed(true);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cat x' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Down' }));
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/categories/positions', {
      items: [
        { id: 'y', position: 0 },
        { id: 'x', position: 1 },
      ],
    });
    await vi.waitFor(() => expect(rowNames()).toEqual(['one', 'two', 'three']));
    expect(useSpaces.getState().byId.s1!.categories.map((c) => [c.id, c.position])).toEqual([
      ['x', 0],
      ['y', 1],
    ]);
  });
});
