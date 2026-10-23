/**
 * Onboarding (Discord's member onboarding): a full-pane flow over the Space, one question per
 * page with option cards (pick one or several), required questions blocking Next, then a
 * Finish page that sends the picks (the server adds their roles and marks me onboarded).
 * "Skip" finishes early when no question is required. `OptionCard` / `PromptPage` are shared
 * with the settings preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, PartyPopper, X } from 'lucide-react';
import type { OnboardingOption, OnboardingPrompt, Space, SpaceOnboarding } from '@enbox/shared';
import { Button, IconButton, Portal, toast } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { submitOnboarding } from './api';
import { SpaceIcon } from './SpaceIcon';

export function OptionCard({
  option,
  selected,
  single,
  onToggle,
}: {
  option: Pick<OnboardingOption, 'title' | 'description' | 'emoji'>;
  selected: boolean;
  single: boolean;
  /** Absent in previews. */
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      role={single ? 'radio' : 'checkbox'}
      aria-checked={selected}
      onClick={onToggle}
      tabIndex={onToggle ? undefined : -1}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        selected ? 'border-brand bg-brand-soft' : 'border-transparent bg-surface-2 hover:bg-hover',
        !onToggle && 'pointer-events-none',
      )}
    >
      {option.emoji ? (
        <span className="shrink-0 text-[24px] leading-none" aria-hidden>
          {option.emoji}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-fg">{option.title || 'Option'}</span>
        {option.description ? (
          <span className="mt-0.5 block text-[13px] leading-snug break-words text-muted">{option.description}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center border-2',
          single ? 'rounded-full' : 'rounded-md',
          selected ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
        )}
      >
        {selected ? <Check size={12} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

export function PromptPage({
  prompt,
  picked,
  onToggle,
  headingId,
}: {
  prompt: OnboardingPrompt;
  picked: ReadonlySet<string>;
  onToggle?: (optionId: string) => void;
  headingId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 id={headingId} tabIndex={-1} className="text-[22px] leading-tight font-bold text-fg outline-none sm:text-[26px]">
          {prompt.title || 'Question'}
          {prompt.required ? (
            <span className="ml-1 text-danger" aria-hidden>
              *
            </span>
          ) : null}
        </h2>
        <p className="mt-1 text-[14px] text-muted">
          {prompt.singleSelect ? 'Pick one.' : 'Pick all that apply.'}
          {prompt.required ? ' An answer is required.' : ''}
        </p>
      </div>
      <div
        role={prompt.singleSelect ? 'radiogroup' : 'group'}
        aria-labelledby={headingId}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {prompt.options.map((o) => (
          <OptionCard
            key={o.id}
            option={o}
            single={prompt.singleSelect}
            selected={picked.has(o.id)}
            onToggle={onToggle ? () => onToggle(o.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/** Toggle an option: a single-select question keeps one pick. Pure. */
export function togglePick(
  picked: ReadonlySet<string>,
  prompt: OnboardingPrompt,
  optionId: string,
): Set<string> {
  const next = new Set(picked);
  if (next.has(optionId)) {
    next.delete(optionId);
    return next;
  }
  if (prompt.singleSelect) for (const o of prompt.options) next.delete(o.id);
  next.add(optionId);
  return next;
}

export function OnboardingFlow({
  space,
  onboarding,
  onDone,
  onExit,
  onStale,
}: {
  space: Space;
  onboarding: SpaceOnboarding;
  /** Finished (my Space is updated). */
  onDone: () => void;
  /** Left without finishing (it shows again next time). */
  onExit: () => void;
  /** The server refused the picks: the questions changed meanwhile. */
  onStale: () => void;
}) {
  const prompts = onboarding.prompts;
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const finish = step >= prompts.length;
  const prompt = finish ? null : prompts[step]!;
  const canSkip = useMemo(() => !prompts.some((p) => p.required), [prompts]);
  const answered = (p: OnboardingPrompt) => p.options.some((o) => picked.has(o.id));
  const blocked = !!prompt?.required && !answered(prompt);

  // Each page starts at its question (screen readers too).
  useEffect(() => {
    headingRef.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [step]);

  const submit = async () => {
    setBusy(true);
    try {
      await submitOnboarding(space.id, [...picked]);
      onDone();
    } catch (e) {
      toast.error(e);
      if (e instanceof ApiError && e.code === 'validation_error') onStale();
    } finally {
      setBusy(false);
    }
  };

  const picks = prompts.flatMap((p) => p.options.filter((o) => picked.has(o.id)));
  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`${space.name} onboarding`}
        className="fixed inset-0 z-40 flex flex-col bg-surface pt-[env(safe-area-inset-top)] lg:top-[var(--pane-gap)] lg:right-[var(--pane-gap)] lg:bottom-[var(--pane-gap)] lg:left-[calc(72px_+_2*var(--pane-gap))] lg:card-pane"
        data-testid="onboarding-flow"
      >
        <header className="flex shrink-0 items-center gap-3 px-4 py-3 lg:px-8 lg:py-5">
          <SpaceIcon name={space.name} iconUrl={space.iconUrl} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-fg">{space.name}</p>
            <p className="text-[12px] text-muted">
              {finish ? 'All set' : `Question ${step + 1} of ${prompts.length}`}
            </p>
          </div>
          <IconButton icon={X} label="Leave for now" variant="ghost" onClick={onExit} />
        </header>
        <div
          className="mx-4 h-1 shrink-0 overflow-hidden rounded-full bg-surface-2 lg:mx-8"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={0}
          aria-valuemax={prompts.length}
          aria-valuenow={Math.min(step, prompts.length)}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${(Math.min(step, prompts.length) / Math.max(1, prompts.length)) * 100}%` }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div ref={headingRef} className="mx-auto w-full max-w-2xl px-4 py-8 lg:py-12">
            {prompt ? (
              <PromptPage
                prompt={prompt}
                picked={picked}
                headingId="onboarding-question"
                onToggle={(id) => setPicked((cur) => togglePick(cur, prompt, id))}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink" aria-hidden>
                  <PartyPopper size={30} />
                </span>
                <h2 id="onboarding-question" tabIndex={-1} className="text-[24px] font-bold text-fg outline-none">
                  You’re all set!
                </h2>
                <p className="max-w-md text-[15px] text-muted">
                  {picks.length
                    ? `Your picks: ${picks.map((o) => o.title).join(', ')}. Finish to get the roles that come with them.`
                    : `Finish to start chatting in ${space.name}.`}
                </p>
              </div>
            )}
          </div>
        </div>
        <footer className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:px-8 lg:pb-6">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              Back
            </Button>
          ) : null}
          <div className="flex-1" />
          {canSkip && !finish ? (
            <Button variant="ghost" onClick={() => void submit()} disabled={busy}>
              Skip
            </Button>
          ) : null}
          {finish ? (
            <Button onClick={() => void submit()} loading={busy}>
              Finish
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)} disabled={blocked || busy}>
              Next
            </Button>
          )}
        </footer>
      </div>
    </Portal>
  );
}
