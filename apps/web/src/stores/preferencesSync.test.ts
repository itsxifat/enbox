/**
 * Synced preferences: newer documents win (echoes and late answers change nothing), only the
 * whitelisted, well-formed keys apply, local changes go up after a pause and are never
 * overwritten before they are saved, "Sync across clients" off stops both directions, and
 * `me:preferences` from another device applies at once.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncedPreferences } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { registerPreferencesHandlers } from '@/realtime/preferences';
import { makeMe } from '@/test/factories';
import { useAuth } from './auth';
import {
  SYNCED_KEYS,
  SYNC_DEBOUNCE_MS,
  flushPreferences,
  isSyncedValue,
  loadSyncedPreferences,
  pendingPreferenceKeys,
  receivePreferences,
  resetPreferencesSync,
  startPreferencesSync,
} from './preferencesSync';
import { DEFAULT_PREFS, useUi } from './ui';

const doc = (prefs: Record<string, unknown>, updatedAt: string | null): SyncedPreferences => ({
  prefs,
  updatedAt,
});
const T1 = '2026-10-23T10:00:00.000Z';
const T2 = '2026-10-23T10:00:05.000Z';
const T3 = '2026-10-23T10:00:09.000Z';

const ui = () => useUi.getState();
const prefs = () => useUi.getState().prefs;

function signIn() {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
}

beforeAll(() => startPreferencesSync());
beforeEach(() => {
  useAuth.setState({ user: null, token: null, status: 'anonymous' });
  useUi.setState({ theme: 'dark', resolvedTheme: 'dark', prefs: { ...DEFAULT_PREFS } });
  resetPreferencesSync();
  signIn();
});
afterEach(() => {
  vi.useRealTimers();
  useAuth.setState({ user: null, token: null, status: 'anonymous' });
  resetPreferencesSync();
});

describe('applying a document', () => {
  it('applies the whitelisted keys with valid values, nothing else', () => {
    receivePreferences(
      doc(
        {
          theme: 'light',
          chatFontPx: 18,
          messageDisplay: 'compact',
          customThemeColors: ['#112233', '#445566'],
          // Device-specific, unknown or malformed: ignored.
          sounds: false,
          audioInputDevice: 'mic-2',
          somethingNew: true,
          uiDensity: 'cramped',
          saturation: 4,
        },
        T1,
      ),
    );
    expect(ui().theme).toBe('light');
    expect(ui().resolvedTheme).toBe('light');
    expect(prefs()).toMatchObject({
      chatFontPx: 18,
      messageDisplay: 'compact',
      customThemeColors: ['#112233', '#445566'],
      sounds: true,
      audioInputDevice: '',
      uiDensity: 'default',
      saturation: 1,
    });
    expect(prefs()).not.toHaveProperty('somethingNew');
    // Applying is not a change of mine to save.
    expect(pendingPreferenceKeys()).toEqual([]);
  });

  it('only a newer document applies: echoes and late answers change nothing', () => {
    receivePreferences(doc({ chatFontPx: 20 }, T2));
    receivePreferences(doc({ chatFontPx: 13 }, T1));
    expect(prefs().chatFontPx).toBe(20);
    receivePreferences(doc({ chatFontPx: 12 }, T2));
    expect(prefs().chatFontPx).toBe(20);
    receivePreferences(doc({ chatFontPx: 16 }, T3));
    expect(prefs().chatFontPx).toBe(16);
  });

  it('the whitelist leaves device-only prefs out', () => {
    expect(SYNCED_KEYS).toContain('theme');
    expect(SYNCED_KEYS).toContain('appTheme');
    expect(SYNCED_KEYS).toContain('developerMode');
    for (const k of [
      'sounds',
      'audioInputDevice',
      'pttShortcut',
      'userAudio',
      'syncPreferences',
      'wallpaperPreset',
    ])
      expect(SYNCED_KEYS).not.toContain(k);
    expect(isSyncedValue('chatFontPx', null)).toBe(true);
    expect(isSyncedValue('chatFontPx', 30)).toBe(false);
    expect(isSyncedValue('trustedLinkDomains', ['a.com'])).toBe(true);
    expect(
      isSyncedValue(
        'trustedLinkDomains',
        Array.from({ length: 300 }, (_, i) => `${i}.com`),
      ),
    ).toBe(false);
    expect(isSyncedValue('toString', 'x')).toBe(false);
  });
});

describe('saving my changes', () => {
  it('PATCHes the changed synced keys once, after a pause', async () => {
    vi.useFakeTimers();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(doc({}, T1) as never);
    ui().setTheme('onyx');
    ui().setPref('chatFontPx', 16);
    ui().setPref('chatFontPx', 18);
    ui().setPref('sounds', false); // device-only
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 10);
    ui().setPref('uiDensity', 'compact'); // the pause starts again
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 10);
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/me/preferences', {
      theme: 'onyx',
      chatFontPx: 18,
      uiDensity: 'compact',
    });
    await vi.runAllTimersAsync();
    expect(pendingPreferenceKeys()).toEqual([]);
  });

  it('never overwrites a key changed here before it is saved', async () => {
    let answer!: (d: SyncedPreferences) => void;
    vi.spyOn(api, 'patch').mockReturnValue(new Promise((r) => (answer = r)) as never);
    receivePreferences(doc({ chatFontPx: 15 }, T1));
    ui().setPref('chatFontPx', 20);
    // Another device's document arrives first: my unsaved font size stays, the rest applies.
    receivePreferences(doc({ chatFontPx: 13, theme: 'light' }, T2));
    expect(prefs().chatFontPx).toBe(20);
    expect(ui().theme).toBe('light');
    const saved = flushPreferences();
    // In flight: still mine.
    receivePreferences(doc({ chatFontPx: 14 }, T3));
    expect(prefs().chatFontPx).toBe(20);
    // My save landed before that one (older): the newer document wins once mine is done.
    answer(doc({ chatFontPx: 20, theme: 'light' }, '2026-10-23T10:00:07.000Z'));
    await saved;
    expect(prefs().chatFontPx).toBe(14);
  });

  it('sends the size the old fontSize stands for instead of a null chatFontPx', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(doc({}, T1) as never);
    ui().setPrefs({ chatFontPx: 18 });
    ui().setPrefs({ chatFontPx: null, fontSize: 'large' });
    await flushPreferences();
    expect(patch).toHaveBeenCalledWith('/api/me/preferences', {
      chatFontPx: 17,
      fontSize: 'large',
    });
  });

  it('retries after a failure and drops what the server rejects', async () => {
    vi.useFakeTimers();
    const patch = vi
      .spyOn(api, 'patch')
      .mockRejectedValueOnce(new ApiError('network_error', 'offline'))
      .mockResolvedValueOnce(doc({ chatFontPx: 16 }, T1) as never);
    ui().setPref('chatFontPx', 16);
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(pendingPreferenceKeys()).toEqual(['chatFontPx']);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(pendingPreferenceKeys()).toEqual([]);

    patch.mockRejectedValueOnce(new ApiError('validation_error', 'Too many preferences', 400));
    ui().setPref('developerMode', true);
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(patch).toHaveBeenCalledTimes(3);
    expect(pendingPreferenceKeys()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(patch).toHaveBeenCalledTimes(3);
  });

  it('keeps unsaved keys across a reload and sends them before loading', async () => {
    ui().setPref('roleColors', 'dot');
    expect(JSON.parse(localStorage.getItem('enbox.ui.sync')!)).toMatchObject({
      userId: 'me',
      pending: ['roleColors'],
    });
    // A reload: the engine's memory is gone, the storage is not.
    const saved = localStorage.getItem('enbox.ui.sync')!;
    resetPreferencesSync();
    localStorage.setItem('enbox.ui.sync', saved);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(doc({ roleColors: 'dot' }, T1) as never);
    const get = vi.spyOn(api, 'get');
    await loadSyncedPreferences();
    expect(patch).toHaveBeenCalledWith('/api/me/preferences', { roleColors: 'dot' });
    expect(get).not.toHaveBeenCalled();
  });

  it('seeds an empty document with what this device changed', async () => {
    useUi.setState({ theme: 'ash', prefs: { ...DEFAULT_PREFS, chatFontPx: 18, sounds: false } });
    resetPreferencesSync();
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue(doc({ theme: 'ash', chatFontPx: 18 }, T1) as never);
    vi.spyOn(api, 'get').mockResolvedValue(doc({}, null) as never);
    vi.useFakeTimers();
    await loadSyncedPreferences();
    await vi.advanceTimersByTimeAsync(0);
    expect(patch).toHaveBeenCalledWith('/api/me/preferences', { theme: 'ash', chatFontPx: 18 });
  });
});

describe('Sync across clients off', () => {
  it('stops both directions; back on, this device takes the document', async () => {
    vi.useFakeTimers();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(doc({}, T1) as never);
    ui().setPref('syncPreferences', false);
    ui().setPref('chatFontPx', 20);
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS * 3);
    expect(patch).not.toHaveBeenCalled();
    receivePreferences(doc({ chatFontPx: 13 }, T2));
    expect(prefs().chatFontPx).toBe(20);

    const get = vi.spyOn(api, 'get').mockResolvedValue(doc({ chatFontPx: 13 }, T2) as never);
    ui().setPref('syncPreferences', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledWith('/api/me/preferences');
    expect(prefs().chatFontPx).toBe(13);
    expect(patch).not.toHaveBeenCalled();
  });

  it('signed out: nothing is tracked or applied', () => {
    useAuth.setState({ user: null, token: null, status: 'anonymous' });
    ui().setPref('chatFontPx', 20);
    expect(pendingPreferenceKeys()).toEqual([]);
    receivePreferences(doc({ chatFontPx: 13 }, T2));
    expect(prefs().chatFontPx).toBe(20);
  });
});

describe('realtime', () => {
  it('me:preferences from another device applies at once; ready loads the document', async () => {
    const handlers = new Map<string, (payload: never) => void>();
    const socket = {
      on: (event: string, fn: (payload: never) => void) => handlers.set(event, fn),
    } as unknown as AppSocket;
    const get = vi.spyOn(api, 'get').mockResolvedValue(doc({ theme: 'light' }, T1) as never);
    registerPreferencesHandlers(socket);
    await vi.waitFor(() => expect(ui().theme).toBe('light'));
    expect(get).toHaveBeenCalledWith('/api/me/preferences');

    handlers.get('me:preferences')!(doc({ theme: 'onyx', uiDensity: 'spacious' }, T2) as never);
    expect(ui().theme).toBe('onyx');
    expect(prefs().uiDensity).toBe('spacious');
  });
});
