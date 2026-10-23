import type { Space } from '@enbox/shared';

/** Space Settings ▸ Stickers: upload, rename and delete the Space's stickers. */
export function StickersPage({ space }: { space: Space }) {
  return <p className="text-muted">Stickers of {space.name}</p>;
}
