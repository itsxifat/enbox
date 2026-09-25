/** Lazy-loaded emoji picker (native emoji, theme-aware) for the status composer. */
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { useUi } from '@/stores/ui';

export function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  return (
    <div className="overflow-hidden rounded-2xl shadow-elevated">
      <EmojiPicker
        onEmojiClick={(e) => onPick(e.emoji)}
        emojiStyle={EmojiStyle.NATIVE}
        theme={dark ? Theme.DARK : Theme.LIGHT}
        lazyLoadEmojis
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        width={320}
        height={380}
      />
    </div>
  );
}
