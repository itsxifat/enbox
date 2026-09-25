/**
 * Updates tab list pane (/updates). Foundation-owned composition: the Status section is
 * agent 4's (features/status/StatusSection), the Channels section is agent 3's
 * (features/channels/ChannelsSection). Agents edit their section, not this file.
 */
import { Camera, Compass, EllipsisVertical, History, Megaphone } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { DropdownMenu, IconButton } from '@/components/ui';
import { ChannelsSection } from '@/features/channels/ChannelsSection';
import { StatusSection } from '@/features/status/StatusSection';

export function UpdatesPane() {
  const navigate = useNavigate();
  return (
    <>
      <PaneHeader
        title="Updates"
        large
        actions={
          <>
            <IconButton
              icon={Camera}
              label="Add status"
              onClick={() => void navigate('/updates/status/new')}
            />
            <DropdownMenu
              aria-label="Updates menu"
              trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Menu" />}
              items={[
                {
                  label: 'My status updates',
                  icon: History,
                  onSelect: () => void navigate('/updates/status/mine'),
                },
                {
                  label: 'Create channel',
                  icon: Megaphone,
                  onSelect: () => void navigate('/updates/channels/new'),
                },
                {
                  label: 'Find channels',
                  icon: Compass,
                  onSelect: () => void navigate('/updates/channels/discover'),
                },
              ]}
            />
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
