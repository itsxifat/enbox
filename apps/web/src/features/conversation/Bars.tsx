/** Header replacements (in-chat search, selection) and the read-only footer. */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Forward,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatSummary, MessageSearchResult } from '@enbox/shared';
import { Button, IconButton, Spinner } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { deleteChat } from '@/features/chats/chatActions';
import {
  canForward,
  copyMessages,
  copyText,
  deleteMessages,
  selectedMessages,
  setStarred,
} from './actions';
import { useConversationUi } from './state';

export function ChatSearchBar({ chat }: { chat: ChatSummary }) {
  const query = useConversationUi((s) => s.search[chat.id] ?? '');
  const q = useDebouncedValue(query.trim(), 300);
  const [results, setResults] = useState<MessageSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .get<MessageSearchResult[]>('/api/search/messages', {
        query: { q, chatId: chat.id, limit: 100 },
        signal: controller.signal,
      })
      .then((list) => {
        setResults(list);
        setIndex(0);
        const first = list[0];
        if (first)
          useConversationUi.getState().requestJump(chat.id, first.message.seq, first.message.id);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) toast.error(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, chat.id]);

  const go = (next: number) => {
    if (!results?.length) return;
    const i = Math.max(0, Math.min(results.length - 1, next));
    setIndex(i);
    const r = results[i]!;
    useConversationUi.getState().requestJump(chat.id, r.message.seq, r.message.id);
  };

  const close = () => useConversationUi.getState().setSearch(chat.id, null);
  const count = results?.length ?? 0;

  return (
    <header
      className="flex h-16 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 pt-safe"
      data-testid="chat-search"
    >
      <IconButton icon={ArrowLeft} label="Close search" onClick={close} />
      <div className="relative flex h-10 min-w-0 flex-1 items-center rounded-full bg-surface-2 focus-within:ring-2 focus-within:ring-brand/30">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => useConversationUi.getState().setSearch(chat.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? index - 1 : index + 1);
            }
          }}
          placeholder="Search in chat"
          aria-label="Search in chat"
          className="h-full min-w-0 flex-1 bg-transparent pr-2 pl-4 text-[15px] text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        {loading ? <Spinner size={16} className="mr-3 text-brand-ink" /> : null}
        {!loading && q ? (
          <span className="mr-3 shrink-0 text-[13px] text-muted tabular-nums" aria-live="polite">
            {count ? `${index + 1} of ${count}` : 'No results'}
          </span>
        ) : null}
      </div>
      <IconButton
        icon={ChevronUp}
        label="Older result"
        disabled={!count || index >= count - 1}
        onClick={() => go(index + 1)}
      />
      <IconButton
        icon={ChevronDown}
        label="Newer result"
        disabled={!count || index <= 0}
        onClick={() => go(index - 1)}
      />
    </header>
  );
}

export function SelectionBar({ chat }: { chat: ChatSummary }) {
  const ids = useConversationUi((s) => s.selecting[chat.id] ?? []);
  const items = useMessages((s) => s.byChat[chat.id]?.items);
  const selected = (items ?? []).filter((m) => ids.includes(m.id));
  const n = selected.length;
  const allStarred = n > 0 && selected.every((m) => m.starred);
  const forwardable = n > 0 && selected.every(canForward);
  const copyable = n > 0 && selected.some((m) => copyText(m));
  const clear = () => useConversationUi.getState().clearSelect(chat.id);

  return (
    <header
      className="flex h-16 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 pt-safe"
      data-testid="selection-bar"
    >
      <IconButton icon={X} label="Cancel selection" onClick={clear} />
      <h2 className="min-w-0 flex-1 truncate px-1 text-[17px] font-semibold" aria-live="polite">
        {n ? `${n} selected` : 'Select messages'}
      </h2>
      <IconButton
        icon={allStarred ? StarOff : Star}
        label={allStarred ? 'Unstar' : 'Star'}
        disabled={!n}
        onClick={() => void setStarred(selectedMessages(chat.id), !allStarred).then(clear)}
      />
      <IconButton
        icon={Copy}
        label="Copy"
        disabled={!copyable}
        onClick={() => void copyMessages(selectedMessages(chat.id)).then(clear)}
      />
      <IconButton
        icon={Forward}
        label="Forward"
        disabled={!forwardable}
        onClick={() => useConversationUi.getState().openForward(selectedMessages(chat.id))}
      />
      <IconButton
        icon={Trash2}
        label="Delete"
        disabled={!n}
        onClick={() =>
          void deleteMessages(chat, selectedMessages(chat.id)).then((done) => {
            if (done) clear();
          })
        }
      />
    </header>
  );
}

export function ReadOnlyFooter({ chat, onDeleted }: { chat: ChatSummary; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  let text: string;
  let action: { label: string; run: () => Promise<void> } | null = null;
  if (chat.membership !== 'active') {
    text =
      chat.membership === 'removed'
        ? 'You can’t send messages to this group because you were removed.'
        : 'You can’t send messages to this group because you’re no longer a member.';
    action = {
      label: 'Delete group',
      run: async () => {
        if (await deleteChat(chat)) onDeleted();
      },
    };
  } else if (chat.type === 'direct' && chat.peer?.isDeleted) {
    text = 'This account has been deleted. You can’t send messages to it.';
  } else if (chat.type === 'direct' && chat.peer?.isBlocked) {
    text = 'You blocked this contact.';
    action = {
      label: 'Unblock',
      run: async () => {
        try {
          await api.delete(`/api/blocks/${chat.peer!.id}`);
          await useChats.getState().refreshChat(chat.id);
          toast.success('Contact unblocked');
        } catch (e) {
          toast.error(e);
        }
      },
    };
  } else if (chat.type === 'channel') {
    text = 'Only channel admins can post.';
  } else if (chat.isAnnouncement) {
    text = 'Only community admins can send messages.';
  } else {
    text = 'Only admins can send messages.';
  }
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col items-center gap-2 border-t border-line bg-surface px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] text-center text-[14px] text-muted',
      )}
      data-testid="read-only-footer"
    >
      <p>{text}</p>
      {action ? (
        <Button
          size="sm"
          variant="soft"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void action!.run().finally(() => setBusy(false));
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
