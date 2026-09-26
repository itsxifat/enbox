import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MediaAttachment } from '@enbox/shared';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeMessage } from '@/test/factories';
import { MediaBody } from './MediaBody';

const POSTER = '/uploads/fun.webp';
const GIF = '/uploads/fun.gif';

function gifMessage(animated = true) {
  const media: MediaAttachment = {
    id: 'm1',
    kind: 'image',
    url: GIF,
    thumbnailUrl: POSTER,
    mimeType: 'image/gif',
    fileName: 'fun.gif',
    size: 1234,
    width: 400,
    height: 300,
    animated,
    frameCount: animated ? 12 : null,
    durationMs: null,
    waveform: null,
  };
  return makeMessage({ type: 'image', media, text: null });
}

function renderBody(m = gifMessage()) {
  const onOpen = vi.fn();
  const view = render(<MediaBody m={m} onOpen={onOpen} onRetry={() => undefined} rounded="" />);
  const img = () => view.container.querySelector('img:not([aria-hidden])')!;
  return { ...view, onOpen, img };
}

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

describe('MediaBody (animated images)', () => {
  it('shows the poster with a GIF badge and plays on hover', () => {
    const { img, container } = renderBody();
    expect(img()).toHaveAttribute('src', POSTER);
    expect(container).toHaveTextContent('GIF');
    const button = screen.getByRole('button', { name: 'Play GIF' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(img()).toHaveAttribute('src', GIF);
    expect(container).not.toHaveTextContent('GIF');
    expect(screen.getByRole('button', { name: 'Open GIF' })).toBeInTheDocument();
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    expect(img()).toHaveAttribute('src', POSTER);
  });

  it('plays on the first tap and opens the viewer on the next', () => {
    const { img, onOpen } = renderBody();
    fireEvent.click(screen.getByRole('button', { name: 'Play GIF' }));
    expect(img()).toHaveAttribute('src', GIF);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open GIF' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("plays right away under 'always' and stays still under 'never'", () => {
    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    const always = renderBody();
    expect(always.img()).toHaveAttribute('src', GIF);
    always.unmount();
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    const never = renderBody();
    expect(never.img()).toHaveAttribute('src', POSTER);
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Play GIF' }), {
      pointerType: 'mouse',
    });
    expect(never.img()).toHaveAttribute('src', POSTER);
    fireEvent.click(screen.getByRole('button', { name: 'Play GIF' }));
    expect(never.onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the poster under reduced motion', () => {
    useUi.getState().setPref('reduceMotion', 'on');
    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    const { img } = renderBody();
    expect(img()).toHaveAttribute('src', POSTER);
  });

  it('renders a still image as a photo without a badge', () => {
    const { img, container } = renderBody(gifMessage(false));
    expect(img()).toHaveAttribute('src', GIF);
    expect(container).not.toHaveTextContent('GIF');
    expect(screen.getByRole('button', { name: 'Open photo' })).toBeInTheDocument();
  });
});
