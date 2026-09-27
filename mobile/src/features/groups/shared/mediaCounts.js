/**
 * Info-panel totals: `GET /api/chats/:chatId/media/counts` (how many items each gallery tab
 * lists) and `GET /api/messages/starred?chatId=` (this chat's starred messages).
 */
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/** "Media, links and docs": the gallery's three tabs (voice notes aren't listed there). */
export function mediaTotal(c) {
  return c.media + c.docs + c.links;
}

export function fetchMediaCounts(chatId) {
  return api.get(`/api/chats/${chatId}/media/counts`);
}

export function fetchStarred(chatId) {
  return api.get('/api/messages/starred', { query: { chatId } });
}

function useChatQuery(chatId, load) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    load(chatId)
      .then((value) => alive && setState({ chatId, value }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [chatId, load]);
  return state?.chatId === chatId ? state.value : null;
}

/** Totals per gallery kind, or null while loading (or when the request failed). */
export function useChatMediaCounts(chatId) {
  return useChatQuery(chatId, fetchMediaCounts);
}

/** How many messages of this chat I starred, or null while loading. */
export function useStarredCount(chatId) {
  const list = useChatQuery(chatId, fetchStarred);
  return list ? list.length : null;
}
