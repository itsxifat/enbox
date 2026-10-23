import type { Space } from '@enbox/shared';

/** Space Settings ▸ Space Template: share this Space's structure as a template link. */
export function TemplatePage({ space }: { space: Space }) {
  return <p className="text-muted">Template of {space.name}</p>;
}
