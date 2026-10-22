/**
 * emoji-picker-react wrapper (native emoji, theme-aware). Heavy: import it through
 * `LazyEmojiPicker` (lazy.ts) so it is only downloaded when first opened.
 *
 * `custom` adds my Spaces' custom emoji (stores/emojis.ts), a section per Space with its icon
 * in the category bar; picking one gives its token (`<:name:id>`, `<a:name:id>`). Pass the
 * chat when in a Space channel: its Space comes first, and other Spaces' emoji are left out
 * where USE_EXTERNAL_EMOJI is denied (the server would send them as `:name:`).
 */
import EmojiPicker, {
  Categories,
  EmojiStyle,
  SuggestionMode,
  Theme,
  type CategoryConfig,
  type EmojiClickData,
} from 'emoji-picker-react';
import { useMemo, type CSSProperties } from 'react';
import {
  PERM,
  customEmojiToken,
  hasPerm,
  type ChatSummary,
  type SpaceEmoji,
  type SpaceEmojiGroup,
} from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { initials } from '@/lib/format';
import { emojiImageUrl, useEmojiGroups } from '@/stores/emojis';
import { useUi } from '@/stores/ui';

export interface EmojiPickerPanelProps {
  onPick: (emoji: string) => void;
  width?: number | string;
  height?: number | string;
  autoFocusSearch?: boolean;
  /** Offer custom emoji of my Spaces (see the header); a Space channel's chat refines it. */
  custom?: boolean | Pick<ChatSummary, 'space' | 'spacePermissions'>;
}

/** Recently used first (it holds custom emoji too). */
const RECENT: CategoryConfig = { category: Categories.SUGGESTED, name: 'Recently Used' };
/** The unicode categories after the custom sections (the library's default order and names). */
const NATIVE_CATEGORIES: CategoryConfig[] = [
  { category: Categories.SMILEYS_PEOPLE, name: 'Smileys & People' },
  { category: Categories.ANIMALS_NATURE, name: 'Animals & Nature' },
  { category: Categories.FOOD_DRINK, name: 'Food & Drink' },
  { category: Categories.TRAVEL_PLACES, name: 'Travel & Places' },
  { category: Categories.ACTIVITIES, name: 'Activities' },
  { category: Categories.OBJECTS, name: 'Objects' },
  { category: Categories.SYMBOLS, name: 'Symbols' },
  { category: Categories.FLAGS, name: 'Flags' },
];

/** A Space's icon (or initials) in the picker's category bar. */
function GroupIcon({ group }: { group: SpaceEmojiGroup }) {
  return group.iconUrl ? (
    <img src={mediaUrl(group.iconUrl)} alt="" className="size-5 rounded-full object-cover" draggable={false} />
  ) : (
    <span className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold" aria-hidden>
      {initials(group.spaceName)}
    </span>
  );
}

/** The groups to show: the current Space first; only it when external emoji are denied. */
export function pickerGroups(
  groups: SpaceEmojiGroup[] | null,
  custom: EmojiPickerPanelProps['custom'],
): SpaceEmojiGroup[] {
  if (!groups || !custom) return [];
  const chat = custom === true ? null : custom;
  const here = chat?.space?.spaceId;
  if (!here) return groups;
  const mine = groups.filter((g) => g.spaceId === here);
  if (!hasPerm(chat.spacePermissions, PERM.USE_EXTERNAL_EMOJI)) return mine;
  return [...mine, ...groups.filter((g) => g.spaceId !== here)];
}

export function EmojiPickerPanel({
  onPick,
  width = '100%',
  height = 360,
  autoFocusSearch = false,
  custom = false,
}: EmojiPickerPanelProps) {
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  const all = useEmojiGroups(!!custom);
  const groups = useMemo(() => pickerGroups(all, custom), [all, custom]);
  const { customEmojis, categories, byId } = useMemo(() => {
    const byId = new Map<string, SpaceEmoji>();
    const customEmojis = groups.flatMap((g) =>
      g.emojis.map((e) => {
        byId.set(e.id.toLowerCase(), e);
        return { id: e.id, names: [e.name], imgUrl: mediaUrl(emojiImageUrl(e, { still: true, known: e }))!, group: g.spaceId };
      }),
    );
    const categories: CategoryConfig[] | undefined = groups.length
      ? [
          RECENT,
          ...groups.map((g) => ({ category: Categories.CUSTOM, name: g.spaceName, group: g.spaceId, icon: <GroupIcon group={g} /> })),
          ...NATIVE_CATEGORIES,
        ]
      : undefined;
    return { customEmojis, categories, byId };
  }, [groups]);

  const onEmojiClick = (d: EmojiClickData) => {
    if (!d.isCustom) return onPick(d.emoji);
    const e = byId.get(d.unified);
    if (e) onPick(customEmojiToken(e));
  };

  return (
    <EmojiPicker
      onEmojiClick={onEmojiClick}
      emojiStyle={EmojiStyle.NATIVE}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      suggestedEmojisMode={SuggestionMode.RECENT}
      lazyLoadEmojis
      autoFocusSearch={autoFocusSearch}
      width={width}
      height={height}
      previewConfig={{ showPreview: false }}
      skinTonesDisabled={false}
      customEmojis={customEmojis}
      categories={categories}
      style={
        {
          '--epr-bg-color': 'var(--elevated)',
          '--epr-category-label-bg-color': 'var(--elevated)',
          '--epr-picker-border-color': 'transparent',
          '--epr-search-input-bg-color': 'var(--surface-2)',
          '--epr-highlight-color': 'var(--brand)',
          '--epr-hover-bg-color': 'var(--hover)',
          '--epr-focus-bg-color': 'var(--selected)',
          '--epr-text-color': 'var(--fg)',
          '--epr-search-border-color': 'var(--brand)',
          '--epr-category-icon-active-color': 'var(--brand)',
          border: 'none',
          borderRadius: 0,
        } as CSSProperties
      }
    />
  );
}
