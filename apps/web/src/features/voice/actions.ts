import { PERM, hasPerm, type ChatSummary, type ID, type VoiceState } from '@enbox/shared';
import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { useVoice } from '@/stores/voice';
import { connectVoice } from './engine';

/** Join a voice channel or Stage (Discord: clicking a voice row connects at once). */
export function joinVoiceChannel(chat: ChatSummary): void {
  void connectVoice(chat);
}

/**
 * Move someone to another voice channel of the Space (MOVE_MEMBERS: the drag in the channel
 * list, "Move To"). Shows at once; back where they were if the server refuses.
 */
export async function moveVoiceMember(spaceId: ID, userId: ID, channelId: ID): Promise<void> {
  const before = useVoice.getState().byUser[userId];
  if (!before || before.channelId === channelId) return;
  useVoice.getState().applyState({ spaceId, channelId, userId, state: { ...before, channelId } });
  try {
    await api.post(`/api/spaces/${spaceId}/voice-states/${userId}/move`, { channelId });
  } catch (e) {
    // Unless a newer state arrived meanwhile.
    const cur = useVoice.getState().byUser[userId];
    if (cur?.channelId === channelId && cur.joinedAt === before.joinedAt)
      useVoice.getState().applyState({ spaceId, channelId: before.channelId, userId, state: before });
    throw e;
  }
}

/** Disconnect someone from voice (MOVE_MEMBERS). */
export async function disconnectVoiceMember(spaceId: ID, userId: ID): Promise<void> {
  await api.post(`/api/spaces/${spaceId}/voice-states/${userId}/disconnect`);
}

// ---------------------------------------------------------------------------
// Channel status
// ---------------------------------------------------------------------------

/**
 * Whether I may set the channel's status (as the server): connected to it with SPEAK there —
 * on a Stage as a speaker or one of its moderators.
 */
export function canSetVoiceStatus(chat: ChatSummary, mine: VoiceState | undefined): boolean {
  if (!mine || mine.channelId !== chat.id || !hasPerm(chat.spacePermissions, PERM.SPEAK)) return false;
  return chat.type !== 'space_stage' || !mine.suppressed || isStageModerator(chat.spacePermissions);
}

/** The channel's status in the chat list (its `space`), as `chat:updated` would set it. */
function showVoiceStatus(chatId: ID, voiceStatus: string | null): void {
  const space = useChats.getState().byId[chatId]?.space;
  if (space) useChats.getState().applyChatUpdate(chatId, { space: { ...space, voiceStatus } });
}

/**
 * Set the status of the voice channel I am in (blank clears it). Shows at once; the old one
 * comes back if the server refuses — unless a newer one arrived meanwhile.
 */
export async function setVoiceChannelStatus(chatId: ID, text: string): Promise<void> {
  const next = text.trim() || null;
  const before = useChats.getState().byId[chatId]?.space?.voiceStatus ?? null;
  showVoiceStatus(chatId, next);
  try {
    await api.put(`/api/chats/${chatId}/voice-status`, { status: next });
  } catch (e) {
    if ((useChats.getState().byId[chatId]?.space?.voiceStatus ?? null) === next)
      showVoiceStatus(chatId, before);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Stage channels
// ---------------------------------------------------------------------------

/** Stage moderators: MANAGE_CHANNELS, or MUTE_MEMBERS and MOVE_MEMBERS, in the channel (as the server). */
export function isStageModerator(bits: number | null | undefined): boolean {
  return hasPerm(bits, PERM.MANAGE_CHANNELS) || hasPerm(bits, PERM.MUTE_MEMBERS | PERM.MOVE_MEMBERS);
}

/**
 * Show `next` for a Stage change at once, then call the server; its answer replaces it and a
 * refusal puts back what was there — unless a newer state (`voice:state`) arrived meanwhile.
 */
async function optimistic(userId: ID, next: (s: VoiceState) => VoiceState, call: () => Promise<VoiceState>) {
  const before = useVoice.getState().byUser[userId];
  const shown = before ? next(before) : undefined;
  const apply = (state: VoiceState) =>
    useVoice.getState().applyState({ spaceId: state.spaceId, channelId: state.channelId, userId, state });
  if (shown) apply(shown);
  try {
    const state = await call();
    if (useVoice.getState().byUser[userId] === shown) apply(state);
  } catch (e) {
    if (before && shown && useVoice.getState().byUser[userId] === shown) apply(before);
    throw e;
  }
}

/** Raise or lower my hand on the Stage I am in ("Request to Speak"). */
export async function requestToSpeak(spaceId: ID, me: ID, raise: boolean): Promise<void> {
  await optimistic(
    me,
    (s) => ({ ...s, requestToSpeakAt: raise ? (s.requestToSpeakAt ?? new Date().toISOString()) : null }),
    () => api.patch<VoiceState>(`/api/spaces/${spaceId}/voice-states/@me`, { requestToSpeak: raise }),
  );
}

/**
 * Seat someone on a Stage: a speaker (`suppressed: false`: "Invite to Speak", or a moderator
 * stepping up) or in the audience ("Move to Audience"). Their hand goes down either way.
 */
export async function setStageSpeaker(spaceId: ID, userId: ID, suppressed: boolean): Promise<void> {
  await optimistic(
    userId,
    (s) => ({ ...s, suppressed, requestToSpeakAt: null }),
    () => api.patch<VoiceState>(`/api/spaces/${spaceId}/voice-states/${userId}/stage`, { suppressed }),
  );
}
