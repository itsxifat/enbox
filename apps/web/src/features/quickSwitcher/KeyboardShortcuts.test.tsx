/**
 * Escape marks the open chat read (its NEW line and bar too) when nothing is focused or the
 * message box is empty, and only when nothing else took the key; Shift+Escape marks the Space
 * read. The shortcut list shows them and the keys of a focused message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ChatSummary } from '@enbox/shared';
import { useReadSignals } from '@/features/conversation/newMessages/readSignal';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeMe } from '@/test/factories';
import { KeyboardShortcuts, idleForEscape } from './KeyboardShortcuts';

const A = '0190d2a4-3c4b-7d2e-9f10-00000000000a';
const S = '0190d2a4-3c4b-7d2e-9f10-0000000000aa';
const space: NonNullable<ChatSummary['space']> = {
  spaceId: S,
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <KeyboardShortcuts />
              <input aria-label="Search" />
              <textarea aria-label="Message" />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const escape = async (init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(window, { key: 'Escape', ...init });
  // Marked once the key went through (a timer).
  await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const marks = () => useReadSignals.getState().tokens[A] ?? 0;

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }) });
  useChats.setState({
    byId: { [A]: makeChat({ id: A, type: 'group', name: 'Book club', lastSeq: 9, lastReadSeq: 4, unreadCount: 5 }) },
    loaded: true,
  });
  vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionState();
  useQuickSwitcher.setState({ open: false, shortcutsOpen: false, initialQuery: '' });
});

describe('Escape', () => {
  it('marks the open chat read when nothing is focused', async () => {
    renderAt(`/chats/${A}`);
    await escape();
    expect(marks()).toBe(1);
    expect(useChats.getState().byId[A]!.unreadCount).toBe(0);
  });

  it('from the message box only when it is empty; never from another field', async () => {
    renderAt(`/chats/${A}`);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'draft' } });
    box.focus();
    await escape();
    expect(marks()).toBe(0);
    fireEvent.change(box, { target: { value: '' } });
    await escape();
    expect(marks()).toBe(1);
    screen.getByRole('textbox', { name: 'Search' }).focus();
    await escape();
    expect(marks()).toBe(1);
  });

  it('a thread’s message box marks the thread, not the channel beside it', async () => {
    const T = '0190d2a4-3c4b-7d2e-9f10-0000000000bb';
    useChats.setState({
      byId: {
        [A]: useChats.getState().byId[A]!,
        [T]: makeChat({ id: T, type: 'group', name: 'Plans', lastSeq: 2, lastReadSeq: 1, unreadCount: 1 }),
      },
    });
    renderAt(`/chats/${A}`);
    const panel = document.createElement('div');
    panel.innerHTML = `<div data-testid="message-list" data-chat-id="${T}"></div><textarea aria-label="Message"></textarea>`;
    document.body.append(panel);
    panel.querySelector('textarea')!.focus();
    await escape();
    expect(useReadSignals.getState().tokens[T]).toBe(1);
    expect(marks()).toBe(0);
    panel.remove();
  });

  it('not when something else took the key (a dialog closing, a search)', async () => {
    renderAt(`/chats/${A}`);
    const taken = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', taken);
    await escape();
    window.removeEventListener('keydown', taken);
    expect(marks()).toBe(0);
  });

  it('Shift+Escape marks the Space read', async () => {
    const C = '0190d2a4-3c4b-7d2e-9f10-0000000000cc';
    useSpaces.setState({ byId: { [S]: makeSpace({ id: S }) } });
    useChats.setState({
      byId: { [C]: makeChat({ id: C, type: 'space_text', name: 'general', space, lastSeq: 3, lastReadSeq: 1 }) },
    });
    renderAt(`/spaces/${S}/${C}`);
    await escape({ shiftKey: true });
    expect(api.post).toHaveBeenCalledWith(`/api/spaces/${S}/read`);
    // The open channel's NEW line and bar go too.
    expect(useReadSignals.getState().tokens[C]).toBe(1);
  });

  it('idleForEscape: nothing focused, the empty message box, the message list', () => {
    const list = document.createElement('div');
    list.dataset.testid = 'message-list';
    const row = document.createElement('div');
    list.append(row);
    document.body.append(list);
    expect(idleForEscape(null)).toBe(true);
    expect(idleForEscape(document.body)).toBe(true);
    expect(idleForEscape(row)).toBe(true);
    expect(idleForEscape(document.createElement('input'))).toBe(false);
    list.remove();
  });
});

describe('the shortcut list', () => {
  it('shows marking read and the keys of a focused message', () => {
    renderAt('/chats');
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    const sheet = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    for (const label of ['Mark channel as read', 'Mark Space as read', 'Edit (yours)', 'Add reaction', 'Copy text'])
      expect(sheet).toHaveTextContent(label);
  });
});
