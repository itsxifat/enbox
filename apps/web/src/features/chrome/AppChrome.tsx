/**
 * App-wide chrome, mounted once by AppShell above the panes:
 * - the tab title ("(3) Enbox | #general | Gaming"), the favicon badge and the app badge, all
 *   from one memoised count (`computeAttention`); logging out puts them back
 * - Streamer Mode's automatic switch while I share my screen (a voice channel or a call)
 * - the Streamer Mode banner
 */
import { useEffect, useMemo } from 'react';
import { matchPath, useLocation } from 'react-router';
import type { ChatSummary } from '@enbox/shared';
import { useChatMembers } from '@/features/conversation/members';
import { UNNAMED_GROUP_DM, groupDmMemberNames, isUnnamedGroupDm } from '@/features/groupDms/title';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useStreamer } from '@/stores/streamer';
import { useUsers } from '@/stores/users';
import { useVoice } from '@/stores/voice';
import {
  APP_NAME,
  badgeLabel,
  computeAttention,
  documentTitle,
  placeTitle,
  type Attention,
} from './attention';
import { setAppBadge, setFaviconBadge } from './badges';
import { StreamerBanner } from './StreamerBanner';

export function useAttention(): Attention {
  const chats = useChats((s) => s.byId);
  const spaces = useSpaces((s) => s.byId);
  const loaded = useSpaces((s) => s.channelsLoaded);
  return useMemo(() => computeAttention(chats, spaces, loaded), [chats, spaces, loaded]);
}

/**
 * An unnamed group DM reads its members' names (features/groupDms/title.ts, as `useChatTitle`
 * does, for a chat that may be absent); null for every other chat.
 */
function useGroupDmName(chat: ChatSummary | undefined): string | null {
  const meId = useAuth((s) => s.user?.id);
  const unnamed = !!chat && isUnnamedGroupDm(chat);
  const members = useChatMembers(unnamed ? chat : undefined);
  const names = useUsers((s) => (unnamed ? groupDmMemberNames(members, meId, s.byId) : null));
  return unnamed ? (names ?? UNNAMED_GROUP_DM) : null;
}

/** The open conversation (DM, group, channel), else the Space whose page is open. */
function usePlace(): string | null {
  const { pathname } = useLocation();
  const routeSpaceId = matchPath('/spaces/:spaceId/*', pathname)?.params.spaceId;
  const chat = useChats((s) => (s.openChatId ? s.byId[s.openChatId] : undefined));
  const spaceId = chat ? chat.space?.spaceId : routeSpaceId;
  const space = useSpaces((s) => (spaceId ? s.byId[spaceId] : undefined));
  const groupDmName = useGroupDmName(chat);
  return placeTitle(chat, space, groupDmName);
}

function TitleAndBadges() {
  const attention = useAttention();
  const title = documentTitle(attention, usePlace());
  const count = attention.mentions;
  const label = badgeLabel(count);

  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => setFaviconBadge(label), [label]);
  useEffect(() => setAppBadge(count), [count]);
  // Signed out (the shell unmounts): no count may stay on the tab or the app icon.
  useEffect(
    () => () => {
      document.title = APP_NAME;
      setFaviconBadge('');
      setAppBadge(0);
    },
    [],
  );
  return null;
}

/** Streamer Mode ▸ Automatically turn on while sharing my screen (off again when it stops). */
function AutoStreamerMode() {
  const me = useAuth((s) => s.user?.id);
  // My voice state is per account: only a share from this device's connection counts.
  const inVoice = useVoice((s) => !!me && !!s.connection && !!s.byUser[me]?.selfStream);
  const inCall = useCalls((s) => !!s.active?.screenSharing);
  const sharing = inVoice || inCall;
  const auto = useStreamer((s) => s.autoOnScreenShare);
  useEffect(() => {
    const st = useStreamer.getState();
    if (sharing) {
      if (auto && !st.enabled) st.setEnabled(true, { auto: true });
    } else if (st.enabled && st.auto) st.setEnabled(false);
  }, [sharing, auto]);
  return null;
}

export function AppChrome() {
  return (
    <>
      <TitleAndBadges />
      <AutoStreamerMode />
      <StreamerBanner />
    </>
  );
}
