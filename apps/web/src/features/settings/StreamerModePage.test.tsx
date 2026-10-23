/**
 * Streamer Mode: the settings page and its device store (persisted, storage failures
 * tolerated), and what it does — personal fields in My Account and my notes redacted, invite
 * links hidden (copying still works), sounds and desktop notifications silenced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SpaceInvite } from '@enbox/shared';
import { inviteUrl } from '@/features/groups/shared/share';
import { InviteLinkView } from '@/features/groups/shared/InviteLinkView';
import { ProfileNote } from '@/features/profile/ProfileNote';
import { makeSpace } from '@/features/spaces/testUtils';
import { InviteDialog } from '@/features/spaces/dialogs/InviteDialog';
import { api } from '@/lib/api';
import { playSound, showNotification, startLoop } from '@/lib/notify';
import { useAuth } from '@/stores/auth';
import {
  DEFAULT_STREAMER,
  INVITE_HIDDEN_TEXT,
  PERSONAL_HIDDEN_TEXT,
  streamerHides,
  useStreamer,
} from '@/stores/streamer';
import { makeMe } from '@/test/factories';
import { AccountPage } from './account/AccountPage';
import { StreamerModePage } from './StreamerModePage';

// Another page's block (two-factor), not under test here.
vi.mock('./account/TwoFactorRows', () => ({ TwoFactorRows: () => null }));

const on = () => act(() => useStreamer.getState().setEnabled(true));

beforeEach(() => {
  useAuth.setState({
    user: makeMe({ id: 'me', username: 'ann.lee', phone: '+15551234567' }),
    token: 't',
    status: 'authenticated',
  });
});

afterEach(() => {
  useStreamer.setState({ ...DEFAULT_STREAMER, auto: false });
});

describe('Streamer Mode page', () => {
  it('turns the mode and each option on and off, and remembers them on this device', () => {
    render(<StreamerModePage />);
    const enable = screen.getByRole('switch', { name: /Enable Streamer Mode/ });
    expect(enable).not.toBeChecked();
    // Every protection is on by default (they apply while the mode is on).
    for (const name of [
      /Hide Personal Information/,
      /Hide Invite Links/,
      /Disable Sounds/,
      /Disable Notifications/,
    ])
      expect(screen.getByRole('switch', { name })).toBeChecked();
    expect(streamerHides('invites')).toBe(false);

    fireEvent.click(enable);
    expect(useStreamer.getState().enabled).toBe(true);
    expect(streamerHides('invites')).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: /Hide Invite Links/ }));
    expect(streamerHides('invites')).toBe(false);
    fireEvent.click(
      screen.getByRole('switch', { name: /Automatically turn on while sharing my screen/ }),
    );
    expect(useStreamer.getState().autoOnScreenShare).toBe(true);

    const saved = JSON.parse(localStorage.getItem('enbox.streamer') ?? '{}') as { state?: object };
    expect(saved.state).toMatchObject({
      enabled: true,
      hideInvites: false,
      autoOnScreenShare: true,
    });
  });

  it('an automatic switch-on is not remembered; storage failures change nothing', () => {
    act(() => useStreamer.getState().setEnabled(true, { auto: true }));
    const saved = JSON.parse(localStorage.getItem('enbox.streamer') ?? '{}') as { state?: object };
    expect(saved.state).toMatchObject({ enabled: false });

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => act(() => useStreamer.getState().setOption('disableSounds', false))).not.toThrow();
    expect(useStreamer.getState().disableSounds).toBe(false);
  });
});

describe('Hide Personal Information', () => {
  it('redacts the username and phone number in My Account', () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('@ann.lee')).toBeInTheDocument();
    expect(screen.getByText('+15551234567')).toBeInTheDocument();
    on();
    expect(screen.queryByText('@ann.lee')).toBeNull();
    expect(screen.queryByText('+15551234567')).toBeNull();
    expect(screen.getAllByText(PERSONAL_HIDDEN_TEXT)).toHaveLength(2);
    // The option off: shown even in Streamer Mode.
    act(() => useStreamer.getState().setOption('hidePersonal', false));
    expect(screen.getByText('@ann.lee')).toBeInTheDocument();
  });

  it('hides my note on a profile', () => {
    render(<ProfileNote userId="u1" />);
    expect(screen.getByTestId('card-note-field')).toBeInTheDocument();
    on();
    expect(screen.queryByTestId('card-note-field')).toBeNull();
  });
});

describe('Hide Invite Links', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('a group’s invite link page shows the notice instead of the link; Copy still copies it', async () => {
    on();
    render(
      <MemoryRouter>
        <InviteLinkView
          name="Book club"
          avatar={null}
          kind="group"
          code="AbC123"
          load={async () => ({ code: 'AbC123' })}
          onBack={() => {}}
        />
      </MemoryRouter>,
    );
    const shown = screen.getByTestId('invite-link');
    expect(shown).toHaveTextContent(INVITE_HIDDEN_TEXT);
    expect(shown).not.toHaveAttribute('href');
    expect(document.body.textContent).not.toContain('AbC123');
    fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(inviteUrl('AbC123')));
  });

  it('the Space invite dialog too', async () => {
    const invite: SpaceInvite = {
      code: 'xyz789',
      spaceId: 's1',
      channelId: null,
      createdBy: 'me',
      maxUses: 0,
      uses: 0,
      expiresAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    vi.spyOn(api, 'post').mockResolvedValue(invite as never);
    on();
    render(<InviteDialog space={makeSpace({ id: 's1', name: 'Gaming' })} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('space-invite-url')).toHaveTextContent(INVITE_HIDDEN_TEXT),
    );
    expect(document.body.textContent).not.toContain('xyz789');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(inviteUrl('xyz789')));
  });
});

describe('Disable Sounds and Disable Notifications', () => {
  it('no desktop notification while on (the option off: shown again)', async () => {
    const shown = vi.fn();
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        onclick: unknown = null;
        onclose: unknown = null;
        constructor(title: string) {
          shown(title);
        }
        close() {}
      },
    );
    on();
    expect(await showNotification({ title: 'Alice' }, { force: true })).toBe(false);
    expect(shown).not.toHaveBeenCalled();
    act(() => useStreamer.getState().setOption('disableNotifications', false));
    expect(await showNotification({ title: 'Alice' }, { force: true })).toBe(true);
    expect(shown).toHaveBeenCalledWith('Alice');
  });

  it('no sound and no ringtone while on', () => {
    const created = vi.fn();
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'suspended';
        constructor() {
          created();
        }
        resume() {
          return Promise.resolve();
        }
      },
    );
    on();
    playSound('message');
    const stop = startLoop('ringtone');
    stop();
    expect(created).not.toHaveBeenCalled();
    act(() => useStreamer.getState().setOption('disableSounds', false));
    playSound('message');
    expect(created).toHaveBeenCalled();
  });
});
