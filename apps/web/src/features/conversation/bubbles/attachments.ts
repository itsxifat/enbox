/**
 * The files of a message (Discord: up to 10): `Message.attachments` in order — [0] is
 * `Message.media` — or just `media` when absent (one file, no alt text). Photos and videos go
 * in the mosaic (`mosaicLayout`) and the viewer's gallery; the other files are listed below it.
 */
import type { MediaAttachment, MessageAttachment } from '@enbox/shared';
import type { ClientMessage } from '@/stores/messages';

/** Every file of a message, in order (none when deleted). */
export function messageFiles(
  m: Pick<ClientMessage, 'media' | 'attachments' | 'deletedAt'>,
): MessageAttachment[] {
  if (m.deletedAt) return [];
  if (m.attachments?.length) return m.attachments;
  return m.media ? [{ ...m.media, description: null }] : [];
}

/** Photos and videos (the mosaic); voice notes, audio and documents are not. */
export function isVisualFile(file: Pick<MediaAttachment, 'kind'>): boolean {
  return file.kind === 'image' || file.kind === 'video';
}

/** The photos and videos of a message, in order: the mosaic's tiles and the viewer's gallery. */
export function visualFiles(
  m: Pick<ClientMessage, 'media' | 'attachments' | 'deletedAt'>,
): MessageAttachment[] {
  return messageFiles(m).filter(isVisualFile);
}

/**
 * How a mosaic of `count` photos and videos is laid out (Discord): `rows` lists how many tiles
 * each row holds, top to bottom (2 = two halves, 4 = 2×2, 5 = 2 + 3 … 10 = 1 + 3×3), except
 * three, which is one large tile on the left and two stacked on the right. One file is shown
 * at its natural size instead (`MediaBody`).
 */
export type MosaicLayout = { kind: 'rows'; rows: number[] } | { kind: 'three' };

export function mosaicLayout(count: number): MosaicLayout {
  const n = Math.max(1, Math.floor(count));
  if (n === 3) return { kind: 'three' };
  if (n <= 2) return { kind: 'rows', rows: [n] };
  if (n === 4) return { kind: 'rows', rows: [2, 2] };
  // Rows of three, the remainder (one or two) on top: 5 = 2+3, 7 = 1+3+3, 10 = 1+3+3+3.
  const rest = n % 3;
  return {
    kind: 'rows',
    rows: [...(rest ? [rest] : []), ...Array.from({ length: Math.floor(n / 3) }, () => 3)],
  };
}

/** "2+3", "three"…: the layout as a short label (tests, `data-layout`). */
export function layoutLabel(layout: MosaicLayout): string {
  return layout.kind === 'three' ? 'three' : layout.rows.join('+');
}

/**
 * One file of a message as a message of its own, for the single-file bodies (document card,
 * audio player): its own id (the audio player's track) and no upload state.
 */
export function fileMessage(m: ClientMessage, file: MediaAttachment, index: number): ClientMessage {
  return {
    ...m,
    id: `${m.id}:${index}`,
    clientId: null,
    type: file.kind,
    media: file,
    attachments: undefined,
    localUrl: undefined,
    uploadProgress: undefined,
  };
}
