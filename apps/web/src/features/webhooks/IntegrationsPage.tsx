import type { Space } from '@enbox/shared';

/** Space Settings ▸ Integrations: webhooks, and the channels followed into this Space. */
export function IntegrationsPage({ space }: { space: Space }) {
  return <p className="text-muted">Integrations of {space.name}</p>;
}
