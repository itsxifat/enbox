import { AlertCircle, Clock3 } from 'lucide-react';
import type { TickStatus } from '@enbox/shared';
import { DoubleTickIcon, TickIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

const LABELS: Record<TickStatus | 'failed', string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

/** Message status: clock (pending), ✓ sent, ✓✓ delivered, blue ✓✓ read, ! failed. */
export function Ticks({
  status,
  size = 16,
  className,
}: {
  status: TickStatus | 'failed';
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={LABELS[status]}
      data-status={status}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        status === 'read' && 'text-tick-read',
        status === 'failed' && 'text-danger',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {status === 'pending' ? (
        <Clock3 size={size - 4} aria-hidden />
      ) : status === 'sent' ? (
        <TickIcon size={size} aria-hidden />
      ) : status === 'failed' ? (
        <AlertCircle size={size - 2} aria-hidden />
      ) : (
        <DoubleTickIcon size={size} aria-hidden />
      )}
    </span>
  );
}
