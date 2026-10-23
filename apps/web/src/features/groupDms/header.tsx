/**
 * Conversation header pieces (ConversationHeader): a group DM's name, renamed inline by any
 * member; its "Add Friends to DM" (the picker, limited to non-members and the slots left) and
 * member list toggle; a DM's "Add Friends to DM" (a NEW group DM with the two of us and the
 * friends picked). Phones get the buttons as header menu entries instead (`…MenuItems`).
 */
import { Suspense, useRef, useState } from 'react';
import { LogOut, UserPlus, Users } from 'lucide-react';
import { MAX_GROUP_NAME_LENGTH, type ChatSummary, type ID } from '@enbox/shared';
import { IconButton, type MenuEntry, type PopoverAnchor } from '@/components/ui';
import { leaveGroupDm, renameGroupDm } from './actions';
import { GroupDmMembersSheet, SelectFriendsPopover } from './lazy';
import { useGroupDmUi } from './state';
import { useChatTitle } from './title';

/** The name in the header; any member clicks it to rename (Enter saves, Escape cancels; empty clears). */
export function GroupDmName({ chat }: { chat: ChatSummary }) {
  const title = useChatTitle(chat);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = useRef(false);
  const canRename = chat.membership === 'active' && chat.permissions.canEditInfo;

  const start = () => {
    editing.current = true;
    setDraft(chat.name ?? '');
  };
  const finish = (save: boolean, value: string) => {
    // Enter / Escape unmount the input, which may blur it: finish once.
    if (!editing.current) return;
    editing.current = false;
    setDraft(null);
    if (save) void renameGroupDm(chat, value);
  };

  if (draft !== null)
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => finish(true, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true, e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false, '');
          }
        }}
        maxLength={MAX_GROUP_NAME_LENGTH}
        placeholder={title}
        aria-label="Group name"
        className="-ml-1.5 w-full min-w-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[17px] font-semibold text-fg outline-none placeholder:font-normal placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-brand"
      />
    );
  if (!canRename) return <>{title}</>;
  return (
    <button
      type="button"
      onClick={start}
      title="Rename"
      aria-label={`${title}, rename the group`}
      className="-ml-1.5 block max-w-full truncate rounded-md px-1.5 py-0.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
    >
      {title}
    </button>
  );
}

/** The picker and the member list of `chat`, opened from its header or its menu. */
function Panels({ chat, mode }: { chat: ChatSummary; mode: 'add' | 'dm' }) {
  const picker = useGroupDmUi((s) => (s.picker?.chatId === chat.id ? s.picker : null));
  const membersOpen = useGroupDmUi((s) => s.membersOf === chat.id);
  const { closePicker, closeMembers } = useGroupDmUi.getState();
  return (
    <Suspense fallback={null}>
      {picker ? (
        <SelectFriendsPopover
          mode={{ kind: mode, chat }}
          anchor={picker.anchor}
          onClose={closePicker}
          align="end"
        />
      ) : null}
      {membersOpen && mode === 'add' ? (
        <GroupDmMembersSheet chat={chat} onClose={closeMembers} />
      ) : null}
    </Suspense>
  );
}

/** The desktop "Add Friends to DM" button (toggles the picker under it). */
function AddFriendsButton({ chat }: { chat: ChatSummary }) {
  const picking = useGroupDmUi((s) => s.picker?.chatId === chat.id);
  return (
    <IconButton
      icon={UserPlus}
      label="Add Friends to DM"
      active={picking}
      onClick={(e) => {
        const ui = useGroupDmUi.getState();
        if (picking) ui.closePicker();
        else ui.openPicker(chat.id, e.currentTarget);
      }}
    />
  );
}

/** A group DM's "Add Friends to DM" and member list toggle (desktop), and what they open. */
export function GroupDmTools({ chat, desktop }: { chat: ChatSummary; desktop: boolean }) {
  const membersOpen = useGroupDmUi((s) => s.membersOf === chat.id);
  const { toggleMembers } = useGroupDmUi.getState();
  return (
    <>
      {desktop && chat.membership === 'active' ? <AddFriendsButton chat={chat} /> : null}
      {desktop ? (
        <IconButton
          icon={Users}
          label={membersOpen ? 'Hide Member List' : 'Show Member List'}
          active={membersOpen}
          aria-pressed={membersOpen}
          onClick={() => toggleMembers(chat.id)}
        />
      ) : null}
      <Panels chat={chat} mode="add" />
    </>
  );
}

/** A DM with a friend can grow into a group DM (both of us plus the friends picked). */
export function canAddFriendsToDm(chat: ChatSummary, meId: ID | null | undefined): boolean {
  const peer = chat.peer;
  return (
    chat.type === 'direct' &&
    chat.membership === 'active' &&
    !!peer &&
    peer.id !== meId &&
    peer.isContact &&
    !peer.isBlocked &&
    !peer.isDeleted
  );
}

/** A DM's "Add Friends to DM" (desktop button) and its picker. */
export function DmAddFriendsTool({ chat, desktop }: { chat: ChatSummary; desktop: boolean }) {
  return (
    <>
      {desktop ? <AddFriendsButton chat={chat} /> : null}
      <Panels chat={chat} mode="dm" />
    </>
  );
}

/** Phones: the picker hangs from the header's right edge. */
const underHeader = (): PopoverAnchor => ({ x: window.innerWidth - 8, y: 64 });

/** Phones' header menu: "Add Friends to DM" (the desktop button). */
export function addFriendsMenuItem(chat: ChatSummary): MenuEntry {
  return {
    label: 'Add Friends to DM',
    icon: UserPlus,
    onSelect: () => useGroupDmUi.getState().openPicker(chat.id, underHeader()),
  };
}

/** A group DM's header menu entries: its member list and Leave Group (then `onLeft`). */
export function groupDmMenuItems(
  chat: ChatSummary,
  opts: { title: string; onLeft: () => void },
): { members: MenuEntry; leave: MenuEntry } {
  return {
    members: {
      label: 'Members',
      icon: Users,
      onSelect: () => useGroupDmUi.getState().toggleMembers(chat.id),
    },
    leave:
      chat.membership === 'active'
        ? {
            label: 'Leave Group',
            icon: LogOut,
            danger: true,
            onSelect: () =>
              void leaveGroupDm(chat, opts.title).then((ok) => {
                if (ok) opts.onLeft();
              }),
          }
        : null,
  };
}
