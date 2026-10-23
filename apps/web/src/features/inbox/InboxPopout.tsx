/**
 * The Inbox popout's content: the title with the tab's action (Mentions: the filter menu;
 * Unreads: Mark all as read), the Mentions / Unreads / Bookmarks / Reminders tabs (Reminders
 * counts the due ones) and the open tab's list.
 */
import { useId } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { Tabs } from '@/components/ui';
import { useDueReminderCount } from '@/features/bookmarks/store';
import { useInbox, type InboxTab } from '@/stores/inbox';
import { MentionsFilterMenu, MentionsTab } from './MentionsTab';
import { SavedTab } from './SavedTab';
import { MarkAllReadButton, UnreadsTab } from './UnreadsTab';

export function InboxPopout({ spaceId, onClose }: { spaceId: ID | null; onClose: () => void }) {
  const tab = useInbox((s) => s.tab);
  const setTab = useInbox((s) => s.setTab);
  const due = useDueReminderCount();
  const idBase = useId();
  const tabs: { value: InboxTab; label: string; count?: number }[] = [
    { value: 'mentions', label: 'Mentions' },
    { value: 'unreads', label: 'Unreads' },
    { value: 'bookmarks', label: 'Bookmarks' },
    { value: 'reminders', label: 'Reminders', count: due },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-popout">
      <header className="flex min-h-12 items-center gap-2 pt-2 pr-2 pl-4">
        <InboxIcon size={20} className="shrink-0 text-muted" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold text-fg">Inbox</h2>
        {tab === 'mentions' ? <MentionsFilterMenu spaceId={spaceId} /> : tab === 'unreads' ? <MarkAllReadButton /> : null}
      </header>
      <Tabs variant="chips" aria-label="Inbox" idBase={idBase} value={tab} onChange={setTab} items={tabs} className="px-4 pt-1 pb-3" />
      <div
        role="tabpanel"
        id={`${idBase}-panel-${tab}`}
        aria-labelledby={`${idBase}-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === 'mentions' ? (
          <MentionsTab spaceId={spaceId} onClose={onClose} />
        ) : tab === 'unreads' ? (
          <UnreadsTab onClose={onClose} />
        ) : (
          <SavedTab key={tab} mode={tab} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
