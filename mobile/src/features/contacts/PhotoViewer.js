/**
 * Full-screen viewer for profile photos, banners and group icons (web
 * features/contacts/PhotoViewer.tsx): black backdrop, title bar with save/close, the
 * animated original when there is one. Tap outside the photo or press back to close.
 */
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, X } from 'lucide-react-native';
import { IconButton, Portal, T, usePresence, useBackHandler } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { saveToGallery } from '@/lib/files';
import { useUi } from '@/stores/ui';

export function PhotoViewer({ open, onClose, src, animatedSrc, title, subtitle, banner }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useUi((s) => s.prefs.reduceMotion === 'on');
  const [mounted, progress] = usePresence(open, { enter: 200, exit: 150 });
  useBackHandler(() => {
    onClose();
    return true;
  }, open);
  const original = mediaUrl(animatedSrc) ?? mediaUrl(src);
  const url = reduce ? (mediaUrl(src) ?? original) : original;
  if (!mounted || !url) return null;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  return (
    <Portal>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'rgba(0,0,0,0.92)', opacity: progress },
        ]}
      >
        <View
          style={{
            height: 64 + insets.top,
            paddingTop: insets.top,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 12,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
            <T numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              {title}
            </T>
            {subtitle ? (
              <T numberOfLines={1} style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                {subtitle}
              </T>
            ) : null}
          </View>
          <IconButton
            icon={Download}
            label="Save"
            color="rgba(255,255,255,0.85)"
            onPress={() => void saveToGallery(original, banner ? 'banner.jpg' : 'photo.jpg')}
          />
          <IconButton icon={X} label="Close" variant="glass" onPress={onClose} />
        </View>
        <Pressable
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            paddingBottom: Math.max(16, insets.bottom),
          }}
          onPress={onClose}
          accessibilityLabel="Close"
        >
          <Animated.View
            style={[
              { width: '100%', transform: [{ scale }] },
              banner
                ? { aspectRatio: 5 / 2, borderRadius: 12, overflow: 'hidden' }
                : { flex: 1, maxWidth: width },
            ]}
          >
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%' }}
              contentFit={banner ? 'cover' : 'contain'}
              accessibilityLabel={title}
            />
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Portal>
  );
}
