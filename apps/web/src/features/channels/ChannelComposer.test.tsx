/**
 * SEC-1: channel photos go through the canvas re-encode (EXIF/GPS stripped, thumbnail) like
 * chat media; only the Document picker uploads the original file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { makeChat, makeMe } from '@/test/factories';
import { ChannelComposer } from './ChannelComposer';

const processing = vi.hoisted(() => ({ prepareVisualMedia: vi.fn() }));
const uploads = vi.hoisted(() => ({ uploadMedia: vi.fn() }));
vi.mock('@/features/conversation/lib/mediaProcessing', () => processing);
vi.mock('@/features/conversation/lib/upload', () => uploads);

const chat = makeChat({ id: 'chan-1', type: 'channel' });
const thumb = new Blob(['t'], { type: 'image/jpeg' });
const reencoded = new Blob(['clean'], { type: 'image/jpeg' });

function pick(container: HTMLElement, accept: string | null, file: File) {
  const inputs = [...container.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
  const input = inputs.find((i) => i.getAttribute('accept') === accept)!;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  URL.createObjectURL = () => 'blob:local'; // jsdom has none
  vi.spyOn(useMessages.getState(), 'sendMessage').mockResolvedValue(undefined as never);
});

afterEach(() => {
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  vi.restoreAllMocks();
  processing.prepareVisualMedia.mockReset();
  uploads.uploadMedia.mockReset();
});

describe('ChannelComposer uploads', () => {
  it('re-encodes a picked photo and uploads the clean copy with a thumbnail', async () => {
    processing.prepareVisualMedia.mockResolvedValue({
      kind: 'image',
      blob: reencoded,
      fileName: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      thumbnail: thumb,
    });
    uploads.uploadMedia.mockResolvedValue({ id: 'media-1' });
    const raw = vi.spyOn(api, 'upload');
    const { container } = render(<ChannelComposer chat={chat} />);
    const original = new File(['exif+gps'], 'IMG_0001.jpg', { type: 'image/jpeg' });
    pick(container, 'image/*,video/*', original);
    await vi.waitFor(() => expect(uploads.uploadMedia).toHaveBeenCalled());
    expect(processing.prepareVisualMedia).toHaveBeenCalledWith(original);
    const [blob, meta, opts] = uploads.uploadMedia.mock.calls[0]!;
    expect(blob).toBe(reencoded);
    expect(meta).toEqual({ kind: 'image', width: 1600, height: 1200, durationMs: undefined });
    expect(opts).toMatchObject({ fileName: 'IMG_0001.jpg', thumbnail: thumb });
    expect(raw).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(useMessages.getState().sendMessage).toHaveBeenCalledWith(
        'chan-1',
        expect.objectContaining({ type: 'image', mediaId: 'media-1' }),
      ),
    );
  });

  it('never falls back to the original when the photo cannot be processed', async () => {
    processing.prepareVisualMedia.mockRejectedValue(new Error('HEIC not supported'));
    const raw = vi.spyOn(api, 'upload');
    const markFailed = vi.spyOn(useMessages.getState(), 'markFailed');
    const { container } = render(<ChannelComposer chat={chat} />);
    pick(container, 'image/*,video/*', new File(['x'], 'a.heic', { type: 'image/heic' }));
    await vi.waitFor(() => expect(markFailed).toHaveBeenCalled());
    expect(raw).not.toHaveBeenCalled();
    expect(uploads.uploadMedia).not.toHaveBeenCalled();
  });

  it('uploads documents unchanged', async () => {
    const raw = vi.spyOn(api, 'upload').mockResolvedValue({ id: 'media-2' } as never);
    const { container } = render(<ChannelComposer chat={chat} />);
    const doc = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    pick(container, null, doc);
    await vi.waitFor(() => expect(raw).toHaveBeenCalled());
    expect(raw.mock.calls[0]![0]).toBe(doc);
    expect(processing.prepareVisualMedia).not.toHaveBeenCalled();
  });
});
