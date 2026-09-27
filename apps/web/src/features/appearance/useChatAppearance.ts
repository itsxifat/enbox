/**
 * The resolved look of a chat for the viewer (README "Chat themes & animations"):
 * private override > shared theme > device prefs > tokens, memoised per chat/prefs/theme.
 *
 *   const appearance = useChatAppearance(chat);
 *   <div style={appearance.style} {...appearance.data} className="chat-wallpaper …">
 *     <ChatBackground appearance={appearance} />
 */
import { useMemo } from 'react';
import type { ChatSummary } from '@enbox/shared';
import { useUi } from '@/stores/ui';
import { resolveAppearance, type ResolvedAppearance } from './presets';

type AppearanceChat = Pick<ChatSummary, 'theme' | 'sharedTheme' | 'wallpaper'>;

export function useChatAppearance(chat: AppearanceChat | null | undefined): ResolvedAppearance {
  const prefs = useUi((s) => s.prefs);
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  const override = chat?.theme ?? null;
  const shared = chat?.sharedTheme ?? null;
  const media = chat?.wallpaper ?? null;
  return useMemo(
    () => resolveAppearance({ override, shared, device: prefs, resolvedTheme, media }),
    [override, shared, media, prefs, resolvedTheme],
  );
}

/** The device layer alone (Settings → Chats previews). */
export function useDeviceAppearance(): ResolvedAppearance {
  return useChatAppearance(null);
}
