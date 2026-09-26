import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PRESENCE_NOTE_MAX_LENGTH } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { PresenceNoteDialog } from './PresenceNoteDialog';

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('PresenceNoteDialog', () => {
  it('needs text or an emoji, then PUTs the note with the chosen expiry', async () => {
    const onClose = vi.fn();
    const put = vi.spyOn(api, 'put').mockResolvedValue(makeMe({ id: 'me' }));
    render(<PresenceNoteDialog open onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Set a custom status' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add some text or an emoji')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();

    const input = screen.getByLabelText("What's your status?");
    expect(input).toHaveAttribute('maxlength', String(PRESENCE_NOTE_MAX_LENGTH));
    fireEvent.change(input, { target: { value: '  Focus time ' } });
    fireEvent.click(screen.getByRole('radio', { name: '1 hour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0]! as [
      string,
      { text: string | null; emoji: string | null; expiresAt: string | null },
    ];
    expect(path).toBe('/api/me/presence-note');
    expect(body.text).toBe('Focus time');
    expect(body.emoji).toBeNull();
    expect(Math.round((new Date(body.expiresAt!).getTime() - Date.now()) / 60_000)).toBe(60);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('starts from the current note and can clear it', async () => {
    useAuth.setState({
      user: makeMe({
        id: 'me',
        presenceNote: { text: 'Lunch', emoji: '🥪', expiresAt: null },
      }),
    });
    const onClose = vi.fn();
    const del = vi.spyOn(api, 'delete').mockResolvedValue(makeMe({ id: 'me' }));
    render(<PresenceNoteDialog open onClose={onClose} />);
    expect(screen.getByLabelText("What's your status?")).toHaveValue('Lunch');
    expect(screen.getByRole('button', { name: 'Emoji: 🥪' })).toBeInTheDocument();
    // "Don't clear" is the default choice when editing.
    expect(screen.getByRole('radio', { name: "Don't clear" })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/me/presence-note'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('an emoji alone is enough; "Remove emoji" drops it', async () => {
    useAuth.setState({
      user: makeMe({ id: 'me', presenceNote: { text: null, emoji: '🌴', expiresAt: null } }),
    });
    const put = vi.spyOn(api, 'put').mockResolvedValue(makeMe({ id: 'me' }));
    render(<PresenceNoteDialog open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/me/presence-note', {
        text: null,
        emoji: '🌴',
        expiresAt: null,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove emoji' }));
    expect(screen.getByRole('button', { name: 'Pick an emoji' })).toBeInTheDocument();
  });
});
