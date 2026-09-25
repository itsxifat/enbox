/**
 * Global message search (GET /api/search/messages): results with the matched text
 * highlighted; selecting one opens the chat at that message (`?m=<seq>`).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { SearchX } from 'lucide-react';
import {
  chatTitle,
  renderMentions,
  type ChatSummary,
  type MessageSearchResult,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { EmptyState, ListItem, ListSection, Spinner } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api, errorMessage } from '@/lib/api';
import { formatChatListTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { nameOf, useUsers } from '@/stores/users';
import { splitHighlight } from '@/features/conversation/lib/richText';
import { chatPath } from './links';
import { PreviewLine, mentionName, previewParts } from './preview';
import { IN_APP_NAV } from '@/components/layout/navigation';

/** Cut long texts around the first match so it stays visible in one line. */
export function snippetAround(text: string, query: string, before = 24): string {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (i <= before) return text;
  return `…${text.slice(i - before).replace(/^\S*\s/, '')}`;
}

export function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = splitHighlight(text, query);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-brand-soft px-0.5 font-semibold text-brand-ink">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function ResultRow({ r, query }: { r: MessageSearchResult; query: string }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  const full = useChats((s) => s.byId[r.chat.id]);
  const chat: Pick<
    ChatSummary,
    'id' | 'type' | 'name' | 'avatarUrl' | 'peer' | 'isAnnouncement' | 'communityId'
  > = full ?? { ...r.chat, isAnnouncement: false, communityId: null };
  const m = r.message;
  const text = m.text ? renderMentions(m.text, mentionName) : '';
  const sender =
    m.senderId === me ? 'You' : chat.type === 'group' && m.senderId ? nameOf(m.senderId) : null;
  return (
    <ListItem
      onClick={() =>
        navigate(chatPath(r.chat, { seq: m.seq, messageId: m.id }), { state: IN_APP_NAV })
      }
      leading={<ChatAvatar chat={chat} size="lg" />}
      title={chatTitle(chat, me)}
      meta={formatChatListTime(m.createdAt)}
      subtitle={
        <span className="flex min-w-0 items-center gap-1">
          {sender ? <span className="shrink-0">{sender}:</span> : null}
          {text ? (
            <span className="truncate">
              <Highlighted text={snippetAround(text.replace(/\s+/g, ' '), query)} query={query} />
            </span>
          ) : (
            <PreviewLine parts={previewParts(m, { meId: me, chat })} />
          )}
        </span>
      }
    />
  );
}

export function MessageSearchResults({ query }: { query: string }) {
  const q = useDebouncedValue(query.trim(), 300);
  const [state, setState] = useState<{
    q: string;
    results: MessageSearchResult[] | null;
    error: string | null;
  }>({ q: '', results: null, error: null });

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    api
      .get<MessageSearchResult[]>('/api/search/messages', {
        query: { q },
        signal: controller.signal,
      })
      .then((results) => {
        const ids = new Set<string>();
        for (const r of results) if (r.message.senderId) ids.add(r.message.senderId);
        void useUsers
          .getState()
          .fetchUsers(ids)
          .catch(() => undefined);
        setState({ q, results, error: null });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setState({ q, results: [], error: errorMessage(e) });
      });
    return () => controller.abort();
  }, [q]);

  if (!q) return null;
  const loading = state.q !== q;
  return (
    <ListSection
      title="Messages"
      action={loading ? <Spinner size={16} className="text-brand-ink" /> : null}
    >
      {!loading && state.error ? (
        <p className="px-4 py-3 text-sm text-danger">{state.error}</p>
      ) : !loading && !state.results?.length ? (
        <EmptyState
          compact
          icon={SearchX}
          title="No messages found"
          description={`Nothing matches “${q}”.`}
        />
      ) : (
        <div aria-busy={loading || undefined} className={loading ? 'opacity-60' : undefined}>
          {state.results?.map((r) => (
            <ResultRow key={r.message.id} r={r} query={state.q} />
          ))}
        </div>
      )}
    </ListSection>
  );
}
