/**
 * The welcome screen (Discord's legacy server welcome): "Welcome to <Space>!", the
 * description and up to five recommended channels; picking one opens it. `WelcomeContent`
 * is shared with the settings preview.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, Hash } from 'lucide-react';
import type { ID, Space, WelcomeScreen } from '@enbox/shared';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useChats } from '@/stores/chats';
import { SpaceIcon } from './SpaceIcon';

export interface WelcomeChannel {
  id: ID;
  name: string;
  description: string;
  emoji: string | null;
}

export function WelcomeContent({
  spaceName,
  iconUrl,
  description,
  channels,
  onPick,
  headingId,
}: {
  spaceName: string;
  iconUrl: string | null;
  description: string | null;
  channels: WelcomeChannel[];
  /** Absent in previews: the cards are not buttons. */
  onPick?: (channelId: ID) => void;
  headingId?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <SpaceIcon name={spaceName} iconUrl={iconUrl} size={72} className="shadow-sm" />
      <h2 id={headingId} className="mt-4 text-[22px] leading-tight font-bold text-fg">
        Welcome to <span className="break-words">{spaceName}</span>!
      </h2>
      {description ? <p className="mt-2 max-w-sm text-[15px] break-words text-muted">{description}</p> : null}
      {channels.length ? (
        <>
          <p className="section-label mt-6 mb-2 self-start">Start here</p>
          <ul className="flex w-full flex-col gap-2">
            {channels.map((c) => {
              const body = (
                <>
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-[20px] text-muted"
                    aria-hidden
                  >
                    {c.emoji || <Hash size={20} />}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] font-semibold text-fg">#{c.name}</span>
                    <span className="block truncate text-[13px] text-muted">{c.description}</span>
                  </span>
                  {onPick ? <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden /> : null}
                </>
              );
              const cls = 'flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5';
              return (
                <li key={c.id}>
                  {onPick ? (
                    <button
                      type="button"
                      onClick={() => onPick(c.id)}
                      className={cn(cls, 'transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand')}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** The recommended channels I can see, in the screen's order (others are left out). */
export function useWelcomeChannels(screen: WelcomeScreen | null | undefined): WelcomeChannel[] {
  const byId = useChats((s) => s.byId);
  return useMemo(
    () =>
      (screen?.channels ?? []).flatMap((c) => {
        const chat = byId[c.channelId];
        return chat ? [{ id: chat.id, name: chat.name ?? 'channel', description: c.description, emoji: c.emoji }] : [];
      }),
    [byId, screen],
  );
}

export function WelcomeModal({
  space,
  screen,
  onClose,
}: {
  space: Space;
  screen: WelcomeScreen;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const channels = useWelcomeChannels(screen);
  return (
    <Modal open onClose={onClose} aria-label={`Welcome to ${space.name}`} size="md" bodyClassName="pb-6">
      <WelcomeContent
        spaceName={space.name}
        iconUrl={space.iconUrl}
        description={screen.description ?? space.description}
        channels={channels}
        onPick={(channelId) => {
          onClose();
          void navigate(`/spaces/${space.id}/${channelId}`);
        }}
      />
    </Modal>
  );
}
