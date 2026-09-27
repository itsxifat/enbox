/**
 * Composer pieces (web composer/AttachMenu.tsx, VoiceRecorderBar.tsx, MentionSuggestions.tsx):
 * the WhatsApp-style attachment grid, the recording bar and the @mention list.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  BarChart3,
  Camera,
  ChevronLeft,
  FileText,
  Headphones,
  Image as ImageIcon,
  Lock,
  MapPin,
  Trash2,
  UserRound,
} from 'lucide-react-native';
import { formatDuration, userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { IconButton, Portal, Press, T, useBackHandler, usePresence } from '@/components/ui';
import { useTheme } from '@/theme';

const ITEMS = [
  { kind: 'document', label: 'Document', icon: FileText, color: '#7f66ff' },
  { kind: 'media', label: 'Photos & videos', icon: ImageIcon, color: '#007bfc' },
  { kind: 'camera', label: 'Camera', icon: Camera, color: '#ff2e74' },
  { kind: 'audio', label: 'Audio', icon: Headphones, color: '#fa6533' },
  { kind: 'location', label: 'Location', icon: MapPin, color: '#1fa855' },
  { kind: 'contact', label: 'Contact', icon: UserRound, color: '#009de2' },
  { kind: 'poll', label: 'Poll', icon: BarChart3, color: '#ffbc38' },
];

/** Attachment grid floating above the composer (`bottom` = distance from the screen bottom). */
export function AttachMenu({ open, bottom, onClose, onPick, hide = [] }) {
  const { tw, c, shadow } = useTheme();
  const [mounted, progress] = usePresence(open, { enter: 180, exit: 120 });
  useBackHandler(() => {
    onClose();
    return true;
  }, open);
  if (!mounted) return null;
  return (
    <Portal>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close attach menu"
      />
      <Animated.View
        accessibilityRole="menu"
        style={[
          tw`absolute right-3 rounded-2xl border border-line bg-elevated p-2`,
          shadow.elevated,
          {
            bottom,
            width: 320,
            maxWidth: '94%',
            opacity: progress,
            transform: [
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
            ],
          },
        ]}
      >
        <View style={tw`flex-row flex-wrap`}>
          {ITEMS.filter((i) => !hide.includes(i.kind)).map((item) => (
            <Press
              key={item.kind}
              accessibilityRole="menuitem"
              onPress={() => {
                onClose();
                onPick(item.kind);
              }}
              style={[tw`items-center gap-1.5 rounded-xl px-1 py-2`, { width: '25%' }]}
            >
              <View
                style={[
                  tw`size-11 items-center justify-center rounded-full`,
                  { backgroundColor: item.color },
                ]}
              >
                <Icon icon={item.icon} size={20} strokeWidth={ICON_STROKE_ON_FILL} color="#fff" />
              </View>
              <T style={[tw`text-center text-[12px]`, { color: c.fg }]}>{item.label}</T>
            </Press>
          ))}
        </View>
      </Animated.View>
    </Portal>
  );
}

function PulseDot() {
  const { tw } = useTheme();
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[tw`size-2.5 rounded-full bg-danger`, { opacity: v }]} />;
}

/** Recording UI shown in place of the text field while a voice note is being recorded. */
export function VoiceRecorderBar({ elapsedMs, levels, locked, onCancel }) {
  const { tw, c } = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Recording voice message, ${formatDuration(elapsedMs)}`}
      style={tw`min-h-12 flex-1 flex-row items-center gap-2 rounded-3xl bg-surface-2 px-2`}
    >
      {locked ? (
        <IconButton icon={Trash2} label="Delete recording" color={c.danger} onPress={onCancel} />
      ) : null}
      <View style={tw`flex-row items-center gap-2 pl-2`}>
        <PulseDot />
        <T style={[tw`text-[15px] font-medium`, { fontVariant: ['tabular-nums'] }]}>
          {formatDuration(elapsedMs)}
        </T>
      </View>
      {locked ? (
        <View
          style={[
            tw`h-8 min-w-0 flex-1 flex-row items-center justify-end overflow-hidden px-2`,
            { gap: 2 },
          ]}
        >
          {levels.map((v, i) => (
            <View
              key={i}
              style={{
                width: 3,
                borderRadius: 2,
                backgroundColor: c.muted,
                height: `${Math.max(10, Math.min(100, v * 100 + 8))}%`,
              }}
            />
          ))}
        </View>
      ) : (
        <View style={tw`flex-1 flex-row items-center justify-center gap-1`}>
          <Icon icon={ChevronLeft} size={16} color={c.muted} />
          <T style={tw`text-[14px] text-muted`}>Slide to cancel</T>
          <View style={tw`ml-3 flex-row items-center gap-1`}>
            <Icon icon={Lock} size={12} color={c.muted} />
            <T style={tw`text-[12px] text-muted`}>↑</T>
          </View>
        </View>
      )}
    </View>
  );
}

/** @mention suggestions above the composer (group members). */
export function MentionSuggestions({ users, onPick }) {
  const { tw, shadow } = useTheme();
  if (!users.length) return null;
  return (
    <View
      style={[
        tw`absolute inset-x-2 z-10 overflow-hidden rounded-2xl border border-line bg-elevated`,
        { bottom: '100%', marginBottom: 4 },
        shadow.elevated,
      ]}
    >
      <ScrollView
        style={{ maxHeight: 256 }}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={tw`py-1`}
      >
        {users.map((u) => (
          <Press
            key={u.id}
            onPress={() => onPick(u)}
            style={tw`flex-row items-center gap-3 px-3 py-2`}
          >
            <UserAvatar user={u} size="sm" />
            <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[15px]`}>
              {userDisplayName(u)}
            </T>
            <T style={tw`text-[13px] text-subtle`}>@{u.username}</T>
          </Press>
        ))}
      </ScrollView>
    </View>
  );
}
