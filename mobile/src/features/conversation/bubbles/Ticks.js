import { View } from 'react-native';
import { AlertCircle, Clock3 } from 'lucide-react-native';
import { DoubleTickIcon, Icon, TickIcon } from '@/components/icons';
import { useTheme } from '@/theme';

const LABELS = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

/** Message status: clock (pending), ✓ sent, ✓✓ delivered, blue ✓✓ read, ! failed. */
export function Ticks({ status, size = 16, color, readColor, style }) {
  const { c } = useTheme();
  const fg =
    status === 'read' ? (readColor ?? c['tick-read']) : status === 'failed' ? c.danger : color;
  return (
    <View
      accessibilityLabel={LABELS[status]}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Icon
        icon={
          status === 'pending'
            ? Clock3
            : status === 'sent'
              ? TickIcon
              : status === 'failed'
                ? AlertCircle
                : DoubleTickIcon
        }
        size={status === 'pending' ? size - 4 : status === 'failed' ? size - 2 : size}
        color={fg}
      />
    </View>
  );
}
