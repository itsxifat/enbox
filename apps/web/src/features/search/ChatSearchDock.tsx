/**
 * DMs and groups: the search results docked on the right of the conversation (desktop), in
 * the same card with a darker background and no divider (Discord). The wrapper is always
 * rendered so opening the results never remounts the conversation. A search of another chat
 * closes once this one opens.
 */
import { useEffect, type ReactNode } from 'react';
import type { ID } from '@enbox/shared';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useSidePanel } from '@/stores/sidePanel';
import { SearchResultsPanel } from './SearchResultsPanel';

export function ChatSearchDock({ chatId, children }: { chatId: ID; children: ReactNode }) {
  const desktop = useIsDesktop();
  const scope = useSidePanel((s) =>
    s.panel?.kind === 'search' && s.panel.scope.kind === 'chat' ? s.panel.scope : null,
  );
  const query = useSidePanel((s) => (s.panel?.kind === 'search' ? s.panel.query : ''));
  const other = !!scope && scope.chatId !== chatId;
  useEffect(() => {
    if (other) useSidePanel.getState().close();
  }, [other]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {desktop && scope && !other ? <SearchResultsPanel scope={scope} query={query} variant="inset" /> : null}
    </div>
  );
}
