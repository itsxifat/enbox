/**
 * Two-factor sign-in (`/api/me/mfa/*`, see ApiRoutes) and the helpers its pages share.
 * Turning it on or off patches my cached profile at once (`mfaEnabled`); the server's
 * `me:updated` brings the same change to my other devices.
 */
import type {
  BackupCodes,
  DisableTotpRequest,
  EnableTotpRequest,
  RegenerateBackupCodesRequest,
  TotpSetup,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

/** Where the setup wizard lives. */
export const TWO_FACTOR_PATH = '/settings/account/two-factor';

/** A new secret to scan (replaces any earlier unconfirmed one). */
export function setupTotp(): Promise<TotpSetup> {
  return api.post<TotpSetup>('/api/me/mfa/totp/setup');
}

/** Confirm the scanned secret with a first code: two-factor on; the backup codes (shown once). */
export async function enableTotp(code: string): Promise<string[]> {
  const body: EnableTotpRequest = { code };
  const res = await api.post<BackupCodes>('/api/me/mfa/totp/enable', body);
  useAuth.getState().patchUser({ mfaEnabled: true });
  return res.codes;
}

/** Turn it off with a code from the app or an unused backup code. */
export async function disableTotp(code: string): Promise<void> {
  const body: DisableTotpRequest = { code };
  await api.post('/api/me/mfa/totp/disable', body);
  useAuth.getState().patchUser({ mfaEnabled: false });
}

/** A new set of backup codes (the old ones stop working); needs my password. */
export async function regenerateBackupCodes(password: string): Promise<string[]> {
  const body: RegenerateBackupCodesRequest = { password };
  return (await api.post<BackupCodes>('/api/me/mfa/backup-codes', body)).codes;
}

/** The setup key as authenticator apps print it: groups of 4. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/** The .txt a user keeps: what the codes are, then one per line. */
export function backupCodesText(codes: string[], username: string, date = new Date()): string {
  return [
    `Enbox backup codes for @${username}`,
    `Generated ${date.toISOString().slice(0, 10)}`,
    '',
    "Each code logs you in once when you can't use your authenticator app.",
    'Generating new codes makes these stop working.',
    '',
    ...codes,
    '',
  ].join('\n');
}

/** Save `text` as a file (a temporary object URL behind a download link). */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
