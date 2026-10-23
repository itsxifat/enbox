/** Delete account: with two-factor on, a code is asked for and sent along with the password. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { DeleteAccountPage } from './DeleteAccountPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, delete: vi.fn() } };
});

const del = vi.mocked(api.delete);

/** Fill the password, tick the acknowledgement, submit and accept the confirmation. */
async function submit(password: string) {
  fireEvent.change(screen.getByLabelText('Confirm with your password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByLabelText("I understand this can't be undone"));
  fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
  const dialog = useUi.getState().dialogs[0]!;
  useUi.getState().closeDialog(dialog.id, 'confirm');
}

afterEach(() => {
  del.mockReset();
  useUi.setState({ dialogs: [] });
});

describe('DeleteAccountPage', () => {
  it('without two-factor: no code field, the password alone is sent', async () => {
    useAuth.setState({ user: makeMe({ mfaEnabled: false }) });
    del.mockRejectedValue(new ApiError('forbidden', 'Incorrect password', 403));
    render(<DeleteAccountPage />);
    expect(screen.queryByLabelText('Authentication or backup code')).toBeNull();
    await submit('pw');
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/me', { password: 'pw' }));
    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
  });

  it('with two-factor: asks for a code, sends it, and shows a wrong code under the field', async () => {
    useAuth.setState({ user: makeMe({ mfaEnabled: true }) });
    del.mockRejectedValue(new ApiError('invalid_code', 'Invalid two-factor code', 400));
    render(<DeleteAccountPage />);
    fireEvent.change(screen.getByLabelText('Confirm with your password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByLabelText("I understand this can't be undone"));
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Enter a 6-digit code or a backup code')).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();

    // The password and the acknowledgement are still filled in: add the code and confirm.
    fireEvent.change(screen.getByLabelText('Authentication or backup code'), {
      target: { value: ' 123456 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, 'confirm');
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/api/me', { password: 'pw', code: '123456' }),
    );
    expect(await screen.findByText('Invalid two-factor code')).toBeInTheDocument();
  });
});
