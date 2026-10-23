import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import type * as UiModule from '@/stores/ui';
import type { MediaAttachment, MediaKind } from '@enbox/shared';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { cancelUpload, enqueueMedia, sendAttachments, uploadAll } from './sendMedia';
import { uploadMedia } from './upload';

vi.mock('./upload', () => ({ uploadMedia: vi.fn() }));
vi.mock('./mediaProcessing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareVisualMedia: vi.fn(async (file: File) => ({
    kind: 'image',
    blob: file,
    fileName: file.name,
    mimeType: file.type,
    width: 10,
    height: 10,
    thumbnail: null,
  })),
}));
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
      animated: false,
      frameCount: null,
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

describe('messages with several files', () => {
  const server = (id: string, kind: MediaKind): MediaAttachment => ({
    id,
    kind,
    url: `/uploads/${id}`,
    thumbnailUrl: null,
    mimeType: kind === 'image' ? 'image/jpeg' : 'application/pdf',
    fileName: id,
    size: 1,
    width: null,
    height: null,
    animated: false,
    frameCount: null,
    durationMs: null,
    waveform: null,
  });
  const pick = (name: string, type: string) => new File(['x'], name, { type });
  const callbacks = () => ({ onProgress: vi.fn(), onUploaded: vi.fn(), onFailed: vi.fn() });

  beforeEach(() => {
    resetSessionState();
    upload.mockReset();
    useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
    useChats.getState().upsertChat(makeChat({ id: CHAT }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('uploadAll: every file in order with progress, skipping those already up', async () => {
    upload.mockImplementation(async (_blob, meta, opts) => {
      opts?.onProgress?.(0.5);
      return server(`m-${opts!.fileName}`, meta.kind);
    });
    const cb = callbacks();
    const done = server('m-kept', 'file');
    const media = await uploadAll(
      [
        { id: 't1', file: pick('a.png', 'image/png'), kind: 'visual' },
        { id: 't2', file: pick('kept.pdf', 'application/pdf'), kind: 'file', media: done },
        { id: 't3', file: pick('b.pdf', 'application/pdf'), kind: 'file' },
      ],
      new AbortController().signal,
      cb,
    );
    expect(media!.map((m) => m.id)).toEqual(['m-a.png', 'm-kept', 'm-b.pdf']);
    expect(upload.mock.calls.map((c) => [c[1].kind, c[2]!.fileName])).toEqual([
      ['image', 'a.png'],
      ['file', 'b.pdf'],
    ]);
    expect(cb.onProgress.mock.calls).toEqual([
      ['t1', 0.5],
      ['t3', 0.5],
    ]);
    expect(cb.onUploaded.mock.calls.map((c) => c[0])).toEqual(['t1', 't3']);
    expect(cb.onFailed).not.toHaveBeenCalled();
  });

  it('uploadAll: a failure resolves null after the others went up; an abort too', async () => {
    upload.mockImplementation(async (_blob, meta, opts) => {
      if (opts!.fileName === 'bad.pdf') throw new ApiError('payload_too_large', 'Too large', 413);
      return server(`m-${opts!.fileName}`, meta.kind);
    });
    const cb = callbacks();
    const files = [
      { id: 't1', file: pick('bad.pdf', 'application/pdf'), kind: 'file' as const },
      { id: 't2', file: pick('ok.pdf', 'application/pdf'), kind: 'file' as const },
    ];
    expect(await uploadAll(files, new AbortController().signal, cb)).toBeNull();
    expect(cb.onFailed).toHaveBeenCalledWith('t1', expect.any(ApiError));
    expect(cb.onUploaded).toHaveBeenCalledWith('t2', expect.objectContaining({ id: 'm-ok.pdf' }));

    const aborted = new AbortController();
    aborted.abort();
    upload.mockClear();
    expect(await uploadAll(files.slice(1), aborted.signal, callbacks())).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('sendAttachments: one message, photos and videos first, alt text aligned, the caption trimmed', async () => {
    const send = vi
      .spyOn(useMessages.getState(), 'sendMessage')
      .mockResolvedValue(undefined as never);
    await sendAttachments(
      CHAT,
      [
        { media: server('doc', 'file'), description: 'The March invoice' },
        { media: server('p1', 'image'), description: '   ' },
        { media: server('v1', 'video'), description: ' A goal ' },
      ],
      { caption: '  three files  ', replyToId: 'r1', mentionRepliedAuthor: false },
    );
    const [chatId, req, opts] = send.mock.calls[0]!;
    expect(chatId).toBe(CHAT);
    expect(req).toMatchObject({
      type: 'image',
      mediaId: 'p1',
      extraMediaIds: ['v1', 'doc'],
      descriptions: [null, 'A goal', 'The March invoice'],
      text: 'three files',
      replyToId: 'r1',
      mentionRepliedAuthor: false,
    });
    expect(opts!.optimistic!.media).toMatchObject({ id: 'p1' });
    expect(opts!.optimistic!.attachments!.map((a) => [a.id, a.description])).toEqual([
      ['p1', null],
      ['v1', 'A goal'],
      ['doc', 'The March invoice'],
    ]);

    // One file without alt text: a plain media message.
    await sendAttachments(CHAT, [{ media: server('solo', 'file') }]);
    const [, single, singleOpts] = send.mock.calls[1]!;
    expect(single).toMatchObject({ type: 'file', mediaId: 'solo' });
    expect(single).not.toHaveProperty('extraMediaIds');
    expect(single).not.toHaveProperty('descriptions');
    expect(singleOpts!.optimistic).not.toHaveProperty('attachments');
  });
});
