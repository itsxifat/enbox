/** PLACEHOLDER (agent 2 owns this file): starred messages (/starred) via GET /api/messages/starred. */
import { Star } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';

export function StarredPane() {
  return (
    <>
      <PaneHeader title="Starred messages" back="/chats" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Placeholder
          icon={Star}
          title="No starred messages"
          description="Tap and hold on any message to star it."
          owner="agent 2"
        />
      </div>
    </>
  );
}
