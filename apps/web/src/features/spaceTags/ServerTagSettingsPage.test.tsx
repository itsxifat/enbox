/**
 * Space Settings ▸ Server Tag: live validation and preview, Save (the Space and the cached
 * wearers follow), Reset, Remove Tag after a confirmation, and wearing it from here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SpaceTag, UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpace, useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe, makeUser } from '@/test/factories';
import { ServerTagSettingsPage } from './ServerTagSettingsPage';

const rkt: SpaceTag = { tag: 'RKT', badge: 'rocket', color: '#ff8800' };

function Page() {
  const space = useSpace('s1');
  return space ? <ServerTagSettingsPage space={space} /> : null;
}

function setup(tag: SpaceTag | null) {
  useSpaces.setState({
    byId: { s1: makeSpace({ id: 's1', name: 'Rocket Club', owner: true, tag }) },
    order: ['s1'],
    loaded: true,
  });
  render(<Page />);
}

const tagInput = () => screen.getByRole('textbox', { name: 'Tag' });
const type = (value: string) => fireEvent.change(tagInput(), { target: { value } });
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const lastToast = () => useUi.getState().toasts.at(-1);

beforeEach(() => {
  resetSessionState();
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Ada' }),
    token: 't',
    status: 'authenticated',
  });
  useUi.setState({ toasts: [], dialogs: [] });
  // My own profile (who wears what), asked for once the Space has a tag.
  vi.spyOn(api, 'post').mockImplementation(
    async (_path: string, body: unknown) =>
      (body as { userIds: string[] }).userIds.map((id) =>
        makeUser({ id, spaceTag: null }),
      ) as never,
  );
});

describe('ServerTagSettingsPage', () => {
  it('validates as I type, previews light and dark, and saves the tag', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockImplementation(async (_path: string, body: unknown) => body as never);
    setup(null);
    expect(bar()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Tag' })).toBeNull();

    type('R');
    expect(screen.getByRole('alert')).toHaveTextContent('Use 2 to 4 letters or numbers');
    expect(screen.getByText('1/4')).toBeInTheDocument();
    expect(within(bar()!).getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    type('ROCKT');
    expect(screen.getByText('5/4')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Use 2 to 4 letters or numbers');
    type('R!');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    type(' RKT ');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('3/4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }));
    expect(screen.getByRole('button', { name: 'Rocket' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Leaf' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '#ef4444' }));

    for (const theme of ['light', 'dark']) {
      const preview = screen.getByTestId(`tag-preview-${theme}`);
      expect(preview).toHaveTextContent('Ada');
      const pill = within(preview).getByTestId('server-tag');
      expect(pill).toHaveTextContent('RKT');
      expect(pill.querySelector('svg')).toHaveAttribute('stroke', '#ef4444');
    }
    expect(screen.getByTestId('tag-preview-dark')).toHaveClass('dark');
    expect(screen.getByTestId('tag-preview-light')).not.toHaveClass('dark');

    fireEvent.click(within(bar()!).getByRole('button', { name: 'Save Changes' }));
    const saved: SpaceTag = { tag: 'RKT', badge: 'rocket', color: '#ef4444' };
    await waitFor(() => expect(useSpaces.getState().byId.s1!.tag).toEqual(saved));
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/tag', saved);
    expect(lastToast()).toMatchObject({ message: 'Tag saved' });
    expect(bar()).toBeNull();
    expect(tagInput()).toHaveValue('RKT');
    expect(screen.getByRole('button', { name: 'Remove Tag' })).toBeInTheDocument();
  });

  it('edits an existing tag (Reset, Save: its wearers follow) and removes it after a confirmation', async () => {
    useUsers.getState().upsertUsers([makeUser({ id: 'ann', spaceTag: { ...rkt, spaceId: 's1' } })]);
    vi.spyOn(api, 'put').mockImplementation(async (_path: string, body: unknown) => body as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    setup(rkt);
    expect(tagInput()).toHaveValue('RKT');
    expect(screen.getByRole('button', { name: 'Rocket' })).toHaveAttribute('aria-pressed', 'true');

    type('RK7');
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Reset' }));
    expect(tagInput()).toHaveValue('RKT');
    expect(bar()).toBeNull();

    type('RK7');
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(useUsers.getState().byId.ann!.spaceTag?.tag).toBe('RK7'));
    expect(lastToast()).toMatchObject({ message: 'Tag updated' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Tag' }));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Remove the tag?');
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/spaces/s1/tag'));
    await waitFor(() => expect(useSpaces.getState().byId.s1!.tag).toBeNull());
    expect(useUsers.getState().byId.ann!.spaceTag).toBeNull();
    expect(lastToast()).toMatchObject({ message: 'Tag removed' });
    expect(tagInput()).toHaveValue('');
  });

  it('cancelling the confirmation keeps the tag', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    setup(rkt);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tag' }));
    act(() => useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, null));
    await new Promise((r) => setTimeout(r, 0));
    expect(del).not.toHaveBeenCalled();
    expect(useSpaces.getState().byId.s1!.tag).toEqual(rkt);
  });

  it('whoever edits it can wear it from here', async () => {
    const me: UserPublic = makeUser({ id: 'me', spaceTag: { ...rkt, spaceId: 's1' } });
    const put = vi.spyOn(api, 'put').mockResolvedValue(me as never);
    setup(rkt);
    fireEvent.click(await screen.findByRole('button', { name: 'Wear this tag' }));
    expect(await screen.findByText('You wear this tag.')).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith('/api/me/space-tag', { spaceId: 's1' });
    expect(useUsers.getState().byId.me!.spaceTag).toEqual({ ...rkt, spaceId: 's1' });
  });
});
