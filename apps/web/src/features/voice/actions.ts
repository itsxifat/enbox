import type { ChatSummary } from '@enbox/shared';
import { connectVoice } from './engine';

/** Join a voice channel (Discord: clicking a voice row connects at once). */
export function joinVoiceChannel(chat: ChatSummary): void {
  void connectVoice(chat);
}
