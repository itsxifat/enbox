/**
 * The Inbox popout's content: the title with the tab's action (Mentions: the filter menu;
 * Unreads: Mark all as read), the Mentions / Unreads tabs and the open tab's list.
 */
import { useId } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { Tabs } from '@/components/ui';
import { useInbox, type InboxTab } from '@/stores/inbox';
import { MentionsFilterMenu, MentionsTab } from './MentionsTab';
import { MarkAllReadButton, UnreadsTab } from './UnreadsTab';

const TABS: { value: InboxTab; label: string }[] = [
  { value: 'mentions', label: 'Mentions' },
  { value: 'unreads', label: 'Unreads' },
];

export function InboxPopout({ spaceId, onClose }: { spaceId: ID | null; onClose: () => void }) {
  const tab = useInbox((s) => s.tab);
  const setTab = useInbox((s) => s.setTab);
  const idBase = useId();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-popout">
      <header className="flex min-h-12 items-center gap-2 pt-2 pr-2 pl-4">
        <InboxIcon size={20} className="shrink-0 text-muted" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold text-fg">Inbox</h2>
        {tab === 'mentions' ? <MentionsFilterMenu spaceId={spaceId} /> : <MarkAllReadButton />}
      </header>
      <Tabs variant="chips" aria-label="Inbox" idBase={idBase} value={tab} onChange={setTab} items={TABS} className="px-4 pt-1 pb-3" />
      <div
        role="tabpanel"
        id={`${idBase}-panel-${tab}`}
        aria-labelledby={`${idBase}-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === 'mentions' ? <MentionsTab spaceId={spaceId} onClose={onClose} /> : <UnreadsTab onClose={onClose} />}
      </div>
    </div>
  );
}
