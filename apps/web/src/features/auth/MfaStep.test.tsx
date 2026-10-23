/** Login with two-factor on: the challenge, the code step (auto-submit, backup codes, errors). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { AuthResponse, MfaChallenge } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { LoginPage } from './LoginPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), get: vi.fn() } };
});

const post = vi.mocked(api.post);

const challenge: MfaChallenge = {
  mfaRequired: true,
  ticket: 'eyJ1c2VySWQiOiJ4In0.signature-signature',
  expiresAt: '2030-01-01T00:05:00.000Z',
};
const session: AuthResponse = { token: 'session-token', user: makeMe({ mfaEnabled: true }) };

/** The server: two-factor on unless `plain`; `errors` maps a code to the error it answers. */
function server(opts: { plain?: boolean; errors?: Record<string, ApiError> } = {}) {
  post.mockImplementation(async (path: string, body?: unknown) => {
    if (path === '/api/auth/login') return (opts.plain ? session : challenge) as never;
    if (path === '/api/auth/login/mfa') {
      const err = opts.errors?.[(body as { code: string }).code];
      if (err) throw err;
      return session as never;
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
}

async function submitPassword() {
  fireEvent.change(screen.getByLabelText('Username or phone'), { target: { value: 'ada' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await screen.findByRole('heading', { name: 'Multi-Factor Authentication' });
}

const mfaCalls = () => post.mock.calls.filter(([path]) => path === '/api/auth/login/mfa');

beforeEach(() => {
  useAuth.setState({ token: null, user: null, status: 'anonymous', bootError: null });
});

describe('login with two-factor on', () => {
  it('asks for the app code, sends it at 6 digits, shows a wrong code, then logs in', async () => {
    server({ errors: { '111111': new ApiError('invalid_code', 'Invalid two-factor code', 400) } });
    renderLogin();
    await submitPassword();
    // No session from the password step.
    expect(useAuth.getState().status).toBe('anonymous');
    expect(
      screen.getByText('Enter the 6-digit code from your authenticator app'),
    ).toBeInTheDocument();
    const input = screen.getByLabelText('Authentication code');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');

    // Not sent before the 6th digit; letters are dropped.
    fireEvent.change(input, { target: { value: '12a3' } });
    expect(input).toHaveValue('123');
    expect(mfaCalls()).toHaveLength(0);

    fireEvent.change(input, { target: { value: '111111' } });
    expect(await screen.findByText('Invalid two-factor code')).toBeInTheDocument();
    expect(useAuth.getState().status).toBe('anonymous');
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: '222 222' } });
    await waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    expect(useAuth.getState().token).toBe('session-token');
    expect(mfaCalls().map(([, body]) => body)).toEqual([
      { ticket: challenge.ticket, code: '111111' },
      { ticket: challenge.ticket, code: '222222' },
    ]);
    expect(mfaCalls()[1]![2]).toEqual({ auth: false });
  });

  it('takes a backup code instead', async () => {
    server();
    renderLogin();
    await submitPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    const input = screen.getByLabelText('Backup code');
    expect(input).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Use your authenticator app instead' }),
    ).toBeInTheDocument();
    // A half-typed code is caught before it is sent.
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter a backup code')).toBeInTheDocument();
    expect(mfaCalls()).toHaveLength(0);

    fireEvent.change(input, { target: { value: ' ABCD-1234 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    expect(mfaCalls()[0]![1]).toEqual({ ticket: challenge.ticket, code: 'abcd-1234' });
  });

  it('"Go back to login" returns to the password step, the username kept', async () => {
    server();
    renderLogin();
    await submitPassword();
    fireEvent.click(screen.getByRole('button', { name: 'Go back to login' }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username or phone')).toHaveValue('ada');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('an expired ticket goes back to the password step with the reason', async () => {
    const expired = new ApiError('unauthorized', 'Your login timed out. Log in again.', 401);
    server({ errors: { '333333': expired } });
    renderLogin();
    await submitPassword();
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '333333' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your login timed out. Log in again.',
    );
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(useAuth.getState().status).toBe('anonymous');
  });

  it('too many tries: the reason shows above the button', async () => {
    server({
      errors: { '444444': new ApiError('rate_limited', 'Too many requests, slow down', 429) },
    });
    renderLogin();
    await submitPassword();
    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '444444' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests, slow down');
    expect(
      screen.getByRole('heading', { name: 'Multi-Factor Authentication' }),
    ).toBeInTheDocument();
  });
});

describe('login without two-factor', () => {
  it('logs in right away, no code step', async () => {
    server({ plain: true });
    renderLogin();
    fireEvent.change(screen.getByLabelText('Username or phone'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useAuth.getState().status).toBe('authenticated'));
    expect(screen.queryByRole('heading', { name: 'Multi-Factor Authentication' })).toBeNull();
    expect(mfaCalls()).toHaveLength(0);
  });
});
