/**
 * Settings ▸ Profiles ▸ Server Tag: my Spaces that have a tag (pill and name) and None, the
 * one I wear checked; a pick saves at once and my profile in the users store follows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SpaceTag } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe, makeUser } from '@/test/factories';
import { ServerTagField } from './ServerTagField';

const rkt: SpaceTag = { tag: 'RKT', badge: 'rocket', color: '#ff8800' };
const qc: SpaceTag = { tag: 'QC', badge: 'moon', color: '#336699' };
const me = makeMe({ id: 'me' });

function seed(...spaces: ReturnType<typeof makeSpace>[]) {
  useSpaces.setState({
    byId: Object.fromEntries(spaces.map((s) => [s.id, s])),
    order: spaces.map((s) => s.id),
    loaded: true,
  });
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name });

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: me, token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('ServerTagField', () => {
  it('lists my Spaces that have a tag and None, with the one I wear checked', async () => {
    vi.spyOn(api, 'post').mockResolvedValue([
      makeUser({ id: 'me', spaceTag: { ...rkt, spaceId: 's1' } }),
    ] as never);
    seed(
      makeSpace({ id: 's1', name: 'Rocket Club', tag: rkt }),
      makeSpace({ id: 's2', name: 'Quiet Corner', tag: qc }),
      makeSpace({ id: 's3', name: 'No Tag Here' }),
    );
    render(<ServerTagField me={me} />);
    const group = screen.getByRole('radiogroup', { name: 'Server Tag' });
    await waitFor(() => expect(radio(/Rocket Club/)).toHaveAttribute('aria-checked', 'true'));
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(radio('None')).toHaveAttribute('aria-checked', 'false');
    expect(radio(/Quiet Corner/)).toHaveAttribute('aria-checked', 'false');
    expect(within(radio(/Quiet Corner/)).getByTestId('server-tag')).toHaveTextContent('QC');
    expect(screen.queryByText('No Tag Here')).toBeNull();
  });

  it('a pick saves at once and my profile follows; None takes it off', async () => {
    vi.spyOn(api, 'post').mockResolvedValue([makeUser({ id: 'me', spaceTag: null })] as never);
    const put = vi.spyOn(api, 'put').mockImplementation(
      async (_path: string, body: unknown) =>
        makeUser({
          id: 'me',
          spaceTag: (body as { spaceId: string | null }).spaceId ? { ...qc, spaceId: 's2' } : null,
        }) as never,
    );
    seed(
      makeSpace({ id: 's1', name: 'Rocket Club', tag: rkt }),
      makeSpace({ id: 's2', name: 'Quiet Corner', tag: qc }),
    );
    render(<ServerTagField me={me} />);
    await waitFor(() => expect(useUsers.getState().byId.me).toBeDefined());
    expect(radio('None')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(radio(/Quiet Corner/));
    await waitFor(() => expect(radio(/Quiet Corner/)).toHaveAttribute('aria-checked', 'true'));
    expect(put).toHaveBeenCalledWith('/api/me/space-tag', { spaceId: 's2' });
    expect(useUsers.getState().byId.me!.spaceTag).toEqual({ ...qc, spaceId: 's2' });
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ message: 'Tag updated' });

    // The one I wear again: nothing to send.
    fireEvent.click(radio(/Quiet Corner/));
    expect(put).toHaveBeenCalledTimes(1);

    fireEvent.click(radio('None'));
    await waitFor(() => expect(radio('None')).toHaveAttribute('aria-checked', 'true'));
    expect(put).toHaveBeenLastCalledWith('/api/me/space-tag', { spaceId: null });
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ message: 'Tag taken off' });
  });

  it('none of my Spaces has a tag: says so, and my profile is not even loaded', async () => {
    const post = vi.spyOn(api, 'post');
    seed(makeSpace({ id: 's3', name: 'No Tag Here' }));
    render(<ServerTagField me={me} />);
    expect(screen.getByText('None of your Spaces has a tag yet.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(post).not.toHaveBeenCalled();
  });
});
