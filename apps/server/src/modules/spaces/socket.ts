import { rooms, spaceFocusSchema, spaceMembersSubscribeSchema } from '@enbox/shared';
import { db } from '../../db/index.js';
import { socketHandler } from '../../realtime/handler.js';
import { canViewLoaded } from '../../realtime/spaceRegistry.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import { getChatAccess } from '../../services/chats.js';
import { requireSpaceMember } from '../../services/spaceAccess.js';

/**
 * Spaces socket handlers:
 * - `space:focus { chatId | null }`: this device has that space channel open → it joins the
 *   real room `chat-focus:<id>` (typing in space channels goes there only). One at a time.
 * - `space:members-subscribe { spaceId | null }`: member list events of a large Space reach
 *   this device (`space-members:<id>`). One at a time.
 */
export const registerSpacesSocket: SocketRegistrar = (_io, socket) => {
  let focused: string | null = null;
  let members: string | null = null;

  socket.on(
    'space:focus',
    socketHandler(socket, spaceFocusSchema, async ({ chatId }, { userId }) => {
      if (focused === chatId) return;
      if (focused) void socket.leave(rooms.chatFocus(focused));
      focused = null;
      if (!chatId) return;
      const ok =
        canViewLoaded(userId, chatId) ||
        !!(await getChatAccess(db, userId, chatId).catch(() => null))?.space;
      if (!ok || socket.disconnected) return;
      focused = chatId;
      await socket.join(rooms.chatFocus(chatId));
    }),
  );

  socket.on(
    'space:members-subscribe',
    socketHandler(socket, spaceMembersSubscribeSchema, async ({ spaceId }, { userId }) => {
      if (members === spaceId) return;
      if (members) void socket.leave(rooms.spaceMembers(members));
      members = null;
      if (!spaceId) return;
      await requireSpaceMember(db, spaceId, userId);
      if (socket.disconnected) return;
      members = spaceId;
      await socket.join(rooms.spaceMembers(spaceId));
    }),
  );
};
