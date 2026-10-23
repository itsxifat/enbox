import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useContacts } from '@/stores/contacts';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeUser } from '@/test/factories';
import { openReport, useReport } from './report';
import { ReportDialogHost } from './ReportDialogHost';

// The host loads the dialog lazily: warm the module so the first test doesn't wait for it.
beforeAll(async () => {
  await import('./ReportDialog');
});

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([makeUser({ id: 'bob', displayName: 'Bob' })]);
  useUi.setState({ toasts: [], dialogs: [] });
  useContacts.setState({ syncBlocks: vi.fn(async () => undefined) });
});
afterEach(() => {
  vi.restoreAllMocks();
  act(() => useReport.getState().close());
});

async function openFor(target: Parameters<typeof openReport>[0]) {
  render(<ReportDialogHost />);
  act(() => openReport(target));
  return screen.findByRole('dialog');
}

describe('report dialog', () => {
  it('steps through category, details and also-block, then thanks', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'r1' });
    const dialog = await openFor({
      targetType: 'message',
      targetId: 'm1',
      userId: 'bob',
      label: 'Bob',
    });
    expect(within(dialog).getByText('Report Message')).toBeInTheDocument();
    expect(within(dialog).getByText('Message from Bob')).toBeInTheDocument();
    expect(within(dialog).getByText('What’s wrong?')).toBeInTheDocument();
    const next = within(dialog).getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Spam/ }));
    fireEvent.click(next);

    fireEvent.change(within(dialog).getByLabelText('Details (optional)'), {
      target: { value: '  so much spam  ' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Also block Bob/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    });
    expect(post).toHaveBeenCalledWith('/api/reports', {
      targetType: 'message',
      targetId: 'm1',
      category: 'spam',
      details: 'so much spam',
      alsoBlock: true,
    });
    expect(await screen.findByText('Thanks for letting us know')).toBeInTheDocument();
    expect(screen.getByText('You blocked Bob.')).toBeInTheDocument();
    expect(useContacts.getState().syncBlocks).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(useReport.getState().target).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Back keeps the choice; a Space report has no block step and sends no details when empty', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'r2' });
    const dialog = await openFor({
      targetType: 'space',
      targetId: 's1',
      userId: null,
      label: 'Gaming',
    });
    expect(within(dialog).getByText('Report Space')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Illegal activity/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('radio', { name: /Illegal activity/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    });
    expect(post).toHaveBeenCalledWith('/api/reports', {
      targetType: 'space',
      targetId: 's1',
      category: 'illegal',
    });
    expect(await screen.findByText('Thanks for letting us know')).toBeInTheDocument();
    expect(screen.queryByText(/You blocked/)).not.toBeInTheDocument();
  });

  it('offers no block for someone already blocked, and stays on the form when sending fails', async () => {
    useUsers.getState().upsertUsers([makeUser({ id: 'bob', displayName: 'Bob', isBlocked: true })]);
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Too many requests, slow down'));
    const dialog = await openFor({
      targetType: 'user',
      targetId: 'bob',
      userId: 'bob',
      label: 'Bob',
    });
    expect(within(dialog).getByText('Report User')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Impersonation/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    });
    expect(screen.queryByText('Thanks for letting us know')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Submit Report' })).toBeInTheDocument();
    expect(useUi.getState().toasts.map((t) => t.message)).toContain('Too many requests, slow down');
  });
});
