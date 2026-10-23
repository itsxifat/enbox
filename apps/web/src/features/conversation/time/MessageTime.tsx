/**
 * A message's time as a `<time>`: the header form ("Today at 3:14 PM") or the short one
 * ("3:14 PM", beside the later messages of a group), the full date in its tooltip.
 */
import { formatTime } from '@/lib/format';
import { formatFullMessageTime, formatMessageTime } from './timeFormat';

export function MessageTime({
  at,
  short = false,
  className,
  'aria-hidden': ariaHidden,
}: {
  /** ISO date. */
  at: string;
  short?: boolean;
  className?: string;
  'aria-hidden'?: boolean;
}) {
  return (
    <time dateTime={at} title={formatFullMessageTime(at)} className={className} aria-hidden={ariaHidden}>
      {short ? formatTime(at) : formatMessageTime(at)}
    </time>
  );
}
