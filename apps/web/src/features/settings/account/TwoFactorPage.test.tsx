/** Two-factor settings: the setup wizard, the QR code, backup codes, removal, My Account rows. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { encode } from 'uqr';
import type { TotpSetup } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import type * as ApiModule from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { AccountPage } from './AccountPage';
import { QrCode } from './QrCode';
import { TwoFactorPage } from './TwoFactorPage';
import { backupCodesText, formatSecret } from './twoFactorApi';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), get: vi.fn() } };
});

const post = vi.mocked(api.post);

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SETUP: TotpSetup = {
  secret: SECRET,
  otpauthUrl: `otpauth://totp/Enbox:ada?secret=${SECRET}&issuer=Enbox&algorithm=SHA1&digits=6&period=30`,
};
const CODES = Array.from({ length: 10 }, (_, i) => `c0d${i}-x${i}y${i}`);
const NEW_CODES = Array.from({ length: 10 }, (_, i) => `n3w${i}-z${i}z${i}`);

const wrongCode = () => new ApiError('invalid_code', 'Invalid two-factor code', 400);

function server() {
  post.mockImplementation(async (path: string, body?: unknown) => {
    const { code, password } = (body ?? {}) as { code?: string; password?: string };
    switch (path) {
      case '/api/me/mfa/totp/setup':
        return SETUP as never;
      case '/api/me/mfa/totp/enable':
        if (code === '111111') throw wrongCode();
        return { codes: CODES } as never;
      case '/api/me/mfa/totp/disable':
        if (code === '111111') throw wrongCode();
        return undefined as never;
      case '/api/me/mfa/backup-codes':
        if (password !== 'right-password')
          throw new ApiError('forbidden', 'Your password is incorrect', 403);
        return { codes: NEW_CODES } as never;
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

const calls = (path: string) => post.mock.calls.filter(([p]) => p === path);

/** jsdom's Blob has no `.text()`. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/account" element={<AccountPage />} />
        <Route path="/settings/account/two-factor" element={<TwoFactorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  server();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useAuth.setState({
    user: makeMe({ username: 'ada', mfaEnabled: false }),
    token: 't',
    status: 'authenticated',
  });
});

// jsdom has no object URLs; the download test stubs them.
const { createObjectURL: realCreate, revokeObjectURL: realRevoke } = URL;
afterEach(() => {
  Object.assign(URL, { createObjectURL: realCreate, revokeObjectURL: realRevoke });
});

describe('QrCode', () => {
  it('renders the otpauth URL as an SVG (ECC M, 4-module quiet zone, every dark module)', () => {
    render(<QrCode value={SETUP.otpauthUrl} label="Scan me" size={200} />);
    const svg = screen.getByRole('img', { name: 'Scan me' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const qr = encode(SETUP.otpauthUrl, { ecc: 'M', border: 4 });
    expect(svg).toHaveAttribute('viewBox', `0 0 ${qr.size} ${qr.size}`);
    expect(svg).toHaveAttribute('width', '200');
    const d = svg.querySelector('path')!.getAttribute('d')!;
    // Runs of dark modules: their lengths add up to the code's dark modules.
    const dark = [...d.matchAll(/h(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(dark).toBe(qr.data.flat().filter(Boolean).length);
    // Nothing is drawn in the quiet zone.
    const points = [...d.matchAll(/M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...points.map(([x]) => x!))).toBe(4);
    expect(Math.min(...points.map(([, y]) => y!))).toBe(4);
    expect(svg.querySelector('rect')).toHaveAttribute('fill', '#ffffff');
  });
});

describe('helpers', () => {
  it('formats the key in groups of 4 and writes the codes file', () => {
    expect(formatSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(formatSecret('ABCDEF')).toBe('ABCD EF');
    const text = backupCodesText(
      ['aaaa-bbbb', 'cccc-dddd'],
      'ada',
      new Date('2026-10-23T12:00:00Z'),
    );
    expect(text).toContain('Enbox backup codes for @ada');
    expect(text).toContain('Generated 2026-10-23');
    expect(text).toMatch(/aaaa-bbbb\ncccc-dddd\n$/);
  });
});

describe('TwoFactorPage: the setup wizard', () => {
  it('download → scan (QR or key) → code → backup codes → done', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:codes');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAt('/settings/account/two-factor');

    // 1. Download an app.
    expect(
      screen.getByRole('heading', { name: 'Download an authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(calls('/api/me/mfa/totp/setup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // 2. Scan the QR code, or type the key.
    expect(await screen.findByRole('heading', { name: 'Scan the QR code' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    const qr = screen.getByRole('img', { name: 'QR code for your authenticator app' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByLabelText('Setup key')).toHaveTextContent(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(screen.getByRole('link', { name: 'Open in your authenticator app' })).toHaveAttribute(
      'href',
      SETUP.otpauthUrl,
    );
    // Back and forth keeps the same secret.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Scan the QR code' });
    expect(calls('/api/me/mfa/totp/setup')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // 3. Enter the code: sent at 6 digits; a wrong one is explained.
    expect(screen.getByRole('heading', { name: 'Enter the 6-digit code' })).toBeInTheDocument();
    const input = screen.getByLabelText('6-digit code');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '111111' } });
    expect(await screen.findByText('Invalid two-factor code')).toBeInTheDocument();
    expect(useAuth.getState().user!.mfaEnabled).toBe(false);
    fireEvent.change(input, { target: { value: '123456' } });

    // 4. The backup codes, shown once.
    expect(
      await screen.findByRole('heading', { name: 'Save your backup codes' }),
    ).toBeInTheDocument();
    expect(calls('/api/me/mfa/totp/enable').map(([, body]) => body)).toEqual([
      { code: '111111' },
      { code: '123456' },
    ]);
    // On now (mfaEnabled flipped), yet the wizard stays on its last step.
    expect(useAuth.getState().user!.mfaEnabled).toBe(true);
    const list = screen.getByRole('list', { name: 'Backup codes' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(CODES);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODES.join('\n')));

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(click).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const text = await readBlob(blob);
    expect(text).toContain('@ada');
    for (const c of CODES) expect(text).toContain(c);

    fireEvent.click(screen.getByRole('button', { name: "I've saved them" }));
    // Back on My Account, where it now shows as on.
    expect(await screen.findByText('Authenticator app enabled')).toBeInTheDocument();
  });

  it('a conflict on confirm (the secret changed elsewhere) offers to start over', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/me/mfa/totp/setup') return SETUP as never;
      if (path === '/api/me/mfa/totp/enable')
        throw new ApiError('conflict', 'Set up your authenticator app first', 409);
      throw new Error(`unexpected POST ${path}`);
    });
    renderAt('/settings/account/two-factor');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Scan the QR code' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Set up your authenticator app first',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(
      screen.getByRole('heading', { name: 'Download an authenticator app' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Scan the QR code' });
    // A new secret for the new try.
    expect(calls('/api/me/mfa/totp/setup')).toHaveLength(2);
  });
});

describe('two-factor on: backup codes and removal', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ username: 'ada', mfaEnabled: true }) });
  });

  it('My Account shows the status, View Backup Codes and Remove Authenticator App', () => {
    renderAt('/settings/account');
    expect(screen.getByText('Password and Authentication')).toBeInTheDocument();
    expect(screen.getByText('Authenticator app enabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View Backup Codes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Authenticator App/ })).toBeInTheDocument();
    expect(screen.queryByText('Enable Authenticator App')).toBeNull();
  });

  it('View Backup Codes: the warning, then my password makes a new set', async () => {
    renderAt('/settings/account');
    fireEvent.click(screen.getByRole('button', { name: /View Backup Codes/ }));
    const dialog = await screen.findByRole('dialog', { name: 'View Backup Codes' });
    expect(dialog).toHaveTextContent('Generating new codes makes the old ones stop working.');
    const submit = within(dialog).getByRole('button', { name: 'Generate New Codes' });
    fireEvent.click(submit);
    expect(await within(dialog).findByText('Enter your password')).toBeInTheDocument();
    expect(calls('/api/me/mfa/backup-codes')).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(submit);
    expect(await within(dialog).findByText('Your password is incorrect')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'right-password' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Generate New Codes' }));
    const fresh = await screen.findByRole('dialog', { name: 'Your new backup codes' });
    const list = within(fresh).getByRole('list', { name: 'Backup codes' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(NEW_CODES);
    expect(calls('/api/me/mfa/backup-codes').map(([, body]) => body)).toEqual([
      { password: 'wrong' },
      { password: 'right-password' },
    ]);
    fireEvent.click(within(fresh).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Remove Authenticator App takes an app or backup code and turns it off', async () => {
    renderAt('/settings/account');
    fireEvent.click(screen.getByRole('button', { name: /Remove Authenticator App/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Authenticator App' });
    const input = within(dialog).getByLabelText('Authentication or backup code');
    const remove = within(dialog).getByRole('button', { name: 'Remove' });

    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(remove);
    expect(
      await within(dialog).findByText('Enter a 6-digit code or a backup code'),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '111111' } });
    fireEvent.click(remove);
    expect(await within(dialog).findByText('Invalid two-factor code')).toBeInTheDocument();
    expect(useAuth.getState().user!.mfaEnabled).toBe(true);

    fireEvent.change(input, { target: { value: 'ABCD-1234' } });
    fireEvent.click(remove);
    await waitFor(() => expect(useAuth.getState().user!.mfaEnabled).toBe(false));
    expect(calls('/api/me/mfa/totp/disable').map(([, body]) => body)).toEqual([
      { code: '111111' },
      { code: 'abcd-1234' },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Enable Authenticator App')).toBeInTheDocument();
  });

  it('opening the wizard page while on shows the status instead of a new setup', () => {
    renderAt('/settings/account/two-factor');
    expect(screen.getByText('Two-factor authentication is on')).toBeInTheDocument();
    expect(screen.getByText('Authenticator app enabled')).toBeInTheDocument();
    expect(screen.queryByText('Step 1 of 4')).toBeNull();
    expect(calls('/api/me/mfa/totp/setup')).toHaveLength(0);
  });
});

describe('two-factor off: My Account', () => {
  it('offers "Enable Authenticator App", which opens the wizard', async () => {
    renderAt('/settings/account');
    expect(screen.getByText('Password and Authentication')).toBeInTheDocument();
    expect(screen.queryByText('Authenticator app enabled')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /Enable Authenticator App/ }));
    expect(
      await screen.findByRole('heading', { name: 'Download an authenticator app' }),
    ).toBeInTheDocument();
  });
});
