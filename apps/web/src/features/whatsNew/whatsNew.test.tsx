/** What's New: the changelog's shape, when it opens on its own, and the modal. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useConnection } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { CHANGELOG } from './changelog';
import {
  WHATS_NEW_DATE,
  WHATS_NEW_VERSION,
  markWhatsNewSeen,
  openWhatsNew,
  seenWhatsNew,
  shouldShowWhatsNew,
  useWhatsNew,
} from './store';
import { WhatsNewHost } from './WhatsNewHost';
import { WhatsNewModal, changelogDate } from './WhatsNewModal';

describe('the changelog', () => {
  it('is newest first with one version each, the store following its newest entry', () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    expect(new Set(versions).size).toBe(versions.length);
    expect(CHANGELOG[0]).toMatchObject({ version: WHATS_NEW_VERSION, date: WHATS_NEW_DATE });
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.items.length).toBeGreaterThan(0);
    }
  });

  it('never names another app', () => {
    expect(JSON.stringify(CHANGELOG)).not.toMatch(/discord/i);
  });

  it('dates read in local time', () => {
    expect(changelogDate('2026-10-23')).toBe(new Date(2026, 9, 23).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }));
  });
});

describe('shouldShowWhatsNew', () => {
  it('after an update; once seen, not again', () => {
    expect(shouldShowWhatsNew(WHATS_NEW_VERSION - 1, '2025-01-01T00:00:00.000Z')).toBe(true);
    expect(shouldShowWhatsNew(WHATS_NEW_VERSION, '2025-01-01T00:00:00.000Z')).toBe(false);
  });

  it('a first look only for accounts older than the newest entry', () => {
    expect(shouldShowWhatsNew(null, '2025-01-01T00:00:00.000Z')).toBe(true);
    expect(shouldShowWhatsNew(null, `${WHATS_NEW_DATE}T09:00:00.000Z`)).toBe(false);
    expect(shouldShowWhatsNew(null, undefined)).toBe(false);
  });
});

describe('WhatsNewHost', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me', createdAt: '2025-01-01T00:00:00.000Z' }), token: 't', status: 'authenticated' });
  });
  afterEach(() => {
    useWhatsNew.setState({ open: false, since: null });
    useConnection.setState({ readyCount: 0, state: 'idle', ready: false });
  });

  const renderHost = (path = '/chats') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <WhatsNewHost />
      </MemoryRouter>,
    );

  it('opens once after an update, when connected, marking the entries since my last visit', async () => {
    markWhatsNewSeen(WHATS_NEW_VERSION - 2);
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();

    useConnection.setState({ readyCount: 1, state: 'connected', ready: true });
    const dialog = await screen.findByRole('dialog', { name: 'What’s New' });
    expect(seenWhatsNew()).toBe(WHATS_NEW_VERSION);
    const entries = within(dialog).getAllByTestId('whats-new-entry');
    expect(entries).toHaveLength(CHANGELOG.length);
    expect(entries.map((e) => within(e).queryByText('NEW') !== null).slice(0, 3)).toEqual([true, true, false]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays closed for an account newer than the changes (marking them seen), and while User Settings is up', () => {
    useConnection.setState({ readyCount: 1, state: 'connected', ready: true });
    useAuth.setState({ user: makeMe({ id: 'me', createdAt: `${WHATS_NEW_DATE}T12:00:00.000Z` }) });
    renderHost();
    expect(useWhatsNew.getState().open).toBe(false);
    expect(seenWhatsNew()).toBe(WHATS_NEW_VERSION);
  });

  it('waits for User Settings to close', () => {
    useConnection.setState({ readyCount: 1, state: 'connected', ready: true });
    renderHost('/settings/help');
    expect(useWhatsNew.getState().open).toBe(false);
    expect(seenWhatsNew()).toBeNull();
  });
});

describe('WhatsNewModal', () => {
  afterEach(() => useWhatsNew.setState({ open: false, since: null }));

  it('opened by hand: every entry, none marked new', () => {
    openWhatsNew();
    render(<WhatsNewModal />);
    const dialog = screen.getByRole('dialog', { name: 'What’s New' });
    expect(within(dialog).getByRole('heading', { name: CHANGELOG[0]!.title })).toBeInTheDocument();
    expect(within(dialog).queryByText('NEW')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useWhatsNew.getState().open).toBe(false);
  });
});
