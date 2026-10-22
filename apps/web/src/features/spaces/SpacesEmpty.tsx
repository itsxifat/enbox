import { useState } from 'react';
import { Navigate } from 'react-router';
import { Compass, Plus } from 'lucide-react';
import { Button, EmptyState, PageSpinner } from '@/components/ui';
import { CommunitiesIcon } from '@/components/icons';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useSpaceList, useSpaces } from '@/stores/spaces';
import { spaceMemory } from './actions';
import { CreateSpaceDialog } from './dialogs/CreateSpaceDialog';
import { JoinSpaceDialog } from './dialogs/JoinSpaceDialog';

/** /spaces: back into the last Space (desktop), or a welcome to create / join one. */
export function SpacesEmpty() {
  const spaces = useSpaceList();
  const loaded = useSpaces((s) => s.loaded);
  const desktop = useIsDesktop();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  if (!loaded) return <PageSpinner />;
  const last = spaceMemory.lastSpace();
  if (desktop && spaces.length) {
    const target = spaces.find((s) => s.id === last) ?? spaces[0]!;
    return <Navigate to={`/spaces/${target.id}`} replace />;
  }
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        icon={CommunitiesIcon}
        title={spaces.length ? 'Pick a Space' : 'Your Spaces'}
        description={
          spaces.length
            ? 'Choose a Space on the left to see its channels.'
            : 'A Space is your place for a community: text and voice channels, roles and members, all in one place.'
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button leftIcon={Plus} onClick={() => setCreating(true)}>
              Create a Space
            </Button>
            <Button variant="soft" leftIcon={Compass} onClick={() => setJoining(true)}>
              Join with an invite
            </Button>
          </div>
        }
      />
      <CreateSpaceDialog open={creating} onClose={() => setCreating(false)} />
      <JoinSpaceDialog open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}
