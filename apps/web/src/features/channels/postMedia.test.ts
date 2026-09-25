import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@enbox/shared';
import { useUi } from '@/stores/ui';

const order: string[] = [];
const enqueueMedia = vi.fn((_chatId: string, input: { fileName: string }) => {
  order.push(`enqueue:${input.fileName}`);
  return async () => {
    order.push(`run:${input.fileName}`);
  };
});
const prepareVisualMedia = vi.fn(async (file: File) => {
  if (file.name === 'broken.heic') throw new Error('decode');
  return {
    kind: 'image' as const,
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    fileName: file.name.replace(/\.\w+$/, '.jpg'),
    mimeType: 'image/jpeg',
    width: 100,
    height: 80,
    thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
  };
});

vi.mock('@/features/conversation/lib/sendMedia', () => ({ enqueueMedia }));
vi.mock('@/features/conversation/lib/mediaProcessing', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  prepareVisualMedia,
}));

const { postFiles } = await import('./postMedia');

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('channel attachments (postFiles)', () => {
  afterEach(() => {
    order.length = 0;
    enqueueMedia.mockClear();
    prepareVisualMedia.mockClear();
    useUi.setState({ toasts: [] });
  });

  it('re-encodes photos (never uploads the original), captions only the first, keeps order', async () => {
    const a = file('a.jpg', 'image/jpeg');
    const b = file('b.png', 'image/png');
    await postFiles('ch', [a, b], { asDocument: false, caption: '  Hello  ' });
    expect(prepareVisualMedia).toHaveBeenCalledTimes(2);
    const calls = enqueueMedia.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(calls[0]).toMatchObject({ fileName: 'a.jpg', mimeType: 'image/jpeg', caption: 'Hello' });
    expect(calls[0]!.blob).not.toBe(a);
    expect(calls[0]!.thumbnail).toBeInstanceOf(Blob);
    expect(calls[1]!.caption).toBeUndefined();
    expect(order).toEqual(['enqueue:a.jpg', 'enqueue:b.jpg', 'run:a.jpg', 'run:b.jpg']);
  });

  it('uploads documents unchanged', async () => {
    const pdf = file('slides.pdf', 'application/pdf');
    await postFiles('ch', [pdf], { asDocument: true, caption: 'Deck' });
    expect(prepareVisualMedia).not.toHaveBeenCalled();
    expect(enqueueMedia.mock.calls[0]![1]).toMatchObject({
      kind: 'file',
      blob: pdf,
      fileName: 'slides.pdf',
      mimeType: 'application/pdf',
      caption: 'Deck',
    });
  });

  it('skips files that are too big or cannot be processed, with a toast', async () => {
    const big = file('huge.mp4', 'video/mp4', MAX_UPLOAD_BYTES + 1);
    const broken = file('broken.heic', 'image/heic');
    const ok = file('ok.jpg', 'image/jpeg');
    await postFiles('ch', [big, broken, ok], { asDocument: false, caption: 'Cap' });
    expect(enqueueMedia).toHaveBeenCalledTimes(1);
    // The caption moves to the first post actually sent.
    expect(enqueueMedia.mock.calls[0]![1]).toMatchObject({ fileName: 'ok.jpg', caption: 'Cap' });
    const toasts = useUi.getState().toasts.map((t) => t.message);
    expect(toasts.some((m) => m.includes('huge.mp4'))).toBe(true);
    expect(toasts.some((m) => m.includes('broken.heic'))).toBe(true);
  });
});
