import { AlertCircle, Check, CheckCheck, Clock3 } from 'lucide-react';
import type { TickStatus } from '@enbox/shared';
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
  const common = { size, strokeWidth: 2.2, 'aria-hidden': true as const };
  return (
    <span
      role="img"
      aria-label={LABELS[status]}
      data-status={status}
      className={cn(
        'inline-flex shrink-0 items-center',
        status === 'read' && 'text-tick-read',
        status === 'failed' && 'text-danger',
        className,
      )}
    >
      {status === 'pending' ? (
        <Clock3 {...common} size={size - 3} />
      ) : status === 'sent' ? (
        <Check {...common} />
      ) : status === 'failed' ? (
        <AlertCircle {...common} size={size - 2} />
      ) : (
        <CheckCheck {...common} />
      )}
    </span>
  );
}
