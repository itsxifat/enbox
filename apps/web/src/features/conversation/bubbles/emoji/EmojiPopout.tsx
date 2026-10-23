/**
 * Discord's emoji popout: a click on an emoji in a message opens a small card with the emoji
 * large and its `:name:`. A custom emoji also says where it is from: "This emoji is from
 * <Space>" with Open Space when I'm in that Space (my Spaces' emoji, stores/emojis.ts), else
 * "a Space you're not in". `CustomEmojiButton` and `UnicodeEmojiButton` are the clickable
 * emoji of bubbles/RichText.
 */
import { memo, useEffect, useState } from 'react';
import type { ID } from '@enbox/shared';
import { CustomEmoji, type CustomEmojiSize } from '@/components/emoji/CustomEmoji';
import { Button, Popover, Spinner } from '@/components/ui';
import { bus } from '@/lib/bus';
import { useEmojis } from '@/stores/emojis';
import { useSpaces } from '@/stores/spaces';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { unicodeEmojiName } from './unicodeEmoji';

export type PopoutEmoji =
  | { kind: 'custom'; id: ID; name: string; animated: boolean }
  | { kind: 'unicode'; emoji: string };

const BUTTON =
  'inline cursor-pointer rounded-sm align-baseline outline-none focus-visible:outline-2 focus-visible:outline-brand';

function useAnchor() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    // The row's own click handling (select mode, the double-tap reaction) must not see it.
    e.stopPropagation();
    setAnchor(anchor ? null : e.currentTarget);
  };
  return { anchor, toggle, close: () => setAnchor(null) };
}

/** A custom emoji in message text that opens its popout. */
export const CustomEmojiButton = memo(function CustomEmojiButton({
  id,
  name,
  animated,
  size,
}: {
  id: ID;
  name: string;
  animated: boolean;
  size: CustomEmojiSize;
}) {
  const { anchor, toggle, close } = useAnchor();
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={!!anchor} onClick={toggle} className={BUTTON}>
        <CustomEmoji id={id} name={name} animated={animated} size={size} />
      </button>
      {anchor ? (
        <EmojiPopout emoji={{ kind: 'custom', id, name, animated }} anchor={anchor} onClose={close} />
      ) : null}
    </>
  );
});

/** A unicode emoji in message text that opens its popout. */
export const UnicodeEmojiButton = memo(function UnicodeEmojiButton({ emoji }: { emoji: string }) {
  const { anchor, toggle, close } = useAnchor();
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={!!anchor} onClick={toggle} className={BUTTON}>
        {emoji}
      </button>
      {anchor ? <EmojiPopout emoji={{ kind: 'unicode', emoji }} anchor={anchor} onClose={close} /> : null}
    </>
  );
});

export function EmojiPopout({
  emoji,
  anchor,
  onClose,
}: {
  emoji: PopoutEmoji;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const label = emoji.kind === 'custom' ? `:${emoji.name}:` : 'Emoji';
  return (
    <Popover open anchor={anchor} onClose={onClose} aria-label={label}>
      <div className="flex w-64 flex-col gap-3 p-4" data-testid="emoji-popout">
        {emoji.kind === 'custom' ? (
          <CustomBody emoji={emoji} onClose={onClose} />
        ) : (
          <UnicodeBody emoji={emoji.emoji} />
        )}
      </div>
    </Popover>
  );
}

function Heading({ glyph, name }: { glyph: React.ReactNode; name: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-12 shrink-0 items-center justify-center text-[40px] leading-none">{glyph}</span>
      {name ? <p className="min-w-0 truncate text-[16px] font-bold text-fg">{name}</p> : null}
    </div>
  );
}

function UnicodeBody({ emoji }: { emoji: string }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    unicodeEmojiName(emoji)
      .then((n) => {
        if (live) setName(n);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [emoji]);
  return <Heading glyph={emoji} name={name} />;
}

function CustomBody({
  emoji,
  onClose,
}: {
  emoji: Extract<PopoutEmoji, { kind: 'custom' }>;
  onClose: () => void;
}) {
  const loaded = useEmojis((s) => !!s.groups);
  const spaceId = useEmojis((s) => s.byId[emoji.id]?.spaceId ?? null);
  const space = useSpaces((s) => (spaceId ? s.byId[spaceId] : undefined));
  useEffect(() => {
    void useEmojis
      .getState()
      .loadMine()
      .catch(() => undefined);
  }, []);
  return (
    <>
      <Heading
        glyph={<CustomEmoji id={emoji.id} name={emoji.name} animated={emoji.animated} size={48} />}
        name={`:${emoji.name}:`}
      />
      {space ? (
        <div className="flex flex-col gap-2.5 rounded-xl bg-surface-2 p-3">
          <p className="text-[13px] text-muted">This emoji is from</p>
          <div className="flex min-w-0 items-center gap-2.5">
            <SpaceIcon name={space.name} iconUrl={space.iconUrl} size={32} />
            <span className="min-w-0 truncate text-[14px] font-semibold text-fg">{space.name}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onClose();
              bus.emit('navigate', { to: `/spaces/${space.id}` });
            }}
          >
            Open Space
          </Button>
        </div>
      ) : loaded ? (
        <p className="text-[13px] text-muted">This emoji is from a Space you’re not in.</p>
      ) : (
        <Spinner size={18} className="self-center text-brand-ink" />
      )}
    </>
  );
}
