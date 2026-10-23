import { Suspense, useState } from 'react';
import { lazyNamed } from '@/lib/lazy';
import { JoinSpaceDialog } from './JoinSpaceDialog';

/** The Add Space flow (features/templates): loaded when it first opens. */
const AddSpaceModal = lazyNamed(
  () => import('@/features/templates/AddSpaceModal'),
  'AddSpaceModal',
);

/**
 * Add a Space: Create My Own or a starter template, "Tell us more", then an icon and a name
 * (AddSpaceModal); "Join a Space" switches to the invite dialog.
 */
export function CreateSpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [joining, setJoining] = useState(false);
  return (
    <>
      {open ? (
        <Suspense fallback={null}>
          <AddSpaceModal
            onClose={onClose}
            onJoin={() => {
              onClose();
              setJoining(true);
            }}
          />
        </Suspense>
      ) : null}
      <JoinSpaceDialog open={joining} onClose={() => setJoining(false)} />
    </>
  );
}
