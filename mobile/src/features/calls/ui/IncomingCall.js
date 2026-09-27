/**
 * Incoming call UIs (web features/calls/ui/IncomingCall.tsx, phone form): the full-screen
 * ringing screen, the "silenced" card (unknown caller, no ringtone) and the call-waiting card
 * shown on top of an active call.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BellOff, X } from 'lucide-react-native';
import { chatTitle, userDisplayName } from '@enbox/shared';
import { Icon, PhoneIcon, PhoneOffIcon, VideoIcon } from '@/components/icons';
import { Portal, Press, T, useBackHandler } from '@/components/ui';
import { useCalls } from '@/stores/calls';
import { useTheme } from '@/theme';
import { CallAvatar, CallBackground, CallButton, HaloRings, PingRing } from './primitives';

function describe(p) {
  const video = p.call.type === 'video';
  const caller = userDisplayName(p.caller);
  const group = p.chat.type !== 'direct';
  return {
    video,
    caller,
    group,
    title: group ? chatTitle(p.chat) : caller,
    subtitle: group
      ? `${caller} · Group ${video ? 'video' : 'voice'} call`
      : `Enbox ${video ? 'video' : 'voice'} call`,
    avatar: group
      ? { src: p.chat.avatarUrl, name: chatTitle(p.chat), seed: p.chat.id }
      : { src: p.caller.avatarUrl, name: caller, seed: p.caller.id },
  };
}

const accept = () => void useCalls.getState().acceptIncoming();
const decline = () => useCalls.getState().declineIncoming();

/** The web's `call-bounce` keyframes on the Accept button. */
function useBounce() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return {
    transform: [
      {
        translateY: v.interpolate({
          inputRange: [0, 0.2, 0.4, 0.5, 0.6, 1],
          outputRange: [0, -6, 0, -3, 0, 0],
        }),
      },
      {
        scale: v.interpolate({
          inputRange: [0, 0.2, 0.4, 0.5, 0.6, 1],
          outputRange: [1, 1.04, 1, 1.02, 1, 1],
        }),
      },
    ],
  };
}

function useFadeIn() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [v]);
  return v;
}

export function IncomingCallScreen({ payload }) {
  const insets = useSafeAreaInsets();
  const d = describe(payload);
  const bounce = useBounce();
  const fade = useFadeIn();
  // Back declines nothing: it just keeps ringing (like a phone's call screen).
  useBackHandler(() => true, true);
  const KindIcon = d.video ? VideoIcon : PhoneIcon;
  return (
    <Portal>
      <Animated.View
        accessibilityViewIsModal
        accessibilityLabel={`Incoming ${d.video ? 'video' : 'voice'} call from ${d.title}`}
        style={[StyleSheet.absoluteFill, { opacity: fade }]}
      >
        <CallBackground />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            paddingHorizontal: 24,
            paddingTop: insets.top + 64,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon icon={KindIcon} size={16} color="rgba(255,255,255,0.7)" />
            <T style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{d.subtitle}</T>
          </View>
          <T
            numberOfLines={1}
            style={{
              marginTop: 8,
              fontSize: 30,
              lineHeight: 36,
              fontWeight: '600',
              color: '#fff',
              letterSpacing: -0.75,
            }}
          >
            {d.title}
          </T>
          <T style={{ marginTop: 4, fontSize: 15, color: 'rgba(255,255,255,0.7)' }}>
            Incoming call…
          </T>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View>
              <PingRing size={144} />
              <HaloRings size={144} />
              <CallAvatar
                src={d.avatar.src}
                name={d.avatar.name}
                seed={d.avatar.seed}
                group={d.group}
                size={144}
              />
            </View>
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-around',
            paddingHorizontal: 40,
            paddingTop: 24,
            paddingBottom: Math.max(48, insets.bottom + 32),
          }}
        >
          <CallButton
            icon={PhoneOffIcon}
            label="Decline"
            caption="Decline"
            tone="danger"
            size="xl"
            onPress={decline}
          />
          <CallButton
            icon={KindIcon}
            label="Accept"
            caption="Accept"
            tone="success"
            size="xl"
            onPress={accept}
            animatedStyle={bounce}
          />
        </View>
      </Animated.View>
    </Portal>
  );
}

/** Unknown caller while "Silence unknown callers" is on: no ringtone, answer if you like. */
export function SilencedCallCard({ payload }) {
  const { tw, c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const d = describe(payload);
  return (
    <Portal>
      <View
        pointerEvents="box-none"
        style={[tw`absolute inset-x-3 items-center`, { top: Math.max(12, insets.top) }]}
      >
        <View
          accessibilityRole="alert"
          style={[
            tw`w-full flex-row items-center gap-3 rounded-2xl border border-line bg-elevated p-3 pr-2`,
            { maxWidth: 448 },
            shadow.elevated,
          ]}
        >
          <CallAvatar
            src={d.avatar.src}
            name={d.avatar.name}
            seed={d.avatar.seed}
            group={d.group}
            size={44}
          />
          <View style={tw`min-w-0 flex-1`}>
            <T numberOfLines={1} style={tw`text-[15px] font-semibold`}>
              {d.title}
            </T>
            <View style={tw`flex-row items-center gap-1`}>
              <Icon icon={BellOff} size={14} color={c.muted} />
              <T numberOfLines={1} style={tw`text-[12.5px] text-muted`}>
                Silenced unknown caller
              </T>
            </View>
          </View>
          <Press
            onPress={accept}
            feedback={false}
            style={tw`h-9 justify-center rounded-full bg-success px-3.5`}
          >
            <T style={tw`text-[14px] font-semibold text-white`}>Answer</T>
          </Press>
          <Press
            accessibilityLabel="Dismiss"
            onPress={() => useCalls.getState().setIncoming(null)}
            style={tw`size-9 items-center justify-center rounded-full`}
          >
            <Icon icon={X} size={18} color={c.muted} />
          </Press>
        </View>
      </View>
    </Portal>
  );
}

/** Someone calls while I'm already in a call. */
export function CallWaitingCard({ payload }) {
  const insets = useSafeAreaInsets();
  const d = describe(payload);
  const [busy, setBusy] = useState(false);
  return (
    <Portal>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          top: insets.top + 72,
          alignItems: 'center',
        }}
      >
        <View
          accessibilityRole="alert"
          accessibilityLabel={`${d.title} is calling`}
          style={{
            width: '100%',
            maxWidth: 448,
            gap: 12,
            borderRadius: 16,
            padding: 12,
            backgroundColor: 'rgba(40,36,70,0.92)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
            boxShadow: '0px 25px 50px -12px rgba(0,0,0,0.5)',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <CallAvatar
              src={d.avatar.src}
              name={d.avatar.name}
              seed={d.avatar.seed}
              group={d.group}
              size={40}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>
                {d.title}
              </T>
              <T numberOfLines={1} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>
                {d.subtitle}
              </T>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Press
              onPress={decline}
              feedback={false}
              style={({ pressed }) => ({
                flex: 1,
                height: 36,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? '#dc2626' : '#ef4444',
              })}
            >
              <T style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Decline</T>
            </Press>
            <Press
              disabled={busy}
              onPress={() => {
                setBusy(true);
                accept();
              }}
              feedback={false}
              style={({ pressed }) => ({
                flex: 1,
                height: 36,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? '#16a34a' : '#22c55e',
                opacity: busy ? 0.6 : 1,
              })}
            >
              <T style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>End & accept</T>
            </Press>
          </View>
        </View>
      </View>
    </Portal>
  );
}
