/**
 * The report dialog for `openReport(target)`, mounted once in AppShell. The dialog itself is
 * loaded on first use; a new target starts the flow over.
 */
import { Suspense } from 'react';
import { lazyNamed } from '@/lib/lazy';
import { useReport } from './report';

const ReportDialog = lazyNamed(() => import('./ReportDialog'), 'ReportDialog');

export function ReportDialogHost() {
  const target = useReport((s) => s.target);
  const close = useReport((s) => s.close);
  if (!target) return null;
  return (
    <Suspense fallback={null}>
      <ReportDialog
        key={`${target.targetType}:${target.targetId}`}
        target={target}
        onClose={close}
      />
    </Suspense>
  );
}
