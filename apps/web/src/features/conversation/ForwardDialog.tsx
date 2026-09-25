/** Forward messages to up to MAX_FORWARD_TARGETS chats (search, multi-select). */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, SendHorizontal } from 'lucide-react';
import { MAX_FORWARD_TARGETS, chatTitle, type ChatSummary, type Message } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { EmptyState, IconButton, ListItem, Modal, SearchInput } from '@/components/ui';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { useAuth } from '@/stores/auth';
import { useChats, useSortedChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { useConversationUi } from './state';
import { chatPath } from '@/features/chats/links';

export function ForwardDialog() {
  const messages = useConversationUi((s) => s.forward);
  const close = () => useConversationUi.getState().openForward(null);
  if (!messages) return null;
  return (
    <ForwardDialogInner
      key={messages.map((m) => m.id).join(',')}
      messageIds={messages.map((m) => m.id)}
      onClose={close}
    />
  );
}

function ForwardDialogInner({
  messageIds,
  onClose,
}: {
  messageIds: string[];
  onClose: () => void;
}) {
  const me = useAuth((s) => s.user?.id);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const all = useSortedChats({ kind: 'all', query });
  const archived = useSortedChats({ kind: 'chats', archived: true, query });
  const chats = useMemo(() => {
    const seen = new Set<string>();
    const out: ChatSummary[] = [];
    for (const c of [...all, ...archived]) {
      if (seen.has(c.id) || !c.permissions.canSend || c.membership !== 'active') continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [all, archived]);
  const byId = useChats((s) => s.byId);

  const toggle = (id: string) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_FORWARD_TARGETS) {
        toast.info(`You can forward to up to ${MAX_FORWARD_TARGETS} chats`, { id: 'fwd-limit' });
        return cur;
      }
      return [...cur, id];
    });

  const send = async () => {
    if (!selected.length) return;
    setSending(true);
    try {
      const copies = await api.post<Message[]>('/api/messages/forward', {
        clientId: newClientId().slice(0, 36),
        messageIds,
        chatIds: selected,
      });
      for (const c of copies) useMessages.getState().upsertMessage(c);
      toast.success(
        messageIds.length > 1 ? `${messageIds.length} messages forwarded` : 'Message forwarded',
        { id: 'forwarded' },
      );
      const target = selected.length === 1 ? selected[0] : null;
      useConversationUi
        .getState()
        .clearSelect(useConversationUi.getState().forward?.[0]?.chatId ?? '');
      onClose();
      const targetChat = target ? useChats.getState().byId[target] : undefined;
      if (targetChat) navigate(chatPath(targetChat));
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  };

  const names = selected.map((id) => (byId[id] ? chatTitle(byId[id]!, me) : '')).filter(Boolean);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        messageIds.length > 1 ? `Forward ${messageIds.length} messages to…` : 'Forward message to…'
      }
      size="md"
      footer={
        <div className="flex w-full items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm text-muted" aria-live="polite">
            {names.length ? names.join(', ') : `Select up to ${MAX_FORWARD_TARGETS} chats`}
          </p>
          <IconButton
            icon={SendHorizontal}
            label="Forward"
            variant="brand"
            size="lg"
            disabled={!selected.length}
            loading={sending}
            onClick={() => void send()}
          />
        </div>
      }
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search chats"
        autoFocus
        aria-label="Search chats"
      />
      <div className="-mx-6 mt-2 max-h-[52dvh] min-h-40 overflow-y-auto scrollbar-thin">
        {chats.length ? (
          chats.map((c) => {
            const on = selected.includes(c.id);
            return (
              <ListItem
                key={c.id}
                dense
                onClick={() => toggle(c.id)}
                leading={<ChatAvatar chat={c} size="md" />}
                title={chatTitle(c, me)}
                subtitle={
                  c.type === 'group'
                    ? `${c.memberCount} members`
                    : c.type === 'channel'
                      ? 'Channel'
                      : (c.peer?.about ?? undefined)
                }
                end={
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full border-2 transition-colors',
                      on ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
                    )}
                  >
                    {on ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                }
                active={on}
                aria-current={on ? 'true' : undefined}
              />
            );
          })
        ) : (
          <EmptyState compact title="No chats found" description="Try another name." />
        )}
      </div>
    </Modal>
  );
}
