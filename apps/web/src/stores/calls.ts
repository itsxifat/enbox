/**
 * Calls store — SKELETON owned by feature agent 4 (calls UI / WebRTC).
 *
 * The foundation only guarantees:
 * - `incoming` is set by realtime/calls.ts on `call:incoming` (cleared on
 *   `call:ring-stop` / `call:ended` for that call) and rendered by
 *   features/calls/CallOverlay.
 * - `startCall(chatId, type)` is the entry point the conversation header (agent 2) and
 *   contact/group info (agents 1/3) call. Agent 4 implements it (call:start ack, media,
 *   peer connections). Keep MediaStreams / RTCPeerConnections OUTSIDE the store (refs or
 *   module state) and mirror only serializable state here.
 *
 * TODO(agent 4): flesh out `ActiveCall`, accept/decline/leave, media toggles, call log.
 */
import { create } from 'zustand';
import type { Call, CallType, ID, IncomingCallPayload } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';
import { sendEvent } from '@/lib/socket';
import { toast } from './ui';

export interface ActiveCall {
  call: Call;
  /** Local media state (mirrors what we send with `call:media`). */
  audioMuted: boolean;
  videoOff: boolean;
  screenSharing: boolean;
  /** UI: full screen vs minimized picture-in-picture. */
  minimized: boolean;
}

export interface CallsState {
  incoming: IncomingCallPayload | null;
  active: ActiveCall | null;

  setIncoming(payload: IncomingCallPayload | null): void;
  setActive(active: ActiveCall | null): void;
  patchActive(partial: Partial<ActiveCall>): void;
  /** Start a call in a chat (1:1 or group). */
  startCall(chatId: ID, type: CallType, userIds?: ID[]): Promise<void>;
  acceptIncoming(): Promise<void>;
  declineIncoming(): void;
}

export const useCalls = create<CallsState>((set, get) => ({
  incoming: null,
  active: null,

  setIncoming(incoming) {
    set({ incoming });
  },
  setActive(active) {
    set({ active });
  },
  patchActive(partial) {
    const active = get().active;
    if (active) set({ active: { ...active, ...partial } });
  },

  // PLACEHOLDER (agent 4): replace with the real WebRTC flow.
  async startCall(_chatId, type) {
    toast.info(`${type === 'video' ? 'Video' : 'Voice'} calls are coming soon`);
  },
  async acceptIncoming() {
    toast.info('Calls are coming soon');
    set({ incoming: null });
  },
  declineIncoming() {
    const incoming = get().incoming;
    if (incoming) sendEvent('call:decline', { callId: incoming.call.id });
    set({ incoming: null });
  },
}));

registerSessionReset(() => useCalls.setState({ incoming: null, active: null }));
