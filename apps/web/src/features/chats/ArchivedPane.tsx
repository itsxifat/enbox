/** Archived chats (/archived): same rows and menus as the main list; unarchive from the menu. */
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { Archive } from 'lucide-react';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, ListItemSkeleton } from '@/components/ui';
import { useChats, useSortedChats } from '@/stores/chats';
import { ChatRow } from './ChatRow';

function Note() {
  return (
    <p className="px-6 py-3 text-center text-[13px] text-muted">
      These chats stay archived when new messages are received.
    </p>
  );
}

const components = { Header: Note };

export function ArchivedPane() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const loaded = useChats((s) => s.loaded);
  const chats = useSortedChats({ archived: true });
  const openId = useRef(chatId);
  useEffect(() => {
    openId.current = chatId;
  }, [chatId]);
  const onDeleted = useCallback(
    (id: string) => {
      if (id === openId.current) navigate('/archived', { replace: true });
    },
    [navigate],
  );
  return (
    <>
      <PaneHeader title="Archived" back="/chats" />
      <div className="min-h-0 flex-1" data-testid="archived-list">
        {!loaded ? (
          <ListItemSkeleton count={4} />
        ) : chats.length ? (
          <Virtuoso
            data={chats}
            computeItemKey={(_, c) => c.id}
            className="scrollbar-thin"
            style={{ height: '100%' }}
            components={components}
            itemContent={(_, c) => (
              <ChatRow
                chat={c}
                to={`/archived/${c.id}`}
                active={c.id === chatId}
                onDeleted={onDeleted}
              />
            )}
          />
        ) : (
          <EmptyState
            icon={Archive}
            title="No archived chats"
            description="Archive a chat from its menu to tidy up your chat list without deleting it."
          />
        )}
      </div>
    </>
  );
}
