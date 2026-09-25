import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_SETTINGS } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import {
  lastSeenSummary,
  statusPrivacySummary,
  timerLabel,
  updateProfile,
  updateSettings,
} from './settingsApi';

describe('settings labels', () => {
  it('summarises last seen / online', () => {
    expect(lastSeenSummary(DEFAULT_USER_SETTINGS)).toBe('Everyone');
    expect(
      lastSeenSummary({ lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' }),
    ).toBe('Nobody, online: same as last seen');
  });

  it('summarises status privacy', () => {
    expect(statusPrivacySummary(DEFAULT_USER_SETTINGS)).toBe('My contacts');
    expect(
      statusPrivacySummary({
        ...DEFAULT_USER_SETTINGS,
        statusPrivacy: 'contacts_except',
        statusExcludeUserIds: ['a', 'b'],
      }),
    ).toBe('2 contacts excluded');
    expect(
      statusPrivacySummary({
        ...DEFAULT_USER_SETTINGS,
        statusPrivacy: 'only_share_with',
        statusOnlyShareWithUserIds: ['a'],
      }),
    ).toBe('1 contact selected');
  });

  it('labels timers', () => {
    expect(timerLabel(null)).toBe('Off');
    expect(timerLabel(86_400)).toBe('24 hours');
    expect(timerLabel(7 * 86_400)).toBe('7 days');
  });
});

describe('updateSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuth.setState({ user: makeMe(), status: 'authenticated', token: 't' });
    useUi.setState({ toasts: [] });
  });

  it('applies optimistically and keeps the server echo', async () => {
    let resolve!: (v: unknown) => void;
    vi.spyOn(api, 'patch').mockReturnValue(new Promise((r) => (resolve = r)));
    const p = updateSettings({ readReceipts: false });
    expect(useAuth.getState().user?.settings.readReceipts).toBe(false);
    resolve({ ...DEFAULT_USER_SETTINGS, readReceipts: false, lastSeenVisibility: 'contacts' });
    await expect(p).resolves.toBe(true);
    expect(useAuth.getState().user?.settings.lastSeenVisibility).toBe('contacts');
  });

  it('reverts the changed keys and toasts on failure', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError('internal_error', 'Boom', 500));
    await expect(updateSettings({ lastSeenVisibility: 'nobody' })).resolves.toBe(false);
    expect(useAuth.getState().user?.settings.lastSeenVisibility).toBe('everyone');
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'error', message: 'Boom' });
  });

  it('updateProfile replaces the cached user with the response', async () => {
    const next = makeMe({ displayName: 'New Name' });
    vi.spyOn(api, 'patch').mockResolvedValue(next);
    await updateProfile({ displayName: 'New Name' });
    expect(useAuth.getState().user?.displayName).toBe('New Name');
  });
});
