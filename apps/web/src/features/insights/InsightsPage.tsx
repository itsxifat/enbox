import type { Space } from '@enbox/shared';

/** Space Settings ▸ Insights: activity charts and CSV (the insights builder). */
export function InsightsPage({ space }: { space: Space }) {
  return <p className="text-muted">InsightsPage for {space.name}</p>;
}
