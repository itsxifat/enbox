import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { KeyboardShortcuts } from './KeyboardShortcuts';

const A = '0190d2a4-3c4b-7d2e-9f10-00000000000a';
const B = '0190d2a4-3c4b-7d2e-9f10-00000000000b';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderApp(path = '/chats') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<><KeyboardShortcuts /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('quick switcher and shortcuts', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }) });
    useContacts.setState({ contacts: [], loaded: true });
    useChats.setState({
      byId: {
        [A]: makeChat({ id: A, type: 'direct', name: null, peer: makeUser({ id: 'alice', displayName: 'Alice', username: 'alice' }), lastActivityAt: '2026-10-02T00:00:00.000Z' }),
        [B]: makeChat({ id: B, type: 'group', name: 'Book club', unreadCount: 3, lastActivityAt: '2026-10-01T00:00:00.000Z' }),
      },
      loaded: true,
    });
  });
  afterEach(() => {
    useQuickSwitcher.setState({ open: false, shortcutsOpen: false, initialQuery: '' });
  });

  it('Ctrl+K opens the switcher; typing and Enter jump there', () => {
    renderApp();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: /where would you like to go/i });
    fireEvent.change(input, { target: { value: 'book' } });
    expect(screen.getAllByTestId('switcher-result')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByTestId('quick-switcher')).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent(`/chats/${B}`);
  });

  it('shows unread places when empty and closes on Escape', () => {
    renderApp();
    act(() => useQuickSwitcher.getState().show());
    expect(screen.getAllByTestId('switcher-result').map((r) => r.textContent)).toEqual([expect.stringContaining('Book club')]);
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    expect(screen.queryByTestId('quick-switcher')).toBeNull();
  });

  it('Alt+Down moves to the next conversation', () => {
    renderApp(`/chats/${A}`);
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(screen.getByTestId('where')).toHaveTextContent(`/chats/${B}`);
  });

  it('Ctrl+Shift+M toggles mute and Ctrl+/ opens the shortcut list', () => {
    useVoiceSelf.setState({ muted: false, deafened: false });
    renderApp();
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
    expect(useVoiceSelf.getState().muted).toBe(true);
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
  });
});
