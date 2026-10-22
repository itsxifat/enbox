/**
 * Embed card for the first link of a text message (web bubbles/LinkPreviewCard.tsx):
 * accent bar in the site's theme colour, site, title, description, then a wide image below
 * or a square one beside. Renders nothing while loading, for links without a preview and
 * when the device pref `linkPreviews` is off (Settings → Chats).
 */
import { memo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Press, T } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { openUrl } from '@/lib/links';
import { useUi } from '@/stores/ui';
import { alpha, useTheme } from '@/theme';
import { previewLink, useLinkPreview } from '../lib/linkPreview';

/** A theme colour that shows on both light and dark bubbles, else null (brand colour). */
function accentOf(hex) {
  const m = hex ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null;
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = Number.parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.7 || luminance < 0.02 ? null : hex;
}

/** Wide images go full width under the text; small or squarish ones become a thumbnail. */
function isWide(image) {
  return image.width >= 400 && image.width / image.height >= 1.25;
}

function Card({ preview, width, style }) {
  const { tw, c, dark } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const image = imageFailed ? null : preview.image;
  const wide = image ? isWide(image) : false;
  // Card width minus the accent bar and the horizontal padding.
  const inner = width - 4 - 20;
  const img = image ? (
    <Image
      source={{ uri: mediaUrl(image.url) }}
      contentFit="cover"
      transition={150}
      recyclingKey={image.url}
      onError={() => setImageFailed(true)}
      style={[
        { borderRadius: 6, backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
        wide
          ? {
              marginTop: 8,
              width: inner,
              height: Math.min(224, Math.round((inner * image.height) / image.width)),
            }
          : { width: 64, height: 64 },
      ]}
    />
  ) : null;
  return (
    <Press
      onPress={() => openUrl(preview.url)}
      accessibilityRole="link"
      accessibilityLabel={preview.title ?? preview.domain}
      pressedStyle={{ backgroundColor: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)' }}
      style={[
        {
          width,
          marginTop: 6,
          borderRadius: 6,
          borderLeftWidth: 4,
          borderLeftColor: accentOf(preview.themeColor) ?? c.brand,
          backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
        style,
      ]}
    >
      <View style={tw`flex-row gap-2.5`}>
        <View style={tw`min-w-0 flex-1`}>
          <T numberOfLines={1} style={tw`text-[12px] text-muted`}>
            {preview.siteName ?? preview.domain}
          </T>
          {preview.title ? (
            <T
              numberOfLines={2}
              style={[tw`mt-0.5 text-[14px] font-semibold text-brand-ink`, { lineHeight: 19 }]}
            >
              {preview.title}
            </T>
          ) : null}
          {preview.description ? (
            <T
              numberOfLines={3}
              style={[tw`mt-0.5 text-[13px]`, { lineHeight: 18, color: alpha(c.fg, 0.8) }]}
            >
              {preview.description}
            </T>
          ) : null}
        </View>
        {img && !wide ? img : null}
      </View>
      {img && wide ? img : null}
    </Press>
  );
}

/**
 * The card for the first previewable link in `text`, when link previews are on. `maxWidth`
 * is the bubble's content width; `style` adds spacing (e.g. room for the corner meta).
 */
export const LinkPreviewCard = memo(function LinkPreviewCard({ text, maxWidth, style }) {
  const enabled = useUi((s) => s.prefs.linkPreviews);
  const { width: screen } = useWindowDimensions();
  const url = enabled ? previewLink(text) : null;
  const preview = useLinkPreview(url);
  if (!preview) return null;
  const width = Math.min(320, Math.round(screen * 0.68), maxWidth ? maxWidth - 12 : Infinity);
  return <Card preview={preview} width={width} style={style} />;
});
