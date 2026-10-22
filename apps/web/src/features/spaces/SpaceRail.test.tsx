import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { RailEntry } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useRail } from '@/stores/rail';
import { useSpaces } from '@/stores/spaces';
import { makeMe } from '@/test/factories';
import { SpaceRail } from './SpaceRail';
import { makeSpace } from './testUtils';

const layout: RailEntry[] = [
  { kind: 'space', id: 'a' },
  { kind: 'folder', folder: { id: 'f', name: null, color: null, spaceIds: ['b', 'c'] } },
];

function renderRail() {
  const spaces = ['a', 'b', 'c'].map((id) => makeSpace({ id, name: `Space ${id.toUpperCase()}` }));
  useSpaces.setState({ byId: Object.fromEntries(spaces.map((s) => [s.id, s])), order: spaces.map((s) => s.id), loaded: true });
  useAuth.setState({ user: makeMe({ id: 'me', railLayout: layout }), token: 't', status: 'authenticated' });
  useRail.setState({ layout, open: {} });
  return render(
    <MemoryRouter initialEntries={['/spaces']}>
      <SpaceRail />
    </MemoryRouter>,
  );
}

const tiles = () => screen.getAllByTestId('space-tile').map((t) => t.getAttribute('aria-label'));

describe('SpaceRail', () => {
  let put: MockInstance<typeof api.put>;
  beforeEach(() => {
    vi.useFakeTimers();
    put = vi
      .spyOn(api, 'put')
      .mockImplementation((async (_path: string, body?: unknown) => (body as { items: RailEntry[] }).items) as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useSpaces.setState({ byId: {}, order: [] });
  });

  it('shows my order with a closed folder; clicking it opens it (per device)', () => {
    renderRail();
    expect(tiles()).toEqual(['Space A']);
    const folder = screen.getByRole('button', { name: 'Space B, Space C, folder' });
    expect(folder).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(folder);
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    expect(tiles()).toEqual(['Space A', 'Space B', 'Space C']);
    expect(JSON.parse(localStorage.getItem('enbox.rail.openFolders')!)).toEqual({ f: true });
  });

  it('Alt+Shift+↓ moves the focused Space (handled, so the app-wide shortcut skips it) and saves', async () => {
    renderRail();
    const [a] = screen.getAllByTestId('space-tile');
    const notPrevented = fireEvent.keyDown(a!, { key: 'ArrowDown', altKey: true, shiftKey: true });
    expect(notPrevented).toBe(false);
    expect(useRail.getState().layout.map((e) => (e.kind === 'space' ? e.id : e.folder.id))).toEqual(['f', 'a']);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledWith('/api/me/rail-layout', { items: [layout[1], layout[0]] });
  });

  it('folder menu: Folder Settings renames and recolours it', async () => {
    renderRail();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Space B, Space C, folder' }));
    expect(screen.getByRole('menuitem', { name: 'Mark Folder As Read' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Expand Folder' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Folder Settings' }));
    fireEvent.change(screen.getByTestId('folder-name-input'), { target: { value: 'Games' } });
    fireEvent.click(screen.getByRole('button', { name: '#ef4444' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Games, folder' })).toBeInTheDocument();
    const folder = useRail.getState().layout[1];
    expect(folder?.kind === 'folder' && [folder.folder.name, folder.folder.color]).toEqual(['Games', '#ef4444']);
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
