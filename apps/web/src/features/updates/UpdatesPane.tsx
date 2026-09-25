/**
 * Updates tab list pane (/updates). Foundation-owned composition: the Status section is
 * agent 4's (features/status/StatusSection), the Channels section is agent 3's
 * (features/channels/ChannelsSection). Agents edit their section, not this file.
 */
import { Camera, EllipsisVertical, Search } from 'lucide-react';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { IconButton } from '@/components/ui';
import { ChannelsSection } from '@/features/channels/ChannelsSection';
import { StatusSection } from '@/features/status/StatusSection';

export function UpdatesPane() {
  return (
    <>
      <PaneHeader
        title="Updates"
        large
        actions={
          <>
            <IconButton icon={Search} label="Search updates" />
            <IconButton icon={Camera} label="Add status" />
            <IconButton icon={EllipsisVertical} label="Menu" />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        <StatusSection />
        <div className="mx-4 my-2 h-px bg-line" />
        <ChannelsSection />
      </div>
    </>
  );
}
