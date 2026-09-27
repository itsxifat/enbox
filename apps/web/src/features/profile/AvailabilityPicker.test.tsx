import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UserSelf } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { AvailabilityPicker } from './AvailabilityPicker';

const MINUTE = 60_000;

function minutesFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / MINUTE);
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

/** `api.put` echoes the request as the new UserSelf (what the server does). */
function mockPut() {
  return vi.spyOn(api, 'put').mockImplementation(async (_path: string, body: unknown) => {
    const b = body as { availability: UserSelf['availability']; until: string | null };
    return makeMe({ id: 'me', availability: b.availability, availabilityUntil: b.until });
  });
}

describe('AvailabilityPicker', () => {
  it('shows the current choice and lists the four states', () => {
    render(<AvailabilityPicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Availability: Online' }));
    const menu = screen.getByRole('menu', { name: 'Availability' });
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    expect(screen.getByRole('menuitem', { name: 'Invisible' })).toBeInTheDocument();
  });

  it('Do not disturb asks for a duration, then PUTs the choice with its expiry', async () => {
    const put = mockPut();
    render(<AvailabilityPicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Availability: Online' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Do not disturb' }));
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(
      screen
        .getByRole('menu', { name: 'Do not disturb for how long?' })
        .querySelector('[role="menuitem"]')!,
    );
    // The first duration is 30 minutes.
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0]! as [string, { availability: string; until: string }];
    expect(path).toBe('/api/me/presence');
    expect(body.availability).toBe('dnd');
    expect(minutesFromNow(body.until)).toBe(30);
    // The echoed profile updates the picker.
    await screen.findByRole('button', { name: 'Availability: Do not disturb' });
    expect(useAuth.getState().user?.availability).toBe('dnd');
    expect(screen.getByRole('button', { name: /Do not disturb/ })).toHaveTextContent(/Until /);
  });

  it.each([
    ['For 1 hour', 60],
    ['For 8 hours', 8 * 60],
  ])('%s → until now + %i minutes', async (label, minutes) => {
    const put = mockPut();
    render(<AvailabilityPicker />);
    fireEvent.click(screen.getByRole('button', { name: /Availability/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Idle' }));
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const body = put.mock.calls[0]![1] as { availability: string; until: string };
    expect(body.availability).toBe('idle');
    expect(minutesFromNow(body.until)).toBe(minutes);
  });

  it('"Until I change it" sends no expiry; Online clears the choice at once', async () => {
    const put = mockPut();
    render(<AvailabilityPicker />);
    fireEvent.click(screen.getByRole('button', { name: /Availability/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Invisible' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Until I change it' }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith('/api/me/presence', {
        availability: 'invisible',
        until: null,
      }),
    );
    await screen.findByRole('button', { name: 'Availability: Invisible' });

    fireEvent.click(screen.getByRole('button', { name: 'Availability: Invisible' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Online' }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith('/api/me/presence', {
        availability: 'online',
        until: null,
      }),
    );
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('an expired choice shows as Online (the expiry job catches up later)', () => {
    useAuth.setState({
      user: makeMe({ id: 'me', availability: 'dnd', availabilityUntil: '2000-01-01T00:00:00Z' }),
    });
    render(<AvailabilityPicker />);
    expect(screen.getByRole('button', { name: 'Availability: Online' })).toBeInTheDocument();
  });
});
