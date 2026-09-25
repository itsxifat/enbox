/**
 * PLACEHOLDER (agent 4 owns this file): Calls tab (/calls) — call log (GET /api/calls),
 * joinable group calls (GET /api/calls/active), favorites, new call.
 */
import { EllipsisVertical, Phone, PhoneCall } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { IconButton, SearchInput } from '@/components/ui';
import { useState } from 'react';

export function CallsPane() {
  const [query, setQuery] = useState('');
  return (
    <>
      <PaneHeader
        title="Calls"
        large
        actions={
          <>
            <IconButton icon={PhoneCall} label="New call" />
            <IconButton icon={EllipsisVertical} label="Menu" />
          </>
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search calls" />
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Placeholder
          icon={Phone}
          title="No recent calls"
          description="Voice and video calls you make and receive will appear here."
          owner="agent 4"
        />
      </div>
    </>
  );
}
