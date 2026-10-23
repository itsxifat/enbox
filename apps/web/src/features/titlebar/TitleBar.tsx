import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useNavigate, type Location } from 'react-router';
import { ArrowLeft, ArrowRight, CircleHelp, Sparkles } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import type { IconType } from '@/components/ui';
import { useChatTitle } from '@/features/groupDms/title';
import { settingsLinkState } from '@/features/settings/SettingsLayer';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { openWhatsNew } from '@/features/whatsNew/store';
import { useChat } from '@/stores/chats';
import { useSpace } from '@/stores/spaces';
import { HISTORY_KEYS, canGoBack, canGoForward, useNavHistory } from './history';
import { channelLabel, routePlace } from './place';

function BarButton({
  icon: Icon,
  label,
  hint,
  ...rest
}: { icon: IconType; label: string; hint?: string } & ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className="flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-35"
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

function ChatPlace({ chat }: { chat: ChatSummary }) {
  const title = useChatTitle(chat);
  return (
    <>
      <ChatAvatar chat={chat} size={16} />
      <span className="truncate">{title}</span>
    </>
  );
}

/** The middle: where the page is (the open channel and its Space, a DM, an app page). */
function Place({ pathname }: { pathname: string }) {
  const place = routePlace(pathname);
  const space = useSpace(place?.kind === 'channel' || place?.kind === 'space' ? place.spaceId : null);
  const chat = useChat(place?.kind === 'channel' || place?.kind === 'chat' ? place.chatId : null);
  let body: ReactNode = null;
  if (place?.kind === 'page') body = <span className="truncate">{place.title}</span>;
  else if (place?.kind === 'chat') body = chat ? <ChatPlace chat={chat} /> : null;
  else if (place && space) {
    const lead = place.kind === 'channel' ? (chat ? channelLabel(chat) : null) : place.page;
    body = (
      <>
        <SpaceIcon name={space.name} iconUrl={space.iconUrl} size={16} />
        <span className="truncate">
          {lead ? (
            <>
              {lead}
              <span className="text-subtle"> · </span>
            </>
          ) : null}
          <span className={lead ? 'text-muted' : undefined}>{space.name}</span>
        </span>
      </>
    );
  }
  return (
    <p
      className="flex max-w-[50vw] min-w-0 items-center justify-center gap-1.5 text-[13px] font-semibold text-fg"
      data-testid="title-bar-place"
    >
      {body}
    </p>
  );
}

/**
 * The slim bar across the top of the desktop app: Back and Forward through this tab's
 * history (disabled when there is nowhere to go; keys in history.ts), the place in the middle,
 * What's New and Help on the right. AppShell renders it on desktop only, for the page it shows
 * (`location`: behind User Settings, the page settings opened over).
 */
export function TitleBar({ location }: { location: Location }) {
  const navigate = useNavigate();
  const back = useNavHistory((s) => canGoBack(s.trail));
  const forward = useNavHistory((s) => canGoForward(s.trail));
  return (
    // A banner landmark, not a <header>: "header" stays the open chat's or page's own header.
    <div
      role="banner"
      aria-label="Title bar"
      className="grid h-8 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-3 px-3"
      data-testid="title-bar"
    >
      <div className="flex items-center gap-1">
        <BarButton
          icon={ArrowLeft}
          label="Back"
          hint={HISTORY_KEYS.back}
          aria-keyshortcuts={HISTORY_KEYS.backAria}
          disabled={!back}
          onClick={() => void navigate(-1)}
        />
        <BarButton
          icon={ArrowRight}
          label="Forward"
          hint={HISTORY_KEYS.forward}
          aria-keyshortcuts={HISTORY_KEYS.forwardAria}
          disabled={!forward}
          onClick={() => void navigate(1)}
        />
      </div>
      <Place pathname={location.pathname} />
      <div className="flex items-center justify-end gap-1">
        <BarButton icon={Sparkles} label="What’s New" onClick={() => openWhatsNew()} />
        <BarButton
          icon={CircleHelp}
          label="Help"
          onClick={() => void navigate('/settings/help', { state: settingsLinkState(location) })}
        />
      </div>
    </div>
  );
}
