/**
 * Over a Space chat's limit (SPACE_MESSAGE_MAX_LENGTH) Enter doesn't send; this offers the
 * text as a `message.txt` upload instead (or asks to shorten it without ATTACH_FILES).
 */
import { FileText } from 'lucide-react';
import { SPACE_MESSAGE_MAX_LENGTH } from '@enbox/shared';
import { Button } from '@/components/ui';

export function TooLongPrompt({ canAttach, onSend }: { canAttach: boolean; onSend: () => void }) {
  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-3 animate-slide-down"
      role="status"
      data-testid="too-long"
    >
      <FileText size={16} className="shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-fg">
        Your message is too long.{' '}
        {canAttach
          ? 'Send it as a file?'
          : `Shorten it to ${SPACE_MESSAGE_MAX_LENGTH.toLocaleString()} characters to send it.`}
      </p>
      {canAttach ? (
        <Button size="sm" variant="soft" onClick={onSend}>
          Send as file
        </Button>
      ) : null}
    </div>
  );
}
