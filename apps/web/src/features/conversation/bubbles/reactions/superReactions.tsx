/**
 * Super reactions (polish wave): the message menu's "Add Super Reaction" (my recent emoji and
 * View More, which opens the picker in super mode, as Add Reaction's) and the hover toolbar's
 * button (the picker with its Super Reaction switch on). Both show where reactions do and
 * follow the same rules (the server's: ADD_REACTIONS for a new emoji, quick-only channels).
 * The chips and their burst: SuperReactionChip.tsx, SuperBurst.tsx.
 */
import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { QUICK_REACTIONS, parseCustomEmoji, type ChatSummary } from '@enbox/shared';
import type { MenuItem } from '@/components/ui';
import { getMyId } from '@/stores/auth';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { canReact } from '../../actions';
import { ToolButton } from '../../ToolButton';
import { canAddNewReaction, isMyBurstReaction, reactionLabel } from './model';
import { ReactionEmoji } from './ReactionEmoji';
import { ReactionPickerPopover } from './ReactionPicker';
import { canAddReaction, canRemoveOwnReaction, toggleReaction } from './reactionActions';
import { recentReactions } from './recent';

const quickOnly = (chat: ChatSummary) =>
  chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';

/** Super reactions show where reactions do: I may add a new emoji, or join one on the message. */
export function canSuperReact(chat: ChatSummary, m: ClientMessage): boolean {
  return canReact(chat, m) && (canAddNewReaction(chat) || m.reactions.length > 0);
}

/** The full picker applies (not a quick-only channel, and I may add new emoji). */
function canPickAny(chat: ChatSummary): boolean {
  return canAddNewReaction(chat) && !quickOnly(chat);
}

/** The menu's choices: quick ones in quick-only channels, the message's own when I may only join. */
function menuChoices(chat: ChatSummary, m: ClientMessage): string[] {
  if (quickOnly(chat)) return [...QUICK_REACTIONS];
  if (!canAddNewReaction(chat)) return m.reactions.map((r) => r.emoji).slice(0, 4);
  return recentReactions(4);
}

/** An emoji as a menu item's label (custom emoji also show their `:name:`). */
function MenuEmoji({ emoji }: { emoji: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 align-middle">
      <ReactionEmoji emoji={emoji} size={22} />
      <span className={parseCustomEmoji(emoji) ? 'truncate' : 'sr-only'}>
        {reactionLabel(emoji)}
      </span>
    </span>
  );
}

/** The message menu's "Add Super Reaction" (opens the picker in super mode), or null. */
export function superReactionMenuItem(
  chat: ChatSummary,
  m: ClientMessage,
  openPicker: () => void,
): MenuItem | null {
  if (!canSuperReact(chat, m)) return null;
  const me = getMyId();
  return {
    label: 'Add Super Reaction',
    icon: Sparkles,
    submenu: [
      ...menuChoices(chat, m).map((e): MenuItem => {
        const mine = isMyBurstReaction(m, me, e);
        return {
          label: <MenuEmoji emoji={e} />,
          disabled: mine ? !canRemoveOwnReaction(chat, m) : !canAddReaction(chat, m, e),
          onSelect: () => void toggleReaction(chat, m, e, { burst: true }),
        };
      }),
      canPickAny(chat) ? { label: 'View More', icon: Plus, onSelect: openPicker } : null,
    ],
  };
}

/**
 * The hover toolbar's "Add Super Reaction" button (next to Add Reaction): the full picker in
 * super mode, or nothing where it doesn't apply (the menu's item still offers the choices).
 * `onOpenChange` lets the toolbar stay shown while the picker is open.
 */
export function SuperReactToolButton({
  chat,
  m,
  onOpenChange,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  onOpenChange?: (open: boolean) => void;
}) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  if (!canReact(chat, m) || !canPickAny(chat)) return null;
  const open = (anchor: HTMLElement | null) => {
    setPicker(anchor);
    onOpenChange?.(!!anchor);
  };
  // The message as it is when the pick lands (reactions may have changed meanwhile).
  const latest = () =>
    useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === m.id) ?? m;
  return (
    <>
      <ToolButton
        icon={Sparkles}
        label="Add Super Reaction"
        aria-haspopup="dialog"
        active={!!picker}
        onClick={(e) => open(picker ? null : e.currentTarget)}
      />
      {picker ? (
        <ReactionPickerPopover
          chat={chat}
          anchor={picker}
          burst
          modeSwitch
          onClose={() => open(null)}
          onPick={(emoji, { burst }) => void toggleReaction(chat, latest(), emoji, { burst })}
        />
      ) : null}
    </>
  );
}
