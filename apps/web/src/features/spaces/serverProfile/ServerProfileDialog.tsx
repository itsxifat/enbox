import { useState } from 'react';
import type { Space } from '@enbox/shared';
import { Modal, confirm } from '@/components/ui';
import { ServerProfileEditor } from './ServerProfileEditor';

/** "Edit Per-server Profile" from the Space menu: the editor in a dialog; closing with unsaved changes asks first. */
export function ServerProfileDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  const close = async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Discard changes?',
        message: 'Your per-server profile changes are not saved yet.',
        confirmLabel: 'Discard',
        danger: true,
      }))
    )
      return;
    onClose();
  };
  return (
    <Modal
      open
      onClose={() => void close()}
      title="Per-server Profile"
      description={`How you look in ${space.name}. Anything left on “Use main profile” follows your main profile.`}
      size="xl"
    >
      <ServerProfileEditor spaceId={space.id} onDirtyChange={setDirty} />
    </Modal>
  );
}
