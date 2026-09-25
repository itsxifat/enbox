/**
 * emoji-picker-react wrapper (native emoji, theme-aware). Heavy: import it through
 * `LazyEmojiPicker` (lazy.ts) so it is only downloaded when first opened.
 */
import EmojiPicker, {
  EmojiStyle,
  SuggestionMode,
  Theme,
  type EmojiClickData,
} from 'emoji-picker-react';
import type { CSSProperties } from 'react';
import { useUi } from '@/stores/ui';

export interface EmojiPickerPanelProps {
  onPick: (emoji: string) => void;
  width?: number | string;
  height?: number | string;
  autoFocusSearch?: boolean;
}

export function EmojiPickerPanel({
  onPick,
  width = '100%',
  height = 360,
  autoFocusSearch = false,
}: EmojiPickerPanelProps) {
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  return (
    <EmojiPicker
      onEmojiClick={(d: EmojiClickData) => onPick(d.emoji)}
      emojiStyle={EmojiStyle.NATIVE}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      suggestedEmojisMode={SuggestionMode.RECENT}
      lazyLoadEmojis
      autoFocusSearch={autoFocusSearch}
      width={width}
      height={height}
      previewConfig={{ showPreview: false }}
      skinTonesDisabled={false}
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
