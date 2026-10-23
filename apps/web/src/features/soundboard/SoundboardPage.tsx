import type { Space } from '@enbox/shared';

/** Space Settings ▸ Soundboard: upload, rename and delete the Space's sounds. */
export function SoundboardPage({ space }: { space: Space }) {
  return <p className="text-muted">Soundboard of {space.name}</p>;
}
