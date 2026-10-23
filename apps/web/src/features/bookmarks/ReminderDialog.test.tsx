import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { makeMe, makeMessage } from '@/test/factories';
import { ReminderDialogHost, openReminderDialog } from './ReminderDialog';
import { useBookmarks } from './store';

const put = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { put: (...a: unknown[]) => put(...a) },
}));

const m = makeMessage({ id: 'm1', chatId: 'c1' });

describe('Remind Me ▸ Custom…', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }) });
    put.mockImplementation(async (_p: string, body: { remindAt: string }) => ({
      messageId: 'm1',
      chatId: 'c1',
      createdAt: new Date().toISOString(),
      remindAt: body.remindAt,
      remindedAt: null,
      message: m,
    }));
  });
  afterEach(() => {
    resetSessionState();
    put.mockReset();
  });

  it('starts tomorrow at 9:00, sets the chosen time, and refuses one in the past', async () => {
    render(<ReminderDialogHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => openReminderDialog({ messageId: 'm1', chatId: 'c1', message: m }));
    const dialog = screen.getByRole('dialog', { name: 'Remind me' });
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    const time = screen.getByLabelText('Time') as HTMLInputElement;
    expect(time.value).toBe('09:00');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(date.value).toBe(
      `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`,
    );

    fireEvent.change(date, { target: { value: '2001-01-01' } });
    expect(screen.getByText('Pick a time in the future')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set reminder' })).toBeDisabled();

    fireEvent.change(date, { target: { value: '2099-05-04' } });
    fireEvent.change(time, { target: { value: '18:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    const at = new Date(2099, 4, 4, 18, 30).toISOString();
    expect(put).toHaveBeenCalledWith('/api/messages/m1/bookmark', { remindAt: at });
    expect(dialog).not.toBeInTheDocument();
    await vi.waitFor(() => expect(useBookmarks.getState().byId.m1?.remindAt).toBe(at));
  });
});
