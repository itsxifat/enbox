/**
 * The Message Requests entry for the top of the phone Messages list, under Friends (desktop
 * has its Home sidebar row): shown only while requests are pending, with their count.
 */
import { Link } from 'react-router';
import { ChevronRight, MailQuestion } from 'lucide-react';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { Badge } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { usePendingRequestCount } from '@/stores/requests';

export function MessageRequestsEntry() {
  const desktop = useIsDesktop();
  const pending = usePendingRequestCount();
  if (desktop || pending === 0) return null;
  return (
    <Link
      to="/message-requests"
      state={IN_APP_NAV}
      className="mx-2 my-0.5 flex items-center gap-4 rounded-xl px-4 py-3 text-[15px] font-medium text-fg outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      data-testid="messages-requests-entry"
    >
      <MailQuestion size={20} className="text-brand-ink" aria-hidden />
      <span className="flex-1">Message Requests</span>
      <Badge
        count={pending}
        size="sm"
        tone="danger"
        label={`${pending} message request${pending === 1 ? '' : 's'}`}
      />
      <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
    </Link>
  );
}
