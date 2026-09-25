import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '@enbox/shared';

export type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type ServerEvent = keyof ServerToClientEvents;
export type ServerPayload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

/** A module's socket registrar: attach listeners for one authenticated socket (synchronously). */
export type SocketRegistrar = (io: IO, socket: AppSocket) => void;
