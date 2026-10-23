import { lazyNamed } from '@/lib/lazy';

/** The sticker picker is only downloaded when first opened. Render it under <Suspense>. */
export const LazyStickerPicker = lazyNamed(() => import('./StickerPicker'), 'StickerPicker');
