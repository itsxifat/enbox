import type { Space } from '@enbox/shared';

/** Space Settings ▸ Reports: reports of this Space's content, for its moderators. */
export function ReportsPage({ space }: { space: Space }) {
  return <p className="text-muted">Reports in {space.name}</p>;
}
