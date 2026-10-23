/**
 * /notifications — the phone Notifications tab: the Inbox (Mentions / Unreads) full screen,
 * the same content as the header's Inbox popout on desktop. Opening an item navigates there.
 */
import { InboxPopout } from '@/features/inbox/InboxPopout';

const stay = () => undefined;

export function InboxPage() {
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface pt-safe lg:card-pane"
      data-testid="inbox-page"
    >
      <InboxPopout spaceId={null} onClose={stay} />
    </div>
  );
}
