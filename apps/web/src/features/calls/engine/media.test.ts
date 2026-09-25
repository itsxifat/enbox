import { describe, expect, it } from 'vitest';
import { mediaErrorMessage, toMediaAccessError } from './media';

const domError = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('toMediaAccessError (screen share)', () => {
  it('treats a plain picker dismissal as cancelled', () => {
    expect(
      toMediaAccessError(domError('NotAllowedError', 'Permission denied'), 'screen').kind,
    ).toBe('cancelled');
  });

  it('reports an OS-level block (macOS Screen Recording) instead of failing silently', () => {
    const e = toMediaAccessError(
      domError('NotAllowedError', 'Permission denied by system'),
      'screen',
    );
    expect(e.kind).toBe('permission');
    expect(e.message).toMatch(/system settings/);
  });

  it('reports a Permissions-Policy block', () => {
    expect(toMediaAccessError(domError('SecurityError'), 'screen').kind).toBe('permission');
  });

  it('keeps microphone/camera permission errors as they were', () => {
    expect(toMediaAccessError(domError('NotAllowedError'), 'microphone').kind).toBe('permission');
    expect(mediaErrorMessage('permission', 'camera')).toMatch(/Allow camera access/);
  });
});
