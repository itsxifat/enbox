import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { InvitePreview } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeChat } from '@/test/factories';
import { useChats } from '@/stores/chats';
import { JoinInvitePage, invitePath } from './JoinInvitePage';

const CODE = 'ABCDEFGHJKLMNPQRSTUVWX';

function preview(p: Partial<InvitePreview> = {}): InvitePreview {
  return {
    code: CODE,
    kind: 'group',
    id: 'g1',
    name: 'Weekend Hiking',
    description: 'Saturday hikes',
    avatarUrl: null,
    memberCount: 4,
    communityId: null,
    communityName: null,
    isMember: false,
    canJoin: true,
    reason: null,
    ...p,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join/:code" element={<JoinInvitePage />} />
        <Route path="/chats/:chatId" element={<p>chat opened</p>} />
        <Route path="/updates/channels/:chatId" element={<p>channel opened</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JoinInvitePage', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
  });

  it('maps targets to routes', () => {
    expect(invitePath('group', 'x')).toBe('/chats/x');
    expect(invitePath('channel', 'x')).toBe('/updates/channels/x');
    expect(invitePath('community', 'x')).toBe('/communities/x');
  });

  it('rejects malformed codes without calling the API', async () => {
    const get = vi.spyOn(api, 'get');
    renderAt('/join/nope');
    expect(await screen.findByText("This invite link isn't valid")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows reset/unknown links as invalid', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('not_found', 'Invite not found', 404));
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText("This invite link isn't valid")).toBeInTheDocument();
  });

  it('previews a community group and joins it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      preview({ communityId: 'c1', communityName: 'Outdoors' }),
    );
    const chat = makeChat({ id: 'g1', name: 'Weekend Hiking' });
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ kind: 'group', id: 'g1', chat, community: null });
    renderAt(`/join/${CODE}`);
    expect(await screen.findByText('Weekend Hiking')).toBeInTheDocument();
    expect(screen.getByText('Outdoors')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
    await waitFor(() => expect(screen.getByText('chat opened')).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith(`/api/invites/${CODE}/join`);
    expect(useChats.getState().byId.g1).toBeDefined();
  });

  it('explains why joining is not possible', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      preview({ canJoin: false, reason: 'You were removed by an admin' }),
    );
    renderAt(`/join/${CODE}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('You were removed by an admin');
    expect(screen.getByRole('button', { name: 'Join group' })).toBeDisabled();
  });

  it('offers to open a channel already followed', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      preview({ kind: 'channel', id: 'ch1', isMember: true, canJoin: false }),
    );
    renderAt(`/join/${CODE}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Open channel' }));
    expect(await screen.findByText('channel opened')).toBeInTheDocument();
  });
});
