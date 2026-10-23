import { Copy, Download } from 'lucide-react';
import { Button, toast } from '@/components/ui';
import { copyText } from '@/features/groups/shared/share';
import { backupCodesText, downloadText } from './twoFactorApi';

/**
 * A fresh set of backup codes (shown once): the grid, Copy, Download as .txt and, with
 * `onDone`, the button that closes the step ("I've saved them").
 */
export function BackupCodesList({
  codes,
  username,
  onDone,
  doneLabel = "I've saved them",
}: {
  codes: string[];
  username: string;
  onDone?: () => void;
  doneLabel?: string;
}) {
  const copy = async () => {
    if (await copyText(codes.join('\n'))) toast.success('Backup codes copied');
    else toast.error("Couldn't copy. Select the codes and copy them manually.");
  };

  return (
    <div className="flex flex-col gap-4">
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-surface p-4 font-mono text-[15px] text-fg sm:px-6"
      >
        {codes.map((code) => (
          <li key={code} className="select-all py-0.5 text-center tracking-wide">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" leftIcon={Copy} onClick={() => void copy()}>
          Copy
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={Download}
          onClick={() => downloadText('enbox-backup-codes.txt', backupCodesText(codes, username))}
        >
          Download
        </Button>
        {onDone ? (
          <Button className="ml-auto" onClick={onDone}>
            {doneLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
