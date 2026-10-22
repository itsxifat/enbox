import { Search } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { useConversationUi } from '@/features/conversation/state';
import type { SearchScope } from '@/stores/sidePanel';

/**
 * Contract stub (search stream): the header search box with filters. Until it lands it opens
 * the existing in-chat search, as the header's Search button did.
 */
export function HeaderSearch({ scope, chatId }: { scope: SearchScope; chatId: string }) {
  return (
    <IconButton
      icon={Search}
      label={scope.kind === 'space' ? 'Search this channel' : 'Search in chat'}
      variant="ghost"
      onClick={() => useConversationUi.getState().setSearch(chatId, '')}
    />
  );
}
