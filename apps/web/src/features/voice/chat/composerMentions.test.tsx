/**
 * The composer in a voice channel's text chat: @mentions suggest the Space's members (searched
 * on the server) like in a text channel, and picking one inserts the name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type ChatSummary, type SpaceMember } from '@enbox/shared';
import { Composer } from '@/features/conversation/composer/Composer';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';

const voice: ChatSummary = makeChat({
  id: 'v1',
  type: 'space_voice',
  name: 'General',
  space: {
    spaceId: 's1',
    categoryId: null,
    position: 0,
    topic: null,
    slowmodeSeconds: 0,
    nsfw: false,
    userLimit: null,
    bitrate: null,
    permissionsSynced: true,
    overwrites: [],
  },
  spacePermissions: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.CONNECT,
});

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useSpaces.setState({ byId: { s1: makeSpace({ id: 's1' }) }, order: ['s1'], loaded: true, members: {} });
  useUsers.setState({ byId: { ally: makeUser({ id: 'ally', displayName: 'Alice', username: 'ally' }) } });
});

afterEach(() => {
  useSpaces.setState({ byId: {}, order: [], members: {} });
  useUsers.setState({ byId: {} });
});

describe('composer in a voice chat', () => {
  it('suggests Space members after @ and inserts the picked one', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      members: [{ userId: 'ally', nickname: 'Ally', roleIds: [], joinedAt: '2026-01-01T00:00:00.000Z' } as unknown as SpaceMember],
      nextCursor: null,
    } as never);
    vi.spyOn(api, 'post').mockResolvedValue([] as never);
    render(<Composer chat={voice} />);
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@al', selectionStart: 3 } });
    const list = await screen.findByRole('listbox', { name: 'Mention someone' });
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/members', { query: { q: 'al', limit: 8 } });
    fireEvent.mouseDown(within(list).getByRole('option', { name: /Ally/ }));
    expect(box.value).toBe('@Ally ');
  });
});
