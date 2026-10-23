/**
 * Sticker messages: a frameless 160 px picture whose alt is the sticker's name (no viewer),
 * still or playing by the device pref and hover, and the popout (large, name, description,
 * "From <Space>" when I am in it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MediaAttachment, Message } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import { CozyMessageRow } from '@/features/conversation/CozyMessageRow';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { useStickers } from '@/stores/stickers';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { StickerBody } from './StickerBody';

const GIF: MediaAttachment = {
  id: 'media-1',
  kind: 'image',
  url: '/uploads/2026/10/wave.gif',
  thumbnailUrl: '/uploads/2026/10/wave-poster.webp',
  mimeType: 'image/gif',
  fileName: 'wave.gif',
  size: 2048,
  width: 320,
  height: 320,
  animated: true,
  frameCount: 12,
  durationMs: null,
  waveform: null,
};

const message = (p: Partial<Message> = {}): Message =>
  makeMessage({
    id: 'msg-1',
    chatId: 'chat-1',
    senderId: 'u2',
    type: 'image',
    text: null,
    media: GIF,
    sticker: { id: 'st1', name: 'Wave', spaceId: 's1' },
    ...p,
  });

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS });
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useStickers.setState({ groups: null, bySpace: {}, stale: false });
  useSpaces.setState({
    byId: { s1: makeSpace({ id: 's1', name: 'Alpha', iconUrl: '/uploads/alpha.png' }) },
    order: ['s1'],
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

function inRow(m: Message) {
  return render(
    <div data-animate-avatars data-testid="row">
      <StickerBody m={m} />
    </div>,
  );
}

describe('StickerBody', () => {
  it('a message row shows the sticker frameless at 160×160 with its name as alt, not as a photo', () => {
    const chat = makeChat({ id: 'chat-1', type: 'group' });
    const m = message({
      media: {
        ...GIF,
        url: '/uploads/2026/10/wave.png',
        mimeType: 'image/png',
        animated: false,
        thumbnailUrl: null,
      },
    });
    render(
      <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
        <CozyMessageRow
          row={{
            key: m.id,
            message: m,
            mine: false,
            showDay: false,
            unreadDivider: 0,
            firstInGroup: true,
            lastInGroup: true,
          }}
          chat={chat}
          onJump={() => undefined}
          onJumpById={() => undefined}
        />
      </RowAppearanceContext.Provider>,
    );
    const img = within(screen.getByTestId('sticker-body')).getByRole('img', { name: 'Wave' });
    expect(img).toHaveAttribute('width', '160');
    expect(img).toHaveAttribute('height', '160');
    expect(img.className).toContain('object-contain');
    expect(img.getAttribute('src')).toMatch(/\/uploads\/2026\/10\/wave\.png$/);
    expect(screen.queryByRole('button', { name: 'Open photo' })).toBeNull();
  });

  it('animated: its poster until the row is hovered on "hover"; "always" plays, "never" and reduced motion never do', () => {
    const { unmount } = inRow(message());
    const img = () => screen.getByRole('img', { name: 'Wave' });
    expect(img().getAttribute('src')).toMatch(/wave-poster\.webp$/);
    expect(img()).toHaveAttribute('data-animated', 'still');
    fireEvent.pointerEnter(screen.getByTestId('row'));
    expect(img().getAttribute('src')).toMatch(/wave\.gif$/);
    expect(img()).toHaveAttribute('data-animated', 'playing');
    fireEvent.pointerLeave(screen.getByTestId('row'));
    expect(img().getAttribute('src')).toMatch(/wave-poster\.webp$/);
    unmount();

    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    const second = inRow(message());
    expect(img()).toHaveAttribute('data-animated', 'playing');
    second.unmount();

    useUi.getState().setPref('reduceMotion', 'on');
    const third = inRow(message());
    expect(img()).toHaveAttribute('data-animated', 'still');
    third.unmount();

    useUi.getState().setPref('reduceMotion', 'off');
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    inRow(message());
    fireEvent.pointerEnter(screen.getByTestId('row'));
    expect(img()).toHaveAttribute('data-animated', 'still');
  });

  it('a click opens the popout: the sticker large, its name and description, and "From" my Space', () => {
    useStickers.setState({
      groups: [
        {
          spaceId: 's1',
          spaceName: 'Alpha',
          iconUrl: null,
          stickers: [
            {
              id: 'st1',
              spaceId: 's1',
              name: 'Wave',
              description: 'Hello there',
              emoji: '👋',
              url: GIF.url,
              animated: true,
              createdBy: 'u1',
            },
          ],
        },
      ],
    });
    inRow(message());
    fireEvent.click(screen.getByRole('button', { name: 'Wave' }));
    const pop = screen.getByTestId('sticker-popout');
    expect(within(pop).getByRole('img', { name: 'Wave' })).toHaveAttribute('width', '208');
    expect(pop).toHaveTextContent('Hello there');
    expect(pop).toHaveTextContent('From Alpha');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('sticker-popout')).toBeNull();
  });

  it('a sticker of a Space I am not in shows no "From" line; a pending one does not open', () => {
    const { unmount } = inRow(
      message({ sticker: { id: 'st9', name: 'Elsewhere', spaceId: 's9' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getByTestId('sticker-popout')).not.toHaveTextContent('From');
    unmount();
    inRow({ ...message(), pending: true } as ClientMessage);
    fireEvent.click(screen.getByRole('button', { name: 'Wave' }));
    expect(screen.queryByTestId('sticker-popout')).toBeNull();
  });
});
