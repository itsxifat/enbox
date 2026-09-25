/**
 * Connection lifecycle hooks that feature modules register at import time (from their
 * socket.ts). io.ts runs them for every authenticated socket, in registration order:
 *
 *   1. socket joins user:<id> + session:<id>, then its active chat rooms
 *   2. `beforeReady` hooks      e.g. chats: advance delivered watermarks (+ chat:watermarks)
 *   3. `ready` is emitted
 *   4. `afterReady` hooks       e.g. calls: re-emit `call:incoming` for calls still ringing me
 *
 * A failing hook is logged and does not block the connection. Hooks must not assume the
 * socket is still connected after an await.
 */
import type { AppSocket } from './types.js';

export type ConnectHook = (socket: AppSocket) => Promise<void> | void;

const beforeReady: ConnectHook[] = [];
const afterReady: ConnectHook[] = [];

export function onBeforeReady(hook: ConnectHook): void {
  beforeReady.push(hook);
}

export function onAfterReady(hook: ConnectHook): void {
  afterReady.push(hook);
}

export function beforeReadyHooks(): readonly ConnectHook[] {
  return beforeReady;
}

export function afterReadyHooks(): readonly ConnectHook[] {
  return afterReady;
}
