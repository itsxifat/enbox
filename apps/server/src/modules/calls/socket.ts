import type { SocketRegistrar } from '../../realtime/types.js';

/** calls socket handlers (see ClientToServerEvents in @enbox/shared). */
export const registerCallsSocket: SocketRegistrar = (_io, _socket) => {};
