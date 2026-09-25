import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import type * as UiModule from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { cancelUpload, enqueueMedia } from './sendMedia';
import { uploadMedia } from './upload';

vi.mock('./upload', () => ({ uploadMedia: vi.fn() }));
vi.mock('@/stores/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const CHAT = 'chat-1';
const upload = vi.mocked(uploadMedia);
let urls = 0;
const revoke = vi.fn();

const input = () => ({
  kind: 'image' as const,
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  fileName: 'a.jpg',
  mimeType: 'image/jpeg',
  thumbnail: new Blob(['t'], { type: 'image/jpeg' }),
});

const bubbles = () => useMessages.getState().byChat[CHAT]?.items ?? [];

describe('media sends', () => {
  beforeEach(() => {
    resetSessionState();
    upload.mockReset();
    revoke.mockReset();
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => `blob:${++urls}`,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
    useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
    useChats.getState().upsertChat(makeChat({ id: CHAT }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('frees the thumbnail URL once the server copy is confirmed', async () => {
    upload.mockResolvedValue({ id: 'media-1', url: '/uploads/a.jpg' } as never);
    const job = enqueueMedia(CHAT, input());
    const clientId = bubbles()[0]!.clientId!;
    const thumbUrl = bubbles()[0]!.media!.thumbnailUrl;
    vi.spyOn(api, 'post').mockResolvedValue(
      makeMessage({ id: 'm1', seq: 1, clientId, senderId: 'me', type: 'image' }),
    );
    await job();
    expect(bubbles()[0]!.id).toBe('m1');
    expect(revoke).toHaveBeenCalledWith(thumbUrl);
  });

  it('a sent photo switches to the server copy once it is decoded, then frees the blob', async () => {
    let decoded!: () => void;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode() {
          return new Promise<void>((resolve) => (decoded = resolve));
        }
      },
    );
    const media = {
      id: 'media-2',
      kind: 'image',
      url: '/uploads/b.jpg',
      thumbnailUrl: '/uploads/b.thumb.jpg',
      mimeType: 'image/jpeg',
      fileName: 'b.jpg',
      size: 1,
      width: 10,
      height: 10,
      durationMs: null,
      waveform: null,
    } as const;
    upload.mockResolvedValue(media);
    const job = enqueueMedia(CHAT, input());
    const { clientId, localUrl } = bubbles()[0]!;
    vi.spyOn(api, 'post').mockResolvedValue(
      makeMessage({ id: 'm2', seq: 2, clientId, senderId: 'me', type: 'image', media }),
    );
    await job();
    // The bubble keeps the local copy (no flash) until the server image is ready.
    expect(bubbles()[0]).toMatchObject({ id: 'm2', localUrl });
    expect(revoke).not.toHaveBeenCalledWith(localUrl);
    decoded();
    await vi.waitFor(() => expect(bubbles()[0]!.localUrl).toBeUndefined());
    expect(revoke).toHaveBeenCalledWith(localUrl);
    vi.unstubAllGlobals();
  });

  it('cancelling a failed send removes its bubble and releases its blobs', async () => {
    upload.mockRejectedValue(new ApiError('payload_too_large', 'Too large', 413));
    const job = enqueueMedia(CHAT, input());
    await job();
    const failed = bubbles()[0]!;
    expect(failed.failed).toBe(true);
    expect(cancelUpload(failed.clientId!)).toBe(true);
    expect(bubbles()).toEqual([]);
    expect(revoke).toHaveBeenCalledWith(failed.localUrl);
    expect(cancelUpload(failed.clientId!)).toBe(false); // forgotten
  });

  it('a queued job whose bubble was deleted meanwhile sends nothing', async () => {
    const job = enqueueMedia(CHAT, input());
    useMessages.getState().removeOptimistic(CHAT, bubbles()[0]!.clientId!);
    await job();
    expect(upload).not.toHaveBeenCalled();
  });
});
