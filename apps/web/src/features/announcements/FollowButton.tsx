/** The "Follow" button of an announcement channel's header (the modal loads when opened). */
import { Suspense, useState } from 'react';
import { BellPlus } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { Button } from '@/components/ui';
import { lazyNamed } from '@/lib/lazy';
import { isAnnouncementChannel } from './actions';

const FollowDialog = lazyNamed(() => import('./FollowDialog'), 'FollowDialog');

export function FollowButton({ chat }: { chat: ChatSummary }) {
  const [open, setOpen] = useState(false);
  if (!isAnnouncementChannel(chat)) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={BellPlus}
        onClick={() => setOpen(true)}
        className="mr-1"
        data-testid="follow-channel"
      >
        Follow
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <FollowDialog chat={chat} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
