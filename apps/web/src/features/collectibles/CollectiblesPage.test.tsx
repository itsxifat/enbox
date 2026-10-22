import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Cosmetics from '@/components/cosmetics';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { COSMETIC_COLLECTIONS, NAMEPLATES, type UserSelf } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { COLLECTIBLES, NAME_STYLE_PRESETS } from './catalog';
import { CollectiblesPage } from './CollectiblesPage';
import { FAVOURITES_KEY, useFavourites } from './favourites';

// Effects are drawn by the cosmetics stream; a marker shows which one plays and how.
vi.mock('@/components/cosmetics', async (importOriginal) => {
  const actual = await importOriginal<typeof Cosmetics>();
  return {
    ...actual,
    ProfileEffect: ({ id, play }: { id: string | null | undefined; play?: string }) =>
      id ? <span data-testid="profile-effect" data-effect={id} data-play={play} /> : null,
  };
});

function mockPatch() {
  return vi.spyOn(api, 'patch').mockImplementation(async (_path: string, body: unknown) => {
    const me = useAuth.getState().user!;
    return { ...me, ...(body as Partial<UserSelf>) } as UserSelf;
  });
}

beforeEach(() => {
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Ada', avatarDecoration: 'orbit' }),
    token: 't',
    status: 'authenticated',
  });
  useUi.setState({ toasts: [] });
  useFavourites.setState({ keys: [] });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collectibles']}>
      <CollectiblesPage />
    </MemoryRouter>,
  );
}

const card = (key: string) =>
  screen.getAllByTestId('collectible-card').find((c) => c.dataset.key === key)!;
const lastToast = () => useUi.getState().toasts.at(-1)?.message;

describe('Collectibles', () => {
  it('has the hero, the category tabs and every item grouped by collection', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Collectibles — every item is free' }),
    ).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Categories' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([
      'All',
      'Avatar Decorations',
      'Profile Effects',
      'Nameplates',
      'Name Styles',
      'Favourites',
    ]);
    const sections = screen.getAllByTestId('collection-section');
    expect(sections.map((s) => s.dataset.collection)).toEqual(
      COSMETIC_COLLECTIONS.map((c) => c.id),
    );
    const cosmic = sections[0]!;
    expect(cosmic).toHaveTextContent('Cosmic');
    expect(cosmic).toHaveTextContent('Planets, stars and the space between them.');
    expect(screen.getAllByTestId('collectible-card')).toHaveLength(COLLECTIBLES.length);
  });

  it('category tabs filter the gallery', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Nameplates' }));
    expect(screen.getAllByTestId('collectible-card')).toHaveLength(NAMEPLATES.length);
    fireEvent.click(screen.getByRole('tab', { name: 'Name Styles' }));
    expect(screen.getAllByTestId('collectible-card')).toHaveLength(NAME_STYLE_PRESETS.length);
    expect(screen.getByRole('button', { name: 'Starship, Name Style' })).toBeInTheDocument();
  });

  it('marks what I wear as Equipped', () => {
    renderPage();
    expect(card('decoration:orbit')).toHaveTextContent('Equipped');
    expect(
      screen.getByRole('button', { name: 'Orbit, Avatar Decoration, equipped' }),
    ).toBeInTheDocument();
    expect(card('decoration:halo')).not.toHaveTextContent('Equipped');
    expect(screen.getAllByText('Equipped')).toHaveLength(1);
  });

  it('cards animate only while hovered or focused', () => {
    renderPage();
    const c = card('effect:aurora');
    expect(c).not.toHaveAttribute('data-hot');
    fireEvent.pointerEnter(c);
    expect(c).toHaveAttribute('data-hot', 'true');
    fireEvent.pointerLeave(c);
    expect(c).not.toHaveAttribute('data-hot');
    fireEvent.focus(within(c).getByRole('button', { name: 'Aurora, Profile Effect' }));
    expect(c).toHaveAttribute('data-hot', 'true');
  });

  it('the heart keeps favourites on this device and the Favourites tab lists them', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Favourites' }));
    expect(screen.getByText('No favourites yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));

    const heart = screen.getByRole('button', { name: 'Add Halo to favourites' });
    fireEvent.click(heart);
    expect(screen.getByRole('button', { name: 'Remove Halo from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual(['decoration:halo']);

    fireEvent.click(screen.getByRole('tab', { name: /Favourites/ }));
    expect(screen.getAllByTestId('collectible-card').map((c) => c.dataset.key)).toEqual([
      'decoration:halo',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Halo from favourites' }));
    expect(screen.getByText('No favourites yet')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([]);
  });

  it('favourites survive storage that throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Halo to favourites' }));
    expect(screen.getByRole('button', { name: 'Remove Halo from favourites' })).toBeInTheDocument();
    useFavourites.getState().reload();
    expect(useFavourites.getState().keys).toEqual([]);
  });

  it('details: try-on on my card, Equip and Unequip send one field each', async () => {
    const patch = mockPatch();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Halo, Avatar Decoration' }));
    const dialog = screen.getByRole('dialog', { name: 'Halo' });
    expect(dialog).toHaveTextContent('Avatar Decoration · Fantasy collection');
    expect(
      within(dialog).getByTestId('try-on').querySelector('[data-testid="profile-card"]'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Equip' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', { avatarDecoration: 'halo' }),
    );
    expect(lastToast()).toBe('Halo equipped');
    expect(await within(dialog).findByRole('button', { name: 'Unequip' })).toBeInTheDocument();
    expect(useAuth.getState().user?.avatarDecoration).toBe('halo');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unequip' }));
    await waitFor(() =>
      expect(patch).toHaveBeenLastCalledWith('/api/me', { avatarDecoration: null }),
    );
    expect(lastToast()).toBe('Halo unequipped');
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('effects loop over the try-on card; name styles equip their whole style', async () => {
    const patch = mockPatch();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Aurora, Profile Effect' }));
    let dialog = screen.getByRole('dialog', { name: 'Aurora' });
    const effect = within(within(dialog).getByTestId('try-on')).getByTestId('profile-effect');
    expect(effect).toHaveAttribute('data-effect', 'aurora');
    expect(effect).toHaveAttribute('data-play', 'loop');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Starship, Name Style' }));
    dialog = screen.getByRole('dialog', { name: 'Starship' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Equip' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/me', {
        nameStyle: { font: 'orbitron', effect: 'gradient', colors: ['#7dd3fc', '#c084fc'] },
      }),
    );
    expect(await within(dialog).findByRole('button', { name: 'Unequip' })).toBeInTheDocument();
  });
});
