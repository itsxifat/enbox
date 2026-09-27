/**
 * Global message search (GET /api/search/messages, web features/chats/MessageSearchResults):
 * results with the matched text highlighted; selecting one opens the chat at that message.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { SearchX } from 'lucide-react-native';
import { chatTitle, renderMentions } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { EmptyState, ListItem, ListSection, Spinner, T } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api, errorMessage } from '@/lib/api';
import { formatChatListTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { nameOf, useUsers } from '@/stores/users';
import { splitHighlight } from '@/features/conversation/lib/richText';
import { useTheme } from '@/theme';
import { chatPath } from './links';
import { PreviewLine, mentionName, previewParts } from './preview';

/** Cut long texts around the first match so it stays visible in one line. */
export function snippetAround(text, query, before = 24) {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (i <= before) return text;
  return `…${text.slice(i - before).replace(/^\S*\s/, '')}`;
}

export function Highlighted({ text, query, style }) {
  const { tw } = useTheme();
  const parts = splitHighlight(text, query);
  return (
    <T numberOfLines={1} style={[tw`shrink text-[14px] leading-snug text-muted`, style]}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <T key={i} style={tw`rounded-sm bg-brand-soft text-[14px] font-semibold text-brand-ink`}>
            {p}
          </T>
        ) : (
          p
        ),
      )}
    </T>
  );
}

function ResultRow({ r, query }) {
  const { tw } = useTheme();
  const router = useRouter();
  const me = useAuth((s) => s.user?.id);
  const full = useChats((s) => s.byId[r.chat.id]);
  const chat = full ?? { ...r.chat, isAnnouncement: false, communityId: null };
  const m = r.message;
  const text = m.text ? renderMentions(m.text, mentionName) : '';
  const sender =
    m.senderId === me ? 'You' : chat.type === 'group' && m.senderId ? nameOf(m.senderId) : null;
  return (
    <ListItem
      onPress={() => router.push(chatPath(r.chat, { seq: m.seq, messageId: m.id }))}
      leading={<ChatAvatar chat={chat} size="lg" />}
      title={chatTitle(chat, me)}
      meta={formatChatListTime(m.createdAt)}
      subtitle={
        <View style={tw`min-w-0 flex-row items-center gap-1`}>
          {sender ? <T style={tw`text-[14px] leading-snug text-muted`}>{sender}:</T> : null}
          {text ? (
            <Highlighted text={snippetAround(text.replace(/\s+/g, ' '), query)} query={query} />
          ) : (
            <PreviewLine parts={previewParts(m, { meId: me, chat })} />
          )}
        </View>
      }
    />
  );
}

export function MessageSearchResults({ query }) {
  const { tw } = useTheme();
  const q = useDebouncedValue(query.trim(), 300);
  const [state, setState] = useState({ q: '', results: null, error: null });

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    api
      .get('/api/search/messages', { query: { q }, signal: controller.signal })
      .then((results) => {
        const ids = new Set();
        for (const r of results) if (r.message.senderId) ids.add(r.message.senderId);
        void useUsers
          .getState()
          .fetchUsers(ids)
          .catch(() => undefined);
        setState({ q, results, error: null });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ q, results: [], error: errorMessage(e) });
      });
    return () => controller.abort();
  }, [q]);

  if (!q) return null;
  const loading = state.q !== q;
  return (
    <ListSection title="Messages" action={loading ? <Spinner size={16} /> : null}>
      {!loading && state.error ? (
        <T style={tw`px-4 py-3 text-sm text-danger`}>{state.error}</T>
      ) : !loading && !state.results?.length ? (
        <EmptyState
          compact
          icon={SearchX}
          title="No messages found"
          description={`Nothing matches “${q}”.`}
        />
      ) : (
        <View style={loading ? { opacity: 0.6 } : null}>
          {state.results?.map((r) => (
            <ResultRow key={r.message.id} r={r} query={state.q} />
          ))}
        </View>
      )}
    </ListSection>
  );
}
