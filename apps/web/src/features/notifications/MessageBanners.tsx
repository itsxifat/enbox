/**
 * The in-app message banners (./banners.ts): small cards at the top right (full width on
 * phones), newest on top. A click opens the chat at the message; ✕ or BANNER_MS hide one;
 * hovering or focusing it holds it. A banner whose chat gets opened goes away.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { Avatar, IconButton, Portal } from '@/components/ui';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { jumpToMessage } from '@/features/inbox/lib';
import { useChats } from '@/stores/chats';
import { BANNER_MS, dismissBanner, useBanners, type MessageBanner } from './banners';

function BannerCard({ banner, onOpen }: { banner: MessageBanner; onOpen: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const t = setTimeout(() => dismissBanner(banner.chatId), BANNER_MS);
    return () => clearTimeout(t);
  }, [banner.chatId, banner.message.id, held]);
  return (
    <div
      data-testid="message-banner"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      className="pointer-events-auto relative w-full animate-slide-in-right rounded-2xl border border-line bg-elevated shadow-elevated"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${banner.name}${banner.where ? ` in ${banner.where}` : ''}: ${banner.text}`}
        className="flex w-full min-w-0 items-start gap-3 rounded-2xl p-3 pr-10 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <Avatar
          src={banner.avatarUrl}
          name={banner.name}
          colorSeed={banner.avatarSeed}
          size="md"
          decorative
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-semibold text-fg">{banner.name}</span>
            {banner.where ? (
              <span className="min-w-0 truncate text-[12.5px] text-muted">{banner.where}</span>
            ) : null}
          </span>
          <span className="line-clamp-2 text-[13.5px] leading-snug break-words text-muted">
            {banner.text}
          </span>
        </span>
      </button>
      <IconButton
        icon={X}
        label="Dismiss"
        size="xs"
        className="absolute top-2 right-2"
        onClick={() => dismissBanner(banner.chatId)}
      />
    </div>
  );
}

export function MessageBanners() {
  const banners = useBanners((s) => s.banners);
  const openChatId = useChats((s) => s.openChatId);
  const navigate = useNavigate();
  useEffect(() => {
    if (openChatId) dismissBanner(openChatId);
  }, [openChatId]);
  const shown = banners.filter((b) => b.chatId !== openChatId);
  // Over everything (Settings included); the live region exists before a banner lands in it.
  return (
    <Portal>
      <div
        aria-live="polite"
        aria-label="New messages"
        className="pointer-events-none fixed inset-x-3 top-[max(8px,env(safe-area-inset-top))] z-[65] flex flex-col gap-2 sm:left-auto sm:w-[360px] lg:top-14"
      >
        {shown.map((b) => (
          <BannerCard
            key={b.chatId}
            banner={b}
            onOpen={() => {
              dismissBanner(b.chatId);
              void jumpToMessage(
                b.chatId,
                b.message,
                (to) => void navigate(to, { state: IN_APP_NAV }),
              );
            }}
          />
        ))}
      </div>
    </Portal>
  );
}
