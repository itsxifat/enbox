/**
 * The media viewer's gallery: a message with several photos and videos is browsed on its own
 * (← → buttons and keys, swipe, a "3 / 7" counter, its thumbnail strip, the alt text under
 * the media, download / open original, Esc closes); a single-file message walks the chat's
 * photos and videos as before (the loaded ones plus the chat's media list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MediaKind, Message, MessageAttachment } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { EMPTY_CHAT_MESSAGES, useMessages } from '@/stores/messages';
import { makeMe, makeMessage } from '@/test/factories';
import { Lightbox } from './Lightbox';
import { useConversationUi } from './state';

const CHAT = 'chat-1';

function file(id: string, kind: MediaKind = 'image', description: string | null = null) {
  return {
    id,
    kind,
    url: `/uploads/${id}.${kind === 'video' ? 'mp4' : kind === 'image' ? 'jpg' : 'pdf'}`,
    thumbnailUrl: kind === 'file' ? null : `/uploads/${id}.thumb.jpg`,
    mimeType: kind === 'video' ? 'video/mp4' : kind === 'image' ? 'image/jpeg' : 'application/pdf',
    fileName: `${id}.${kind === 'video' ? 'mp4' : kind === 'image' ? 'jpg' : 'pdf'}`,
    size: 100,
    width: 640,
    height: 480,
    animated: false,
    frameCount: null,
    durationMs: null,
    waveform: null,
    description,
  } satisfies MessageAttachment;
}

function message(id: string, seq: number, files: MessageAttachment[], text: string | null = null) {
  const { description: _, ...media } = files[0]!;
  return makeMessage({
    id,
    chatId: CHAT,
    seq,
    type: media.kind,
    text,
    media,
    ...(files.length > 1 || files.some((f) => f.description) ? { attachments: files } : {}),
  });
}

function load(messages: Message[]) {
  useMessages.setState({
    byChat: { [CHAT]: { ...EMPTY_CHAT_MESSAGES, items: messages, loaded: true } },
  });
}

function open(messageId: string, index?: number) {
  act(() => useConversationUi.getState().openViewer({ chatId: CHAT, messageId, index }));
}

const shown = () =>
  screen
    .getByRole('dialog', { name: 'Media viewer' })
    .querySelector('img[src*="/uploads/"]:not([alt=""]), video');
const counter = () => screen.queryByTestId('viewer-counter')?.textContent;
const key = (k: string) => fireEvent.keyDown(window, { key: k });

/** jsdom has no PointerEvent: a MouseEvent carrying `pointerType` (the swipe reads both). */
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'mouse';
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeEach(() => {
  resetSessionState();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
  useMessages.setState({ byChat: {} });
});
afterEach(() => act(() => useConversationUi.getState().openViewer(null)));

describe('Lightbox', () => {
  it('browses the photos and videos of a message with several files', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);
    const album = message(
      'album',
      3,
      [
        file('a'),
        file('doc', 'file'),
        file('b', 'image', 'Two kids on a seesaw'),
        file('c', 'video'),
      ],
      'Saturday',
    );
    load([message('before', 1, [file('x')]), album, message('after', 5, [file('y')])]);
    open('album', 1);
    render(<Lightbox />);

    expect(counter()).toBe('2 / 3');
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/b.jpg'));
    expect(shown()).toHaveAttribute('alt', 'Two kids on a seesaw');
    // The alt text under the media, with the caption.
    expect(screen.getByTestId('viewer-alt')).toHaveTextContent('Two kids on a seesaw');
    expect(screen.getByText('Saturday')).toBeInTheDocument();
    // Only this message's photos and videos (not the document, not the chat's other media).
    const strip = screen.getByTestId('viewer-strip');
    expect(within(strip).getAllByRole('button')).toHaveLength(3);
    expect(within(strip).getByRole('button', { name: 'Photo 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(get).not.toHaveBeenCalled();

    key('ArrowRight');
    expect(counter()).toBe('3 / 3');
    expect(shown()!.tagName).toBe('VIDEO');
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/c.mp4'));
    expect(screen.queryByTestId('viewer-alt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    key('ArrowRight');
    expect(counter()).toBe('3 / 3');

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    key('ArrowLeft');
    expect(counter()).toBe('1 / 3');
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/a.jpg'));
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: 'Video 3' }));
    expect(counter()).toBe('3 / 3');

    // Download and open the original.
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'c.mp4');
    const original = screen.getByRole('link', { name: 'Open original' });
    expect(original).toHaveAttribute('href', expect.stringContaining('/uploads/c.mp4'));
    expect(original).toHaveAttribute('target', '_blank');

    // Swipe on touch.
    const stage = shown()!.parentElement!;
    fireEvent.pointerDown(stage, { clientX: 100, clientY: 200, pointerType: 'touch' });
    fireEvent.pointerUp(stage, { clientX: 260, clientY: 205, pointerType: 'touch' });
    expect(counter()).toBe('2 / 3');

    key('Escape');
    expect(useConversationUi.getState().viewer).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Media viewer' })).toBeNull();
  });

  it('a single-file message walks the chat’s photos and videos, messages with several flattened', async () => {
    const older = message('older', 1, [file('o')]);
    vi.spyOn(api, 'get').mockResolvedValue([older]);
    load([
      message('pair', 4, [file('p1'), file('p2', 'image', 'Second of two')]),
      message('doc', 5, [file('d', 'file')]),
      message('last', 6, [file('l')]),
    ]);
    open('last');
    render(<Lightbox />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(`/api/chats/${CHAT}/media`, expect.anything()),
    );

    expect(counter()).toBeUndefined();
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/l.jpg'));
    await waitFor(() =>
      expect(within(screen.getByTestId('viewer-strip')).getAllByRole('button')).toHaveLength(4),
    );
    key('ArrowLeft');
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/p2.jpg'));
    expect(screen.getByTestId('viewer-alt')).toHaveTextContent('Second of two');
    key('ArrowLeft');
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/p1.jpg'));
    key('ArrowLeft');
    expect(shown()).toHaveAttribute('src', expect.stringContaining('/uploads/o.jpg'));
  });
});
