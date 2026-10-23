/**
 * Formatting in the message box: Ctrl+B / I / U / Shift+X wrap and unwrap the selection (or
 * put markers around the caret), a toolbar floats over selected text (Bold … Quote, Link with
 * its own address field; Alt+F10 reaches it, Escape closes it), and the "Show send button"
 * preference puts the send button on desktop too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useDrafts } from '@/features/chats/drafts';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { useChatMembersStore } from '../../members';
import { Composer } from '../Composer';

const chat = makeChat({ id: 'dm-1', type: 'direct', peer: makeUser({ displayName: 'Maya' }) });

const textarea = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const toolbar = () => screen.queryByRole('toolbar', { name: 'Formatting' });

function type(value: string) {
  fireEvent.change(textarea(), { target: { value } });
}

/** Select [start, end) of the field like a mouse would (React's onSelect follows mouseup). */
function select(start: number, end: number) {
  const el = textarea();
  act(() => el.focus());
  el.setSelectionRange(start, end);
  fireEvent.mouseUp(el);
}

const press = (key: string, mods: { shiftKey?: boolean; altKey?: boolean } = {}) =>
  fireEvent.keyDown(textarea(), { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, ...mods });

const selection = () => [textarea().selectionStart, textarea().selectionEnd];

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: { [chat.id]: [] } });
  useDrafts.getState().clearDraft(chat.id);
  vi.spyOn(useMessages.getState(), 'sendMessage').mockResolvedValue(undefined as never);
});

describe('formatting shortcuts', () => {
  it('Ctrl+B wraps the selection, and again unwraps it', () => {
    render(<Composer chat={chat} />);
    type('hello world');
    select(6, 11);
    expect(press('b')).toBe(false); // handled
    expect(textarea()).toHaveValue('hello **world**');
    expect(selection()).toEqual([8, 13]);
    press('b');
    expect(textarea()).toHaveValue('hello world');
    expect(selection()).toEqual([6, 11]);
  });

  it('Ctrl+I, U and Shift+X; without a selection the markers go around the caret', () => {
    render(<Composer chat={chat} />);
    type('a b');
    select(0, 1);
    press('i');
    expect(textarea()).toHaveValue('*a* b');
    select(4, 5);
    press('u');
    expect(textarea()).toHaveValue('*a* __b__');
    select(9, 9);
    press('x', { shiftKey: true });
    expect(textarea()).toHaveValue('*a* __b__~~~~');
    expect(selection()).toEqual([11, 11]);
  });

  it('Ctrl+I in an empty box is left to the Inbox', () => {
    render(<Composer chat={chat} />);
    act(() => textarea().focus());
    expect(press('i')).toBe(true); // not handled here
    expect(textarea()).toHaveValue('');
  });
});

describe('formatting toolbar', () => {
  it('floats over a selection and applies its buttons; a caret hides it', () => {
    render(<Composer chat={chat} />);
    type('make this loud');
    expect(toolbar()).toBeNull();
    select(10, 14);
    const bar = toolbar()!;
    expect(bar).toBeInTheDocument();
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Spoiler',
      'Code',
      'Quote',
      'Link',
    ])
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: 'Bold' }));
    expect(textarea()).toHaveValue('make this **loud**');
    // Still selected: the toolbar stays, Bold now pressed.
    expect(within(toolbar()!).getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(toolbar()!).getByRole('button', { name: 'Spoiler' }));
    expect(textarea()).toHaveValue('make this **||loud||**');

    select(3, 3);
    expect(toolbar()).toBeNull();
  });

  it('quotes the selected lines', () => {
    render(<Composer chat={chat} />);
    type('one\ntwo');
    select(0, 7);
    fireEvent.click(within(toolbar()!).getByRole('button', { name: 'Quote' }));
    expect(textarea()).toHaveValue('> one\n> two');
  });

  it('Link asks for the address in the toolbar and makes a masked link', () => {
    render(<Composer chat={chat} />);
    type('read the docs');
    select(9, 13);
    fireEvent.click(within(toolbar()!).getByRole('button', { name: 'Link' }));
    const field = screen.getByRole('textbox', { name: 'Link address' });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: 'not a link' } });
    fireEvent.submit(field.closest('form')!);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(textarea()).toHaveValue('read the docs');
    fireEvent.change(field, { target: { value: 'enbox.app/help' } });
    fireEvent.submit(field.closest('form')!);
    expect(textarea()).toHaveValue('read the [docs](https://enbox.app/help)');
    expect(toolbar()).toBeNull();
  });

  it('Escape in the link field goes back to the buttons', async () => {
    render(<Composer chat={chat} />);
    type('read the docs');
    select(9, 13);
    fireEvent.click(within(toolbar()!).getByRole('button', { name: 'Link' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Link address' }), { key: 'Escape' });
    const link = within(toolbar()!).getByRole('button', { name: 'Link' });
    await waitFor(() => expect(link).toHaveFocus());
    expect(textarea()).toHaveValue('read the docs');
  });

  it('Alt+F10 reaches it; Escape closes it and goes back to the box', () => {
    render(<Composer chat={chat} />);
    type('focus me');
    select(0, 5);
    fireEvent.keyDown(textarea(), { key: 'F10', altKey: true });
    const bold = within(toolbar()!).getByRole('button', { name: 'Bold' });
    expect(bold).toHaveFocus();
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    expect(within(toolbar()!).getByRole('button', { name: 'Italic' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(toolbar()).toBeNull();
    expect(textarea()).toHaveFocus();
    expect(selection()).toEqual([0, 5]);
  });

  it('Escape in the box closes it for that selection', () => {
    render(<Composer chat={chat} />);
    type('quiet');
    select(0, 5);
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(toolbar()).toBeNull();
    fireEvent.mouseUp(textarea());
    expect(toolbar()).toBeNull();
    select(0, 2);
    expect(toolbar()).toBeInTheDocument();
  });
});

describe('send button preference', () => {
  it('shows the send button on desktop once there is text, when turned on', () => {
    const { unmount } = render(<Composer chat={chat} />);
    type('hi');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    unmount();
    useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false, showSendButton: true } });
    render(<Composer chat={chat} />);
    type('hi');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(useMessages.getState().sendMessage).toHaveBeenCalledTimes(1);
  });
});
