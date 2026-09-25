import { onBeforeReady } from '../../realtime/hooks.js';
import type { SocketRegistrar } from '../../realtime/types.js';
import { markDeliveredOnConnect } from '../../services/watermarks.js';

// Server-driven delivered receipts (b): on every connect, before `ready`, advance my
// delivered watermarks to the latest visible seq of each active chat and emit
// `chat:watermarks` to the members whose ticks changed (docs "Watermarks").
onBeforeReady((socket) => markDeliveredOnConnect(socket.data.userId));

/** chats socket handlers (see ClientToServerEvents in @enbox/shared). */
export const registerChatsSocket: SocketRegistrar = (_io, _socket) => {};
