/**
 * PLACEHOLDER (agent 3 owns this file): the "Channels" section of the Updates tab —
 * followed channels (from the chats store, `useSortedChats({ kind: 'channels' })`) and
 * channel discovery (GET /api/channels/discover).
 */
import { useParams } from 'react-router';
import { chatTitle, messagePreviewText } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Button, ListItem, ListSection } from '@/components/ui';
import { formatChatListTime } from '@/lib/format';
import { isChatUnread, useSortedChats } from '@/stores/chats';

export function ChannelsSection() {
  const { chatId } = useParams();
  const channels = useSortedChats({ kind: 'channels' });
  return (
    <ListSection
      title="Channels"
      action={
        <Button size="sm" variant="soft">
          Explore
        </Button>
      }
    >
      {channels.length ? (
        channels.map((c) => (
          <ListItem
            key={c.id}
            to={`/updates/channels/${c.id}`}
            active={c.id === chatId}
            leading={<ChatAvatar chat={c} size="lg" />}
            title={chatTitle(c)}
            subtitle={c.lastMessage ? messagePreviewText(c.lastMessage) : c.description}
            meta={formatChatListTime(c.lastActivityAt)}
            highlight={isChatUnread(c)}
          />
        ))
      ) : (
        <p className="px-4 pt-1 pb-4 text-sm text-muted">
          Stay updated on topics that matter to you. Find channels to follow with Explore.
        </p>
      )}
    </ListSection>
  );
}
