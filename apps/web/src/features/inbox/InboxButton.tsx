/**
 * The header's Inbox button (Space channels, DMs, Friends) and its popout (Mentions,
 * Unreads). A red dot shows while I have unread mentions (`inboxMentionCount`). Ctrl+I
 * (⌘I on macOS) toggles the popout of the newest mounted button; Escape closes it.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { Inbox as InboxIcon } from 'lucide-react';
import { Badge, IconButton, Popover } from '@/components/ui';
import { useChats } from '@/stores/chats';
import { useInbox } from '@/stores/inbox';
import { useSpaces } from '@/stores/spaces';
import { InboxPopout } from './InboxPopout';
import { inboxMentionCount, spaceIdOfPath } from './lib';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const INBOX_SHORTCUT = IS_MAC ? '⌘ I' : 'Ctrl I';

/** Mounted buttons, newest last: Ctrl+I opens the newest one's popout. */
const buttons: string[] = [];

function onShortcut(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat) return;
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (!mod || e.shiftKey || e.altKey || (IS_MAC ? e.ctrlKey : e.metaKey)) return;
  if (e.key.toLowerCase() !== 'i' && e.code !== 'KeyI') return;
  const owner = buttons.at(-1);
  if (!owner) return;
  e.preventDefault();
  useInbox.getState().toggle(owner);
}

/** Register a button for the shortcut (one window listener for all of them). */
function useShortcutTarget(id: string): void {
  useEffect(() => {
    buttons.push(id);
    if (buttons.length === 1) window.addEventListener('keydown', onShortcut);
    return () => {
      const i = buttons.lastIndexOf(id);
      if (i >= 0) buttons.splice(i, 1);
      if (buttons.length === 0) window.removeEventListener('keydown', onShortcut);
      // Its header went away (navigation): the popout goes with it.
      const s = useInbox.getState();
      if (s.open && s.owner === id) s.setOpen(false);
    };
  }, [id]);
}

/** Unread mentions of me (the dot). */
export function useInboxMentionCount(): number {
  const chats = useChats((s) => s.byId);
  const spaces = useSpaces((s) => s.byId);
  const loaded = useSpaces((s) => s.channelsLoaded);
  return useMemo(() => inboxMentionCount(chats, spaces, loaded), [chats, spaces, loaded]);
}

export function InboxButton() {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = useInbox((s) => s.open && s.owner === id);
  const count = useInboxMentionCount();
  const { pathname } = useLocation();
  const pathSpace = spaceIdOfPath(pathname);
  const spaceId = useSpaces((s) => (pathSpace && s.byId[pathSpace] ? pathSpace : null));
  useShortcutTarget(id);
  const close = useCallback(() => useInbox.getState().setOpen(false), []);
  const label = count > 0 ? `Inbox, ${count} unread mention${count === 1 ? '' : 's'}` : 'Inbox';
  return (
    <>
      <IconButton
        ref={setAnchor}
        icon={InboxIcon}
        label={label}
        title={`Inbox (${INBOX_SHORTCUT})`}
        variant="ghost"
        active={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="inbox-button"
        badge={
          count > 0 ? (
            <Badge dot tone="danger" className="relative top-[9px] right-[9px] ring-2 ring-surface" />
          ) : undefined
        }
        onClick={() => useInbox.getState().toggle(id)}
      />
      <Popover
        open={open}
        anchor={anchor}
        onClose={close}
        placement="bottom"
        align="end"
        aria-label="Inbox"
        className="flex h-[min(640px,calc(100dvh-80px))] w-[480px] max-w-[calc(100vw-16px)] flex-col overflow-hidden"
      >
        <InboxPopout spaceId={spaceId} onClose={close} />
      </Popover>
    </>
  );
}
