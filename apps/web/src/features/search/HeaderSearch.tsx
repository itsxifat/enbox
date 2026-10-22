/**
 * Discord's header search, rendered in the Space channel header and the DM header
 * (`{ scope, chatId }`).
 * - Desktop: the search box itself (SearchBox: chips, suggestions, Enter opens the results
 *   panel beside the conversation, Esc clears, Ctrl/Cmd+F focuses it).
 * - Phones: a Search button opening a full-screen sheet with the box and the results.
 */
import { useState } from 'react';
import { Search } from 'lucide-react';
import { IconButton, Sheet } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { scopeKey } from '@/stores/search';
import { useSidePanel, type SearchScope } from '@/stores/sidePanel';
import { useSpace } from '@/stores/spaces';
import { SearchBox } from './SearchBox';
import { SearchResults } from './SearchResultsPanel';

export function HeaderSearch({ scope }: { scope: SearchScope; chatId: string }) {
  const desktop = useIsDesktop();
  const space = useSpace(scope.kind === 'space' ? scope.spaceId : null);
  const placeholder = space ? `Search ${space.name}` : 'Search';
  if (desktop) return <SearchBox scope={scope} placeholder={placeholder} shortcut />;
  return <PhoneSearch scope={scope} placeholder={placeholder} />;
}

function PhoneSearch({ scope, placeholder }: { scope: SearchScope; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const key = scopeKey(scope);
  const query = useSidePanel((s) =>
    s.panel?.kind === 'search' && scopeKey(s.panel.scope) === key ? s.panel.query : null,
  );
  const close = () => {
    setOpen(false);
    if (query !== null) useSidePanel.getState().close();
  };
  return (
    <>
      <IconButton icon={Search} label="Search" variant="ghost" onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={close} title="Search" aria-label="Search messages">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 pb-2">
            <SearchBox scope={scope} placeholder={placeholder} fullWidth autoFocus />
          </div>
          {query !== null ? (
            <SearchResults
              key={`${key}|${query}`}
              scope={scope}
              query={query}
              variant="sheet"
              onClose={close}
              onJumped={() => setOpen(false)}
            />
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
