import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MAX_MESSAGE_LENGTH, type UserPublic } from '@enbox/shared';
import { toast } from '@/components/ui';
import { openDirectChat } from '@/features/contacts/contactActions';
import { sendQueued } from '@/features/conversation/lib/outbox';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';

export type DirectBusy = 'message' | 'audio' | 'video' | null;

/**
 * Message and call someone from a profile surface. `message(text)` opens (creates) our
 * direct chat, sends `text` there through the conversation's own send path (optimistic, kept
 * in the outbox while offline) and navigates to it; without text — or where I may not send,
 * e.g. to someone I blocked — it only opens the chat.
 * Calls follow the cached direct chat's permissions (`canCall`), else "not blocked".
 */
export function useDirectActions(user: UserPublic, onNavigate?: () => void) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<DirectBusy>(null);
  const directChat = useChats((s) =>
    Object.values(s.byId).find((c) => c.type === 'direct' && c.peer?.id === user.id),
  );
  const canCall = !user.isDeleted && (directChat ? directChat.permissions.canCall : !user.isBlocked);

  const message = async (text = ''): Promise<boolean> => {
    const body = text.trim();
    if (body.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`);
      return false;
    }
    setBusy('message');
    try {
      const chat = await openDirectChat(user.id);
      if (body && chat.permissions.canSend) void sendQueued(chat.id, { type: 'text', text: body });
      else if (body)
        // Still open the chat: that is where they can unblock (and see why).
        toast.error(
          user.isBlocked ? 'Unblock them to send a message.' : "You can't message this person.",
        );
      onNavigate?.();
      void navigate(`/chats/${chat.id}`);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const call = async (type: 'audio' | 'video') => {
    setBusy(type);
    try {
      const chat = directChat ?? (await openDirectChat(user.id));
      if (!chat.permissions.canCall) {
        toast.error("You can't call this person.");
        return;
      }
      onNavigate?.();
      void useCalls.getState().startCall(chat.id, type);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return { busy, canCall, message, call };
}
