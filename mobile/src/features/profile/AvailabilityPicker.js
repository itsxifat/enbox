/**
 * My availability (web features/profile/AvailabilityPicker.tsx): Online / Idle / Do not
 * disturb / Invisible, the last three for a duration → PUT /api/me/presence.
 */
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { effectiveAvailability } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Menu, Press, Spinner, T, measureAnchor, toast } from '@/components/ui';
import { formatShortDate, formatTime, isSameLocalDay } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useTheme } from '@/theme';
import { AVAILABILITY_DURATIONS, expiryFor, setAvailability } from './presenceApi';

export const AVAILABILITY_LABELS = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  invisible: 'Invisible',
};

const DESCRIPTIONS = {
  online: 'People see you as online',
  idle: 'Shown as away',
  dnd: 'No sounds, notifications or ringtones',
  invisible: 'You appear offline',
};

const CHOICES = ['online', 'idle', 'dnd', 'invisible'];

/** Coloured dot matching the avatar badge: green / amber / red / hollow (invisible). */
export function AvailabilityDot({ availability, size = 10 }) {
  const { c } = useTheme();
  const bg =
    availability === 'online'
      ? c.online
      : availability === 'idle'
        ? c.warning
        : availability === 'dnd'
          ? c.danger
          : 'transparent';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: bg,
        borderWidth: availability === 'invisible' ? 2 : 0,
        borderColor: c['line-strong'],
      }}
    />
  );
}

function untilLabel(iso) {
  const d = new Date(iso);
  return isSameLocalDay(d, new Date())
    ? `Until ${formatTime(d)}`
    : `Until ${formatShortDate(d)} ${formatTime(d)}`;
}

export function AvailabilityPicker({ style }) {
  const { tw, c } = useTheme();
  const me = useMe();
  const ref = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const current = effectiveAvailability(me);
  const until = current !== 'online' ? me.availabilityUntil : null;

  const apply = async (availability, untilIso) => {
    setBusy(true);
    try {
      await setAvailability(availability, untilIso);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const stateItems = CHOICES.map((a) => ({
    label: (
      <View style={tw`flex-row items-center gap-3 py-0.5`}>
        <AvailabilityDot availability={a} size={12} />
        <View style={tw`min-w-0 flex-1`}>
          <T style={tw`text-[14.5px] font-medium leading-tight`}>{AVAILABILITY_LABELS[a]}</T>
          <T style={tw`text-[12px] leading-tight text-muted`}>{DESCRIPTIONS[a]}</T>
        </View>
      </View>
    ),
    onSelect: () => (a === 'online' ? void apply('online', null) : setPending(a)),
  }));
  const durationItems = AVAILABILITY_DURATIONS.map((d) => ({
    label: d.label,
    onSelect: () => {
      const a = pending;
      setPending(null);
      if (a) void apply(a, expiryFor(d.value));
    },
  }));

  return (
    <View style={style}>
      <Press
        ref={ref}
        accessibilityLabel={`Availability: ${AVAILABILITY_LABELS[current]}`}
        disabled={busy}
        onPress={async () => {
          const a = await measureAnchor(ref);
          if (a) setAnchor(a);
          setMenuOpen(true);
        }}
        style={[
          tw`min-h-11 flex-row items-center gap-3 rounded-xl bg-surface-2 px-3 py-1.5`,
          busy ? { opacity: 0.6 } : null,
        ]}
      >
        <AvailabilityDot availability={current} />
        <View style={tw`min-w-0 flex-1`}>
          <T style={tw`text-[14.5px] font-medium leading-tight`}>{AVAILABILITY_LABELS[current]}</T>
          <T style={tw`text-[12px] text-muted`}>
            {until ? untilLabel(until) : DESCRIPTIONS[current]}
          </T>
        </View>
        {busy ? <Spinner size={14} /> : <Icon icon={ChevronDown} size={16} color={c.subtle} />}
      </Press>
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={anchor}
        items={stateItems}
        align="start"
      />
      <Menu
        open={!!pending}
        onClose={() => setPending(null)}
        anchor={anchor}
        items={durationItems}
        align="start"
      />
    </View>
  );
}
