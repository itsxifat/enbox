/**
 * PLACEHOLDER (agent 3 owns this file): create-group flow at /new/group — pick members,
 * then name/icon/settings → POST /api/groups → navigate(`/chats/${chat.id}`).
 */
import { UsersRound } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';

export function NewGroupPane() {
  return (
    <>
      <PaneHeader title="New group" subtitle="Add members" back="/new" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Placeholder
          icon={UsersRound}
          title="Create a group"
          description="Pick members, then choose a name and icon."
          owner="agent 3"
        />
      </div>
    </>
  );
}
