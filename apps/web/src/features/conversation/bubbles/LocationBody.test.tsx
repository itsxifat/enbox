/**
 * SEC-6: a location bubble never contacts OpenStreetMap on its own (viewer IP + ~1 km area);
 * the tile loads only after "Show map".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resetSessionState } from '@/lib/session';
import { makeMessage } from '@/test/factories';
import { LocationBody } from './CardBodies';

const message = makeMessage({
  type: 'location',
  location: { latitude: 48.8584, longitude: 2.2945, name: 'Eiffel Tower', address: null },
});

const tiles = (c: HTMLElement) =>
  [...c.querySelectorAll('img')].filter((i) => i.src.includes('tile.openstreetmap.org'));

afterEach(() => resetSessionState());

describe('LocationBody map preview', () => {
  it('shows no third-party tile until the viewer asks for it', () => {
    const { container, unmount } = render(<LocationBody m={message} rounded="rounded-xl" />);
    expect(tiles(container)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Show map/ }));
    expect(tiles(container)).toHaveLength(1);
    expect(tiles(container)[0]!.src).toMatch(
      /^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/,
    );
    expect(screen.queryByRole('button', { name: /Show map/ })).toBeNull();
    unmount();

    // Remembered for this session (e.g. scrolling the bubble back into view)…
    const again = render(<LocationBody m={message} rounded="rounded-xl" />);
    expect(tiles(again.container)).toHaveLength(1);
    again.unmount();

    // …but not across a logout.
    resetSessionState();
    const fresh = render(<LocationBody m={message} rounded="rounded-xl" />);
    expect(tiles(fresh.container)).toHaveLength(0);
  });

  it('keeps the whole preview a link to the map', () => {
    render(<LocationBody m={message} rounded="rounded-xl" />);
    expect(screen.getByRole('link', { name: /Open Eiffel Tower in maps/ })).toHaveAttribute(
      'href',
      expect.stringContaining('openstreetmap.org/?mlat=48.8584'),
    );
  });
});
