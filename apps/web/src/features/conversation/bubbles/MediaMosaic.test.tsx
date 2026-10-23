/**
 * Messages with several files: the mosaic layout for every count (1 natural, 2 halves, 3 one
 * large + two stacked, 2×2, 2+3, 3+3, 1+3+3, 2+3+3, 3×3, 1+3×3), tiles that open the viewer on
 * their index, videos with a play badge, alt text (`alt` + an ALT chip that shows it), the
 * other files as cards and players below, and a message without `attachments` as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MediaKind, MessageAttachment } from '@enbox/shared';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeMessage } from '@/test/factories';
import { MediaBody } from './MediaBody';
import { layoutLabel, messageFiles, mosaicLayout, visualFiles } from './attachments';

function file(
  i: number,
  kind: MediaKind = 'image',
  extra: Partial<MessageAttachment> = {},
): MessageAttachment {
  const ext =
    kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'pdf';
  return {
    id: `f${i}`,
    kind,
    url: `/uploads/f${i}.${ext}`,
    thumbnailUrl: kind === 'image' || kind === 'video' ? `/uploads/f${i}.thumb.jpg` : null,
    mimeType:
      kind === 'image'
        ? 'image/jpeg'
        : kind === 'video'
          ? 'video/mp4'
          : kind === 'audio'
            ? 'audio/mpeg'
            : 'application/pdf',
    fileName: `file${i}.${ext}`,
    size: 2048,
    width: 800,
    height: 600,
    animated: false,
    frameCount: null,
    durationMs: kind === 'video' ? 12_000 : kind === 'audio' ? 61_000 : null,
    waveform: null,
    description: null,
    ...extra,
  };
}

function messageOf(files: MessageAttachment[], opts: { attachments?: boolean } = {}) {
  const [first] = files;
  const { description: _, ...media } = first!;
  return makeMessage({
    id: 'msg-1',
    type: first!.kind,
    text: null,
    media,
    ...(opts.attachments === false ? {} : { attachments: files }),
  });
}

function renderBody(files: MessageAttachment[], opts: { attachments?: boolean } = {}) {
  const onOpen = vi.fn();
  const view = render(
    <MediaBody
      m={messageOf(files, opts)}
      onOpen={onOpen}
      onRetry={() => undefined}
      rounded="rounded-md"
    >
      <span data-testid="meta">10:42</span>
    </MediaBody>,
  );
  return { ...view, onOpen };
}

const images = (n: number) => Array.from({ length: n }, (_, i) => file(i));
const mosaicTiles = () => screen.queryAllByTestId('mosaic-tile');
const rowSizes = () =>
  screen.getAllByTestId('mosaic-row').map((r) => within(r).getAllByTestId('mosaic-tile').length);

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS });
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

describe('mosaicLayout', () => {
  it('lays out every count like Discord', () => {
    expect(Array.from({ length: 10 }, (_, i) => layoutLabel(mosaicLayout(i + 1)))).toEqual([
      '1',
      '2',
      'three',
      '2+2',
      '2+3',
      '3+3',
      '1+3+3',
      '2+3+3',
      '3+3+3',
      '1+3+3+3',
    ]);
  });

  it('lists a message’s files: `attachments`, else `media`; none once deleted', () => {
    const files = [file(0), file(1, 'file'), file(2, 'video')];
    expect(messageFiles(messageOf(files)).map((f) => f.id)).toEqual(['f0', 'f1', 'f2']);
    expect(visualFiles(messageOf(files)).map((f) => f.id)).toEqual(['f0', 'f2']);
    expect(messageFiles(messageOf([file(5)], { attachments: false }))).toEqual([
      { ...file(5), description: null },
    ]);
    expect(messageFiles({ ...messageOf(files), deletedAt: '2025-01-01T00:00:00Z' })).toEqual([]);
  });
});

describe('MediaBody with several files', () => {
  it.each([
    [2, '2', [2]],
    [4, '2+2', [2, 2]],
    [5, '2+3', [2, 3]],
    [6, '3+3', [3, 3]],
    [7, '1+3+3', [1, 3, 3]],
    [8, '2+3+3', [2, 3, 3]],
    [9, '3+3+3', [3, 3, 3]],
    [10, '1+3+3+3', [1, 3, 3, 3]],
  ])('%i photos: a %s mosaic', (n, label, rows) => {
    renderBody(images(n));
    const mosaic = screen.getByTestId('media-mosaic');
    expect(mosaic).toHaveAttribute('data-layout', label);
    expect(mosaicTiles()).toHaveLength(n);
    expect(rowSizes()).toEqual(rows);
    // Rounded outer corners, 4 px gaps.
    expect(mosaic).toHaveClass('rounded-md', 'gap-1', 'overflow-hidden');
    // In order.
    expect(
      mosaicTiles().map((t) => t.querySelector('img:not([aria-hidden])')?.getAttribute('alt')),
    ).toEqual(Array.from({ length: n }, () => 'Photo'));
  });

  it('3 photos: one large on the left, two stacked on the right', () => {
    renderBody(images(3));
    expect(screen.getByTestId('media-mosaic')).toHaveAttribute('data-layout', 'three');
    const [large, ...small] = mosaicTiles();
    expect(large).toHaveClass('row-span-2');
    expect(small).toHaveLength(2);
    for (const t of small) expect(t).not.toHaveClass('row-span-2');
    // Large tiles load the file, small ones the thumbnail.
    expect(large!.querySelector('img:not([aria-hidden])')).toHaveAttribute(
      'src',
      expect.stringContaining('/uploads/f0.jpg'),
    );
    expect(small[0]!.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/uploads/f1.thumb.jpg'),
    );
  });

  it('a tile opens the viewer on its index; videos sit in the grid with a play badge', () => {
    const { onOpen } = renderBody([file(0), file(1, 'video'), file(2)]);
    fireEvent.click(screen.getByRole('button', { name: 'Play video 2 of 3' }));
    expect(onOpen).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 3 of 3' }));
    expect(onOpen).toHaveBeenLastCalledWith(2);
    const video = mosaicTiles()[1]!;
    expect(video).toHaveAttribute('data-kind', 'video');
    expect(video).toHaveTextContent('0:12');
  });

  it('alt text: the picture’s alt and an ALT chip that shows it', () => {
    renderBody([file(0, 'image', { description: 'A red bicycle against a wall' }), file(1)]);
    const [described, plain] = mosaicTiles();
    expect(described!.querySelector('img:not([aria-hidden])')).toHaveAttribute(
      'alt',
      'A red bicycle against a wall',
    );
    expect(
      screen.getByRole('button', { name: 'Open photo: A red bicycle against a wall' }),
    ).toBeInTheDocument();
    expect(within(plain!).queryByRole('button', { name: 'Show alt text' })).toBeNull();
    fireEvent.click(within(described!).getByRole('button', { name: 'Show alt text' }));
    expect(screen.getByRole('dialog', { name: 'Alt text' })).toHaveTextContent(
      'A red bicycle against a wall',
    );
  });

  it('the other files go below as document cards and audio players, the time after them', () => {
    renderBody([file(0), file(1, 'file'), file(2), file(3, 'audio')]);
    expect(screen.getByTestId('media-mosaic')).toHaveAttribute('data-layout', '2');
    const below = screen.getAllByTestId('attachment-file');
    expect(below).toHaveLength(2);
    expect(within(below[0]!).getByText('file1.pdf')).toBeInTheDocument();
    expect(within(below[0]!).getByText(/2.0 KB/)).toBeInTheDocument();
    expect(within(below[0]!).getByRole('link', { name: 'Download file1.pdf' })).toHaveAttribute(
      'href',
      expect.stringContaining('/uploads/f1.pdf'),
    );
    expect(within(below[1]!).getByText('file3.mp3')).toBeInTheDocument();
    expect(within(below[1]!).getByRole('button', { name: 'Play audio' })).toBeInTheDocument();
    // The time is not laid over the pictures when files follow them.
    expect(within(screen.getByTestId('media-mosaic')).queryByTestId('meta')).toBeNull();
    expect(screen.getByTestId('meta')).toBeInTheDocument();
  });

  it('one photo among documents keeps its natural size; only documents list as cards', () => {
    const { onOpen } = renderBody([file(0, 'file'), file(1, 'image', { description: 'Receipt' })]);
    expect(screen.queryByTestId('media-mosaic')).toBeNull();
    const photo = screen.getByRole('button', { name: 'Open photo' });
    expect(photo.querySelector('img:not([aria-hidden])')).toHaveAttribute('alt', 'Receipt');
    expect(screen.getByRole('button', { name: 'Show alt text' })).toBeInTheDocument();
    fireEvent.click(photo);
    expect(onOpen).toHaveBeenCalledWith(0);
    expect(screen.getAllByTestId('attachment-file')).toHaveLength(1);
  });

  it('keeps each spoiler blurred until clicked', () => {
    renderBody([file(0, 'image', { fileName: 'SPOILER_twist.jpg' }), file(1)]);
    const [spoiler, other] = mosaicTiles();
    expect(within(spoiler!).getByText('SPOILER')).toBeInTheDocument();
    expect(within(other!).queryByText('SPOILER')).toBeNull();
    fireEvent.click(within(spoiler!).getByRole('button', { name: 'Reveal spoiler image' }));
    expect(within(spoiler!).queryByText('SPOILER')).toBeNull();
  });

  it('one file with alt text: the single picture with its alt and ALT chip', () => {
    const { onOpen } = renderBody([file(0, 'image', { description: 'Sunset over the bay' })]);
    expect(screen.queryByTestId('media-mosaic')).toBeNull();
    const photo = screen.getByRole('button', { name: 'Open photo' });
    expect(photo.querySelector('img:not([aria-hidden])')).toHaveAttribute(
      'alt',
      'Sunset over the bay',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show alt text' }));
    expect(screen.getByRole('dialog', { name: 'Alt text' })).toHaveTextContent(
      'Sunset over the bay',
    );
    fireEvent.click(photo);
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  it('a message without `attachments` renders as before', () => {
    renderBody([file(0)], { attachments: false });
    expect(screen.queryByTestId('media-mosaic')).toBeNull();
    expect(screen.queryByTestId('message-attachments')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show alt text' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open photo' })).toBeInTheDocument();
    expect(screen.getByTestId('meta')).toBeInTheDocument();
  });
});
