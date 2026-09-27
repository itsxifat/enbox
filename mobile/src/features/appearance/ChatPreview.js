/**
 * A miniature conversation rendered with a resolved appearance (Settings → Chats and the
 * ChatThemeSheet; web ChatPreview.tsx): the same wallpaper layer and bubble colours real
 * rows use, so what you see is what the chat gets.
 */
import { View } from 'react-native';
import { DoubleTickIcon } from '@/components/icons';
import { T } from '@/components/ui';
import { ColorScope, useTheme } from '@/theme';
import { ChatBackground } from './ChatBackground';

function Bubbles({ appearance }) {
  const { tw, c, shadow, chatFontSize } = useTheme();
  const cozy = appearance.bubbleStyle === 'cozy';
  const radius =
    appearance.bubbleStyle === 'rounded' ? 18 : appearance.bubbleStyle === 'minimal' ? 10 : 8;
  const tail = appearance.bubbleStyle === 'classic' || cozy;
  const text = { fontSize: chatFontSize, lineHeight: chatFontSize * 1.375 };
  return (
    <View style={tw`gap-1.5 p-4`}>
      <View
        style={[
          tw`self-start bg-bubble-in px-3 py-1.5`,
          { maxWidth: cozy ? '100%' : '78%', borderRadius: radius },
          tail ? { borderTopLeftRadius: 0 } : null,
          shadow.bubble,
        ]}
      >
        <T style={text}>
          {cozy ? <T style={tw`text-[12px] font-semibold text-brand-ink`}>Sam </T> : null}
          Did you see the new themes?
          <T style={[tw`text-[11px]`, { color: c['bubble-in-meta'] }]}>{'  '}10:41</T>
        </T>
      </View>
      <View
        style={[
          tw`bg-bubble-out px-3 py-1.5`,
          cozy ? tw`self-start` : tw`self-end`,
          { maxWidth: cozy ? '100%' : '78%', borderRadius: radius },
          tail ? (cozy ? { borderTopLeftRadius: 0 } : { borderTopRightRadius: 0 }) : null,
          shadow.bubble,
        ]}
      >
        <View style={tw`flex-row flex-wrap items-end`}>
          <T style={text}>
            {cozy ? <T style={tw`text-[12px] font-semibold text-brand-ink`}>You </T> : null}
            Yes! This one looks great
          </T>
          <View style={tw`ml-2 flex-row items-center gap-0.5 pb-0.5`}>
            <T style={[tw`text-[11px]`, { color: c['bubble-out-meta'] }]}>10:42</T>
            <DoubleTickIcon size={14} color={c['tick-read']} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function ChatPreview({ appearance, style }) {
  const { tw } = useTheme();
  return (
    <ColorScope overrides={appearance.colors}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[tw`relative min-h-28 overflow-hidden rounded-2xl`, style]}
      >
        <ChatBackground appearance={appearance} />
        <Bubbles appearance={appearance} />
      </View>
    </ColorScope>
  );
}
