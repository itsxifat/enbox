/** PLACEHOLDER (agent 2 owns this file): archived chats list (/archived). */
import { useParams } from 'react-router';
import { Archive } from 'lucide-react';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState } from '@/components/ui';
import { useSortedChats } from '@/stores/chats';
import { ChatRow } from './ChatRow';

export function ArchivedPane() {
  const { chatId } = useParams();
  const chats = useSortedChats({ archived: true });
  return (
    <>
      <PaneHeader title="Archived" back="/chats" />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {chats.length ? (
          chats.map((c) => (
            <ChatRow key={c.id} chat={c} to={`/archived/${c.id}`} active={c.id === chatId} />
          ))
        ) : (
          <EmptyState
            icon={Archive}
            title="No archived chats"
            description="Archived chats stay here until a new message arrives."
          />
        )}
      </div>
    </>
  );
}
