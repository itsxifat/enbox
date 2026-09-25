/**
 * Per-chat composer drafts, persisted per account in localStorage (`enbox.drafts.<userId>`)
 * so they survive reloads; the chat list shows "Draft: …". Text is stored tokenized (mention
 * tokens), the composer decodes it back to "@Name" text.
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useAuth } from '@/stores/auth';

export interface Draft {
  text: string;
  /** Message being replied to (restored when the chat is reopened). */
  replyToId?: ID;
  updatedAt: number;
}

interface DraftsState {
  userId: ID | null;
  byChat: Record<ID, Draft>;
  setDraft(chatId: ID, text: string, replyToId?: ID | null): void;
  clearDraft(chatId: ID): void;
}

const keyFor = (userId: ID) => `enbox.drafts.${userId}`;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(userId: ID | null): Record<ID, Draft> {
  if (!userId) return {};
  const raw = storage.getJSON<Record<ID, Draft>>(keyFor(userId));
  return raw && typeof raw === 'object' ? raw : {};
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDrafts, 400);
}

/** Write pending drafts now (also on page hide). */
export function flushDrafts(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const { userId, byChat } = useDrafts.getState();
  if (!userId) return;
  if (Object.keys(byChat).length) storage.setJSON(keyFor(userId), byChat);
  else storage.remove(keyFor(userId));
}

export const useDrafts = create<DraftsState>((set, get) => ({
  userId: null,
  byChat: {},

  setDraft(chatId, text, replyToId) {
    ensureUser();
    const cur = get().byChat[chatId];
    const hasContent = text.trim().length > 0 || !!replyToId;
    if (!hasContent) {
      if (cur) get().clearDraft(chatId);
      return;
    }
    if (cur && cur.text === text && cur.replyToId === (replyToId ?? undefined)) return;
    set((s) => ({
      byChat: {
        ...s.byChat,
        [chatId]: { text, replyToId: replyToId ?? undefined, updatedAt: Date.now() },
      },
    }));
    scheduleSave();
  },

  clearDraft(chatId) {
    ensureUser();
    if (!get().byChat[chatId]) return;
    set((s) => {
      const byChat = { ...s.byChat };
      delete byChat[chatId];
      return { byChat };
    });
    scheduleSave();
  },
}));

/** Load the signed-in account's drafts (lazily, on first use / account change). */
function ensureUser(): void {
  const userId = useAuth.getState().user?.id ?? null;
  if (useDrafts.getState().userId === userId) return;
  useDrafts.setState({ userId, byChat: load(userId) });
}

export function useDraft(chatId: ID | null | undefined): Draft | undefined {
  return useDrafts((s) => (chatId ? s.byChat[chatId] : undefined));
}

export function getDraft(chatId: ID): Draft | undefined {
  ensureUser();
  return useDrafts.getState().byChat[chatId];
}

// Hydrate for the signed-in account now and whenever the account changes.
ensureUser();
useAuth.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id && s.user) ensureUser();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDrafts);
}

registerSessionReset(() => {
  // Drafts are private: forget them on logout.
  const { userId } = useDrafts.getState();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (userId) storage.remove(keyFor(userId));
  useDrafts.setState({ userId: null, byChat: {} });
});
