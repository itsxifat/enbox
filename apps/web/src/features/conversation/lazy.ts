import { lazyNamed } from '@/lib/lazy';

/** Code-split heavy conversation pieces. Render them under <Suspense>. */
export const LazyEmojiPicker = lazyNamed(() => import('./EmojiPickerPanel'), 'EmojiPickerPanel');
export const LazyLightbox = lazyNamed(() => import('./Lightbox'), 'Lightbox');
