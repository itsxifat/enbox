import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MediaAttachment } from '@enbox/shared';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeMessage } from '@/test/factories';
import { MediaBody } from './MediaBody';

const POSTER = '/uploads/fun.webp';
const GIF = '/uploads/fun.gif';

function gifMessage(animated = true, extra: Partial<MediaAttachment> = {}) {
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
    ...extra,
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
    const photo = gifMessage(false, { url: '/uploads/pic.jpg', mimeType: 'image/jpeg' });
    const { img, container } = renderBody(photo);
    expect(img()).toHaveAttribute('src', '/uploads/pic.jpg');
    expect(container).not.toHaveTextContent('GIF');
    expect(screen.getByRole('button', { name: 'Open photo' })).toBeInTheDocument();
  });

  it('gates a GIF stored before uploads were probed (animated: false) like an animated one', () => {
    useUi.getState().setPref('reduceMotion', 'on');
    const { img, container } = renderBody(gifMessage(false));
    expect(img()).toHaveAttribute('src', POSTER);
    expect(container).toHaveTextContent('GIF');
  });

  it('shows a still tile for an animation without a poster under reduced motion, never or a hidden app', () => {
    const noPoster = () => gifMessage(true, { thumbnailUrl: null });
    const stillOnly = (view: ReturnType<typeof renderBody>) => {
      expect(view.container.querySelector('img')).toBeNull();
      expect(view.getByTestId('animated-still')).toBeInTheDocument();
      expect(view.container).toHaveTextContent('GIF');
      view.unmount();
    };
    useUi.getState().setPref('reduceMotion', 'on');
    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    stillOnly(renderBody(noPoster()));
    useUi.getState().setPref('reduceMotion', 'off');
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    const never = renderBody(noPoster());
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Play GIF' }), {
      pointerType: 'mouse',
    });
    stillOnly(never);
    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    stillOnly(renderBody(noPoster()));
    // With motion allowed it plays on hover, as with a poster.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    useUi.getState().setPref('autoplayAnimatedMedia', 'hover');
    const { img, container } = renderBody(noPoster());
    expect(container.querySelector('img')).toBeNull();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Play GIF' }), {
      pointerType: 'mouse',
    });
    expect(img()).toHaveAttribute('src', GIF);
  });
});

describe('MediaBody (spoilers)', () => {
  const photo = (fileName: string) =>
    gifMessage(false, { url: '/uploads/pic.jpg', mimeType: 'image/jpeg', fileName });

  it('blurs a SPOILER_ image behind a pill until clicked, without opening the viewer', () => {
    const { container, onOpen } = renderBody(photo('SPOILER_pic.jpg'));
    const media = container.querySelector('button[aria-hidden="true"]')!;
    expect(media).toHaveClass('blur-2xl');
    expect(media).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('SPOILER')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal spoiler image' }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText('SPOILER')).toBeNull();
    const open = screen.getByRole('button', { name: 'Open photo' });
    expect(open).not.toHaveClass('blur-2xl');
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps a spoiler GIF still and hides the video badge until revealed', () => {
    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    const gif = renderBody(gifMessage(true, { fileName: 'SPOILER_fun.gif' }));
    expect(gif.img()).toHaveAttribute('src', POSTER);
    expect(gif.container).not.toHaveTextContent('GIF');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal spoiler image' }));
    expect(gif.img()).toHaveAttribute('src', GIF);
    gif.unmount();
    const video = makeMessage({
      type: 'video',
      text: null,
      media: {
        ...gifMessage().media!,
        kind: 'video',
        mimeType: 'video/mp4',
        animated: false,
        fileName: 'SPOILER_clip.mp4',
      },
    });
    renderBody(video);
    expect(screen.getByRole('button', { name: 'Reveal spoiler video' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
  });

  it('shows other images as usual', () => {
    renderBody(photo('pic.jpg'));
    expect(screen.queryByText('SPOILER')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open photo' })).not.toHaveClass('blur-2xl');
  });
});
