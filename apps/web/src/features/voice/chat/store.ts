/**
 * The text chat of voice and Stage channels (docs/design/discord-parity.md W8-F "Text in
 * Voice"), session state:
 * - `open`: the channels whose chat I left open. Remembered per channel while the app runs,
 *   so going back to a voice channel on desktop shows its chat again (phones always start
 *   on the call view).
 * - `pending`: open this channel's chat as soon as its view shows (the sidebar's Open Chat
 *   icon, the Inbox), consumed by that view's Chat button.
 * - `viewing`: the voice or Stage channel whose view is on screen (its Chat button is
 *   mounted), so opening its chat needs no navigation.
 * The panel itself is the side panel `{ kind: 'voiceChat', channelId }` (stores/sidePanel.ts).
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';

interface VoiceChatState {
  open: Record<ID, true>;
  pending: ID | null;
  viewing: ID | null;
  remember(channelId: ID, open: boolean): void;
}

const initial = { open: {} as Record<ID, true>, pending: null as ID | null, viewing: null as ID | null };

export const useVoiceChat = create<VoiceChatState>((set) => ({
  ...initial,
  remember: (channelId, open) =>
    set((s) => {
      if (!!s.open[channelId] === open) return s;
      const next = { ...s.open };
      if (open) next[channelId] = true;
      else delete next[channelId];
      return { open: next };
    }),
}));

registerSessionReset(() => useVoiceChat.setState(initial));
