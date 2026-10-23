import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { PERM, type SpaceReport, type SpaceReportPage } from '@enbox/shared';
import { DialogHost } from '@/components/ui';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeMessage, makeUser } from '@/test/factories';
import { ReportsPage } from './ReportsPage';

const space = makeSpace({
  id: 's1',
  myPermissions: PERM.MANAGE_MESSAGES | PERM.KICK_MEMBERS | PERM.BAN_MEMBERS,
});

function messageReport(p: Partial<SpaceReport> = {}): SpaceReport {
  return {
    id: 'r1',
    spaceId: 's1',
    targetType: 'message',
    targetId: 'm1',
    category: 'spam',
    details: 'Posts this every hour',
    evidence: {
      message: {
        id: 'm1',
        chatId: 'c1',
        senderId: 'pest',
        text: 'Cheap followers here',
        mediaUrls: ['/uploads/a/pic.png', '/uploads/a/notes.pdf'],
        createdAt: '2026-10-20T10:00:00.000Z',
      },
      user: { id: 'pest', username: 'pest', displayName: 'Pest' },
      space: { id: 's1', name: 'Space' },
    },
    status: 'open',
    createdAt: '2026-10-20T10:05:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    ...p,
  };
}

const page = (reports: SpaceReport[], nextCursor: string | null = null): SpaceReportPage => ({
  reports,
  nextCursor,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/spaces/s1/settings/reports']}>
      <Routes>
        <Route path="/spaces/s1/settings/reports" element={<ReportsPage space={space} />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <DialogHost />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([makeUser({ id: 'pest', displayName: 'Pest' })]);
  useUi.setState({ toasts: [], dialogs: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Space Settings ▸ Reports', () => {
  it('shows the report with its evidence and resolves it', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(page([messageReport()]));
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue(messageReport({ status: 'resolved', resolvedBy: 'me' }));
    renderPage();
    const card = await screen.findByRole('article', { name: 'Spam report' });
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/reports', {
      query: { status: 'open', limit: 25, before: undefined },
    });
    expect(within(card).getByText('Cheap followers here')).toBeInTheDocument();
    expect(within(card).getByText('Posts this every hour')).toBeInTheDocument();
    expect(within(card).getByText('Pest')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Reported file' })).toHaveAttribute(
      'src',
      expect.stringContaining('/uploads/a/pic.png'),
    );
    expect(within(card).getByRole('link', { name: /notes\.pdf/ })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Resolve' }));
    });
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/reports/r1', { status: 'resolved' });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText('No open reports')).toBeInTheDocument();
  });

  it('switches tabs and offers Reopen on closed reports', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(
        page([
          messageReport({
            status: 'dismissed',
            resolvedAt: '2026-10-21T00:00:00.000Z',
            resolvedBy: 'me',
          }),
        ]),
      );
    renderPage();
    expect(await screen.findByText('No open reports')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed' }));
    const card = await screen.findByRole('article', { name: 'Spam report' });
    expect(get).toHaveBeenLastCalledWith('/api/spaces/s1/reports', {
      query: { status: 'dismissed', limit: 25, before: undefined },
    });
    expect(within(card).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('jumps to the message while it exists, and says so when it is gone', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/spaces/s1/reports') return page([messageReport()]);
      if (path === '/api/messages/m1')
        return makeMessage({ id: 'm1', chatId: 'c1', seq: 42, senderId: 'pest' });
      throw new Error(`unexpected ${path}`);
    });
    renderPage();
    const card = await screen.findByRole('article', { name: 'Spam report' });
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Jump to message' }));
    });
    expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/c1?m=42&mid=m1');
  });

  it('a deleted message: Jump is disabled after the lookup fails', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/spaces/s1/reports') return page([messageReport()]);
      throw new Error('Message not found');
    });
    renderPage();
    const card = await screen.findByRole('article', { name: 'Spam report' });
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Jump to message' }));
    });
    expect(within(card).getByRole('button', { name: 'Jump to message' })).toBeDisabled();
    expect(within(card).getByText('The message has since been deleted.')).toBeInTheDocument();
  });

  it('moderation actions: delete the message, kick and ban the author', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(page([messageReport()]));
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    const put = vi.spyOn(api, 'put').mockResolvedValue(undefined);
    renderPage();
    const card = await screen.findByRole('article', { name: 'Spam report' });
    const confirmWith = async (confirmLabel: string) => {
      const dialog = await screen.findByRole('dialog');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: confirmLabel }));
      });
    };
    const act1 = async (label: string, confirmLabel: string) => {
      fireEvent.click(within(card).getByRole('button', { name: 'Take action' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: label }));
      await confirmWith(confirmLabel);
    };
    fireEvent.click(within(card).getByRole('button', { name: 'Take action' }));
    expect(await screen.findByRole('menuitem', { name: 'Kick Pest' })).toBeInTheDocument();
    // No MODERATE_MEMBERS: no timeout.
    expect(screen.queryByRole('menuitem', { name: /Time out/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Message' }));
    await confirmWith('Delete');
    expect(del).toHaveBeenCalledWith('/api/messages/m1', undefined, { query: { for: 'everyone' } });
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Jump to message' })).toBeDisabled(),
    );

    await act1('Kick Pest', 'Kick');
    expect(del).toHaveBeenLastCalledWith('/api/spaces/s1/members/pest');

    await act1('Ban Pest', 'Ban');
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/bans/pest', { reason: 'Reported: Spam' });
  });
});
