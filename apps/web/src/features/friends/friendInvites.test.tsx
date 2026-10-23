/**
 * Friend invite links: "Or share a link" (create, copy, the expiry and uses left, revoke all)
 * and the /friend/:code page (whose link, Accept, my own link, a dead link).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { FriendInvite, FriendInvitePreview } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useStreamer } from '@/stores/streamer';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { FriendInvitePage } from './FriendInvitePage';
import { FriendInviteLinks, expiresInText, usesLeftText } from './FriendInviteLinks';

const CODE = 'AbCdEfGhJkMnPqRsTuVwXy';
const DAY = 86_400_000;
const invite = (p: Partial<FriendInvite> = {}): FriendInvite => ({
  code: CODE,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 7 * DAY - 1000).toISOString(),
  uses: 0,
  maxUses: 5,
  ...p,
});
const ann = makeUser({ id: 'ann', username: 'ann', displayName: 'Ann' });

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useStreamer.setState({ enabled: false });
});

describe('the expiry and uses lines', () => {
  it('counts days, then hours, then minutes', () => {
    const now = Date.parse('2026-10-23T12:00:00.000Z');
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(expiresInText(at(7 * DAY - 1000), now)).toBe('Expires in 6 days');
    expect(expiresInText(at(DAY + 5), now)).toBe('Expires in 1 day');
    expect(expiresInText(at(5 * 3_600_000 + 10), now)).toBe('Expires in 5 hours');
    expect(expiresInText(at(90_000), now)).toBe('Expires in 2 minutes');
    expect(expiresInText(at(-5), now)).toBe('Expires in 1 minute');
    expect(usesLeftText({ uses: 2, maxUses: 5 })).toBe('3 of 5 uses left');
  });
});

describe('Or share a link', () => {
  it('creates a link, shows it with its expiry and uses, and copies it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue(invite() as never);
    render(<FriendInviteLinks />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Invite Link' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/me/friend-invites'));
    expect(await screen.findByTestId('friend-invite-url')).toHaveTextContent(`/friend/${CODE}`);
    expect(screen.getByTestId('friend-invite-meta')).toHaveTextContent(
      'Expires in 6 days · 5 of 5 uses left',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/friend/${CODE}$`))),
    );
  });

  it('shows my newest live link; Revoke all asks, then they are gone', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      invite({ uses: 3 }),
      invite({ code: 'X'.repeat(22) }),
    ] as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    render(<FriendInviteLinks />);
    expect(await screen.findByTestId('friend-invite-meta')).toHaveTextContent(
      '2 of 5 uses left · 2 active links',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog).toMatchObject({ confirmLabel: 'Revoke all', danger: true });
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/me/friend-invites'));
    expect(await screen.findByRole('button', { name: 'Create Invite Link' })).toBeInTheDocument();
  });

  it('Streamer Mode hides the link on screen', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([invite()] as never);
    useStreamer.setState({ enabled: true, hideInvites: true });
    render(<FriendInviteLinks />);
    expect(await screen.findByTestId('friend-invite-url')).not.toHaveTextContent(CODE);
  });
});

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname}</span>;
}

function renderPage(code = CODE) {
  return render(
    <MemoryRouter initialEntries={[`/friend/${code}`]}>
      <Routes>
        <Route path="/friend/:code" element={<FriendInvitePage />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('the /friend/:code page', () => {
  const preview = (p: Partial<FriendInvitePreview> = {}): FriendInvitePreview => ({
    inviter: ann,
    expiresAt: new Date(Date.now() + 3 * DAY + 60_000).toISOString(),
    ...p,
  });

  /** The preview, and what accepting resyncs (contacts, requests). */
  const serve = (p: FriendInvitePreview) =>
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === `/api/friend-invites/${CODE}`) return p;
      if (path === '/api/friends/requests') return { incoming: [], outgoing: [] };
      return [];
    });

  it('shows whose link it is; Accept makes us friends, then Send Message opens our DM', async () => {
    serve(preview());
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      if (path === `/api/friend-invites/${CODE}/accept`)
        return { status: 'friends', userId: 'ann' };
      if (path === '/api/chats/direct') return makeChat({ id: 'd1', type: 'direct', peer: ann });
      throw new Error(`unexpected POST ${path}`);
    });
    renderPage();
    const card = await screen.findByTestId('friend-invite-preview');
    expect(card).toHaveTextContent('Ann');
    expect(card).toHaveTextContent('@ann');
    expect(card).toHaveTextContent('Ann invited you to be friends. Expires in 3 days.');
    fireEvent.click(screen.getByRole('button', { name: 'Accept Invite' }));
    expect(await screen.findByText('You and Ann are now friends.')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(`/api/friend-invites/${CODE}/accept`);
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/chats/d1'));
  });

  it('already friends says so', async () => {
    serve(preview());
    vi.spyOn(api, 'post').mockResolvedValue({ status: 'already_friends', userId: 'ann' } as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept Invite' }));
    expect(await screen.findByText("You're already friends with Ann.")).toBeInTheDocument();
  });

  it('my own link has nothing to accept', async () => {
    serve(preview({ inviter: makeUser({ id: 'me', username: 'me', displayName: 'Me' }) }));
    renderPage();
    expect(await screen.findByText('Your invite link')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept Invite' })).toBeNull();
  });

  it('a dead link (404) and a malformed code are not valid', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValue(new ApiError('not_found', 'Invite not found', 404));
    const { unmount } = renderPage();
    expect(await screen.findByText("This invite link isn't valid")).toBeInTheDocument();
    unmount();
    get.mockClear();
    renderPage('nope');
    expect(await screen.findByText("This invite link isn't valid")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
