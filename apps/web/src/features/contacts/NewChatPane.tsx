/**
 * PLACEHOLDER (agent 1 owns this file): "New chat" picker at /new — contacts list, search
 * users (GET /api/users/search), add contact, and entries for New group (/new/group, agent 3)
 * and New community (agent 3). Selecting a user: POST /api/chats/direct → upsertChat →
 * navigate(`/chats/${chat.id}`).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Contact, UserPlus, UsersRound } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { ListItem, SearchInput } from '@/components/ui';

function RoundIcon({ icon: Icon }: { icon: typeof UsersRound }) {
  return (
    <span className="flex size-12 items-center justify-center rounded-full bg-brand text-on-brand">
      <Icon size={22} aria-hidden />
    </span>
  );
}

export function NewChatPane() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  return (
    <>
      <PaneHeader title="New chat" back="/chats">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search name or username"
          autoFocus
        />
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ListItem
          leading={<RoundIcon icon={UsersRound} />}
          title="New group"
          onClick={() => navigate('/new/group')}
          divider={false}
        />
        <ListItem
          leading={<RoundIcon icon={UserPlus} />}
          title="New contact"
          onClick={() => undefined}
          divider={false}
        />
        <ListItem
          leading={<RoundIcon icon={UsersRound} />}
          title="New community"
          onClick={() => navigate('/communities')}
          divider={false}
        />
        <Placeholder
          icon={Contact}
          title="Your contacts"
          description="Contacts and user search results will appear here."
          owner="agent 1"
        />
      </div>
    </>
  );
}
