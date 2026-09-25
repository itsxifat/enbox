/**
 * PLACEHOLDER (agent 3 owns this file): invite landing at /join/:code —
 * GET /api/invites/:code preview → POST /api/invites/:code/join → open the chat/community.
 */
import { useParams } from 'react-router';
import { Link2 } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';

export function JoinInvitePage() {
  const { code } = useParams();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader title="Invite link" back="/chats" border />
      <div className="flex flex-1 items-center justify-center">
        <Placeholder
          icon={Link2}
          title="Join via invite"
          description={`Invite code: ${code ?? ''}`}
          owner="agent 3"
        />
      </div>
    </div>
  );
}
