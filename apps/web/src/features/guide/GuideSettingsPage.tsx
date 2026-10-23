import type { Space } from '@enbox/shared';

/** Space Settings ▸ Server Guide: the welcome sign, to-dos and resources (the community builder). */
export function GuideSettingsPage({ space }: { space: Space }) {
  return <p className="text-muted">GuideSettingsPage for {space.name}</p>;
}
