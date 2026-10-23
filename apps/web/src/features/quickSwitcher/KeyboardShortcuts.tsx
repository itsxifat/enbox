/**
 * App-wide keyboard shortcuts (desktop), mounted once by AppShell:
 * - Ctrl/Cmd+K: Quick Switcher; Ctrl/Cmd+/: this list; Ctrl/Cmd+,: User Settings
 * - Alt+Up/Down: previous/next conversation in the sidebar (DMs on Home, text channels in a Space)
 * - Alt+Shift+Up/Down: previous/next unread one
 * - Ctrl+Alt+Up/Down: previous/next Space on the rail (Home first)
 * - Escape (nothing focused, or the empty message box): mark the chat read — the one around the
 *   focus, else the open one — its NEW line and new messages bar too; Shift+Escape: mark the
 *   whole Space read
 * - Ctrl/Cmd+Shift+M / D: toggle mute / deafen
 * A handler that already handled a key (`preventDefault`, e.g. moving a focused rail tile)
 * wins. Also records visited places for the switcher's "Previous channels".
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ChatSummary } from '@enbox/shared';
import { Modal } from '@/components/ui';
import { markConversationRead, signalRead } from '@/features/conversation/newMessages/readSignal';
import { markSpaceRead } from '@/features/spaces/actions';
import { useCalls } from '@/stores/calls';
import { useChats, useSortedChats } from '@/stores/chats';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { useSpaceChannels, useSpaceList } from '@/stores/spaces';
import { toast } from '@/stores/ui';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { QuickSwitcher } from './QuickSwitcher';
import { recordVisit, visitKeyOf } from './recents';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

function isUnread(chat: ChatSummary): boolean {
  const muted = !!chat.mutedUntil && Date.parse(chat.mutedUntil) > Date.now();
  return chat.unreadMentionCount > 0 || (chat.unreadCount > 0 && !muted);
}

/** The next item after (or before) `current` in `list`, optionally only among `pick` ones; wraps. */
export function stepThrough<T>(list: readonly T[], current: number, dir: 1 | -1, pick?: (t: T) => boolean): T | undefined {
  const n = list.length;
  for (let k = 1; k <= n; k++) {
    const t = list[(((current + dir * k) % n) + n) % n]!;
    if (!pick || pick(t)) return t;
  }
  return undefined;
}

function toggleMute() {
  if (useCalls.getState().active) useCalls.getState().toggleMute();
  else useVoiceSelf.getState().toggleMute();
}

function toggleDeafen() {
  const { deafened } = useVoiceSelf.getState();
  const call = useCalls.getState().active;
  useVoiceSelf.getState().toggleDeafen();
  if (call && !deafened && !call.audioMuted) useCalls.getState().toggleMute();
}

/** Escape marks read only when it isn't for something else: nothing focused, or an empty message box. */
export function idleForEscape(el: Element | null): boolean {
  if (!el || el === document.body || el === document.documentElement) return true;
  if (el.matches('textarea[aria-label="Message"]')) return !(el as HTMLTextAreaElement).value;
  if (el.matches('[contenteditable="true"][aria-label="Message"]')) return !el.textContent;
  // The message list itself (its scroller or a row) has nothing of its own to close.
  return !!el.closest('[data-testid="message-list"]') && !el.closest('[role="toolbar"]');
}

/** The chat of the message list around `el` — the nearest one, never one of two (a channel and its thread). */
function chatAround(el: Element | null): string | null {
  for (let p = el; p; p = p.parentElement) {
    const lists = p.querySelectorAll('[data-testid="message-list"][data-chat-id]');
    if (lists.length > 1) return null;
    if (lists.length === 1) return lists[0]!.getAttribute('data-chat-id');
  }
  return null;
}

export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const spaceId = /^\/spaces\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;
  const chatId =
    /^\/spaces\/[0-9a-f-]{36}\/([0-9a-f-]{36})/.exec(pathname)?.[1] ??
    /^\/chats\/([0-9a-f-]{36})/.exec(pathname)?.[1] ??
    null;
  const dms = useSortedChats();
  const channels = useSpaceChannels(spaceId);
  const spaces = useSpaceList();

  // Latest lists for the one window listener.
  const state = useRef({ dms, channels, spaces, spaceId, chatId });
  state.current = { dms, channels, spaces, spaceId, chatId };

  useEffect(() => {
    const key = visitKeyOf(pathname);
    if (key) recordVisit(key);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      const qs = useQuickSwitcher.getState();
      if (mod && !e.shiftKey && !e.altKey && k === 'k') {
        e.preventDefault();
        qs.toggle();
        return;
      }
      if (mod && !e.altKey && (k === '/' || e.code === 'Slash')) {
        e.preventDefault();
        qs.setShortcutsOpen(!qs.shortcutsOpen);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && k === ',') {
        e.preventDefault();
        void navigate('/settings');
        return;
      }
      if (mod && e.shiftKey && !e.altKey && (k === 'm' || k === 'd')) {
        e.preventDefault();
        if (k === 'm') toggleMute();
        else toggleDeafen();
        return;
      }
      if (e.key === 'Escape' && !qs.open && !mod && !e.altKey && idleForEscape(document.activeElement)) {
        const { spaceId } = state.current;
        // The conversation being read: the one around the focus (a thread's box marks the
        // thread), else the open chat.
        const chatId =
          chatAround(document.activeElement) ?? useChats.getState().openChatId ?? state.current.chatId;
        // Escape closes dialogs, menus and searches first (their window listeners may run
        // after this one): mark read once the key went through untouched.
        setTimeout(() => {
          if (e.defaultPrevented) return;
          if (e.shiftKey && spaceId) {
            void markSpaceRead(spaceId).catch((err: unknown) => toast.error(err));
            if (chatId) signalRead(chatId);
          } else if (chatId) markConversationRead(chatId);
        }, 0);
        return;
      }
      if (qs.open || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      const s = state.current;
      if (e.altKey && e.ctrlKey && !e.shiftKey) {
        // Spaces: Home (index -1) then the rail order.
        e.preventDefault();
        const ids = [null, ...s.spaces.map((sp) => sp.id)];
        const next = stepThrough(ids, ids.indexOf(s.spaceId), dir);
        void navigate(next ? `/spaces/${next}` : '/chats');
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const list = s.spaceId ? s.channels.filter((c) => c.type === 'space_text') : s.dms;
      if (!list.length) return;
      e.preventDefault();
      const at = list.findIndex((c) => c.id === s.chatId);
      const next = stepThrough(list, at < 0 && dir === -1 ? 0 : at, dir, e.shiftKey ? isUnread : undefined);
      if (!next) return;
      void navigate(next.space ? `/spaces/${next.space.spaceId}/${next.id}` : `/chats/${next.id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <>
      <QuickSwitcher />
      <ShortcutsSheet />
    </>
  );
}

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Navigation',
    rows: [
      ['Open the Quick Switcher', `${MOD} K`],
      ['Back / forward', IS_MAC ? '⌘ [ / ⌘ ]' : 'Alt ← / Alt →'],
      ['Previous / next channel or DM', 'Alt ↑ / Alt ↓'],
      ['Previous / next unread', 'Alt Shift ↑ / ↓'],
      ['Previous / next server', `${IS_MAC ? '⌃' : 'Ctrl'} Alt ↑ / ↓`],
      ['Mark channel as read', 'Esc'],
      ['Mark Space as read', 'Shift Esc'],
      ['Toggle the Inbox', `${MOD} I`],
      ['Search the conversation', `${MOD} F`],
      ['User Settings', `${MOD} ,`],
      ['Zoom in / out', `${MOD} = / ${MOD} -`],
      ['Reset zoom', `${MOD} 0`],
    ],
  },
  {
    title: 'Focused message',
    rows: [
      ['Previous / next message', '↑ / ↓'],
      ['Edit (yours)', 'E'],
      ['Reply', 'R'],
      ['Delete', 'Backspace'],
      ['Pin / unpin', 'P'],
      ['Add reaction', '+'],
      ['Copy text', `${MOD} C`],
      ['Back to the message box', 'Esc'],
    ],
  },
  {
    title: 'Messages',
    rows: [
      ['Send', 'Enter'],
      ['New line', 'Shift Enter'],
      ['Upload without the tray', 'Hold Shift while dropping'],
      ['Bold', `${MOD} B`],
      ['Italic', `${MOD} I`],
      ['Underline', `${MOD} U`],
      ['Strikethrough', `${MOD} Shift X`],
      ['Formatting toolbar (text selected)', 'Alt F10'],
    ],
  },
  {
    title: 'Voice',
    rows: [
      ['Toggle mute', `${MOD} Shift M`],
      ['Toggle deafen', `${MOD} Shift D`],
    ],
  },
  {
    title: 'Other',
    rows: [['Keyboard shortcuts', `${MOD} /`]],
  },
];

function ShortcutsSheet() {
  const open = useQuickSwitcher((s) => s.shortcutsOpen);
  const setOpen = useQuickSwitcher((s) => s.setShortcutsOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard Shortcuts" size="lg">
      <div className="grid gap-5 pb-2 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="section-label mb-2">{g.title}</h3>
            <dl className="space-y-1.5">
              {g.rows.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-[14px]">
                  <dt className="text-muted">{label}</dt>
                  <dd>
                    <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap text-fg shadow-[0_1px_0_var(--line-strong)]">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
