/**
 * The stepped report flow (`openReport(target)`): what's wrong (a category, with a line on
 * each) → optional details and "Also block" when the report is about someone → sent: "Thanks
 * for letting us know". One dialog throughout; the reporter is never shown to reviewers.
 */
import { useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  REPORT_CATEGORIES,
  userDisplayName,
  type CreateReportRequest,
  type ReportCategory,
} from '@enbox/shared';
import { Button, Checkbox, Modal, RadioGroup, Textarea, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { useContacts } from '@/stores/contacts';
import { useUser } from '@/stores/users';
import { CATEGORY_INFO, TARGET_NOUN } from './categories';
import type { ReportTargetInfo } from './report';

const DETAILS_MAX = 1000;

type Step = 'category' | 'details' | 'done';

export function ReportDialog({
  target,
  onClose,
}: {
  target: ReportTargetInfo;
  onClose: () => void;
}) {
  const me = useMe();
  const user = useUser(target.userId);
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const name = user && !user.isDeleted ? userDisplayName(user) : target.label;
  const canBlock =
    !!target.userId && target.userId !== me?.id && !user?.isBlocked && !user?.isDeleted;
  const subject = target.targetType === 'message' ? `Message from ${target.label}` : target.label;

  const submit = async () => {
    if (!category) return;
    setBusy(true);
    const body: CreateReportRequest = {
      targetType: target.targetType,
      targetId: target.targetId,
      category,
      ...(details.trim() ? { details: details.trim() } : {}),
      ...(canBlock && alsoBlock ? { alsoBlock: true } : {}),
    };
    try {
      await api.post<{ id: string }>('/api/reports', body);
      if (body.alsoBlock) {
        setBlocked(true);
        // The server blocked them (its blocks:changed reaches my other devices too).
        void useContacts
          .getState()
          .syncBlocks()
          .catch(() => undefined);
      }
      setStep('done');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  let title: string;
  let description: string | undefined;
  let body: ReactNode;
  let footer: ReactNode;
  if (step === 'category') {
    title = `Report ${TARGET_NOUN[target.targetType]}`;
    description = subject;
    body = (
      <>
        <h3 className="mb-1 text-[15px] font-semibold text-fg">What’s wrong?</h3>
        <RadioGroup<ReportCategory | ''>
          aria-label="What’s wrong?"
          value={category}
          onChange={setCategory}
          options={REPORT_CATEGORIES.map((c) => ({
            value: c,
            label: CATEGORY_INFO[c].label,
            description: CATEGORY_INFO[c].description,
          }))}
        />
      </>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!category} onClick={() => setStep('details')}>
          Next
        </Button>
      </>
    );
  } else if (step === 'details') {
    title = `Report ${TARGET_NOUN[target.targetType]}`;
    description = subject;
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-[14px] text-muted">
          <span className="font-semibold text-fg">{category && CATEGORY_INFO[category].label}</span>
          {' · '}Anything else we should know?
        </p>
        <Textarea
          label="Details (optional)"
          value={details}
          maxLength={DETAILS_MAX}
          rows={4}
          autoResize
          onChange={(e) => setDetails(e.target.value)}
          aside={
            <span className="text-[12px] text-subtle">
              {details.length}/{DETAILS_MAX}
            </span>
          }
        />
        {canBlock ? (
          <Checkbox
            checked={alsoBlock}
            onChange={setAlsoBlock}
            label={`Also block ${name}`}
            description="They won’t be able to message or call you."
          />
        ) : null}
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep('category')} disabled={busy}>
          Back
        </Button>
        <Button variant="danger" loading={busy} onClick={() => void submit()}>
          Submit Report
        </Button>
      </>
    );
  } else {
    title = 'Thanks for letting us know';
    body = (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <ShieldCheck size={28} aria-hidden />
        </span>
        <p className="text-[14.5px] text-muted">
          We’ll review your report. Whoever you reported won’t know it was you.
        </p>
        {blocked ? <p className="text-[14px] text-fg">You blocked {name}.</p> : null}
      </div>
    );
    footer = <Button onClick={onClose}>Done</Button>;
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={footer}
      size={step === 'done' ? 'sm' : 'md'}
      dismissible={!busy}
    >
      {body}
    </Modal>
  );
}
