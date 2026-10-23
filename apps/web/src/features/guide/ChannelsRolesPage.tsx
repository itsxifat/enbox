/**
 * /spaces/:spaceId/channels-roles — Channels & Roles (Discord): the Space's onboarding
 * questions with my answers as chips I can change. Saving sends all of them; the server adds
 * the roles of what I pick and removes those of what I unpicked (modules/guide), so channels
 * open and close with them.
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { Check, ListChecks } from 'lucide-react';
import type { OnboardingAnswers, OnboardingPrompt, SpaceCommunity } from '@enbox/shared';
import { EmptyState, PageSpinner, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSpace, useSpaces } from '@/stores/spaces';
import { getCommunity, onboardingActive } from '@/features/spaces/community/api';
import { togglePick } from '@/features/spaces/community/OnboardingFlow';
import { UnsavedBar } from '@/features/spaces/community/settings/shared';
import { changeAnswers, normalizeAnswers } from './actions';
import { GuidePane } from './parts';

/** The picks of answers as one set (option ids are unique across questions). Pure. */
const pickedOf = (answers: OnboardingAnswers) => new Set(Object.values(answers).flat());

/** Back to answers: each question → its picked options. Pure. */
function answersFrom(
  prompts: readonly OnboardingPrompt[],
  picked: ReadonlySet<string>,
): OnboardingAnswers {
  return normalizeAnswers(
    prompts,
    Object.fromEntries(
      prompts.map((p) => [p.id, p.options.map((o) => o.id).filter((id) => picked.has(id))]),
    ),
  );
}

/** Why the picks cannot be saved (null = fine). Pure. */
export function answersProblem(
  prompts: readonly OnboardingPrompt[],
  picked: ReadonlySet<string>,
): string | null {
  const missing = prompts.find((p) => p.required && !p.options.some((o) => picked.has(o.id)));
  return missing ? `Answer “${missing.title}”` : null;
}

function Chip({
  title,
  emoji,
  description,
  selected,
  single,
  onToggle,
}: {
  title: string;
  emoji: string | null;
  description: string | null;
  selected: boolean;
  single: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role={single ? 'radio' : 'checkbox'}
      aria-checked={selected}
      title={description ?? undefined}
      onClick={onToggle}
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-[14px] font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        selected
          ? 'border-brand bg-brand-soft text-fg'
          : 'border-transparent bg-surface-2 text-muted hover:bg-hover hover:text-fg',
      )}
    >
      {emoji ? (
        <span className="text-[16px] leading-none" aria-hidden>
          {emoji}
        </span>
      ) : null}
      <span className="truncate">{title}</span>
      {selected ? (
        <Check size={14} strokeWidth={3} className="shrink-0 text-brand-ink" aria-hidden />
      ) : null}
    </button>
  );
}

export function ChannelsRolesPage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const space = useSpace(spaceId);
  const loaded = useSpaces((s) => s.loaded);
  const [community, setCommunity] = useState<{ spaceId: string; data: SpaceCommunity } | null>(
    null,
  );
  const [loadError, setLoadError] = useState<{ spaceId: string; message: string } | null>(null);
  /** My picks while I change them (none: the saved ones). */
  const [changed, setChanged] = useState<{ spaceId: string; picks: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    let live = true;
    // Fresh questions: the answers are checked against them.
    getCommunity(spaceId, { force: true })
      .then((data) => live && setCommunity({ spaceId, data }))
      .catch(
        (e: unknown) =>
          live &&
          setLoadError({ spaceId, message: errorMessage(e, 'Could not load the questions') }),
      );
    return () => {
      live = false;
    };
  }, [spaceId]);

  const onboarding =
    community && community.spaceId === spaceId ? community.data.onboarding : undefined;
  const prompts = useMemo(
    () => (onboardingActive(onboarding) ? onboarding.prompts : []),
    [onboarding],
  );
  const saved = space?.me.onboardingAnswers;
  const savedPicks = useMemo(
    () => pickedOf(normalizeAnswers(prompts, saved ?? {})),
    [prompts, saved],
  );

  if (!space) return loaded ? <Navigate to="/spaces" replace /> : <PageSpinner />;
  const draft = changed?.spaceId === space.id ? changed.picks : null;
  const setDraft = (picks: Set<string> | null) =>
    setChanged(picks ? { spaceId: space.id, picks } : null);
  const picked = draft ?? savedPicks;
  const error = loadError?.spaceId === space.id ? loadError.message : null;
  const dirty =
    !!draft &&
    JSON.stringify(answersFrom(prompts, draft)) !==
      JSON.stringify(answersFrom(prompts, savedPicks));
  const problem = answersProblem(prompts, picked);

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await changeAnswers(space.id, prompts, answersFrom(prompts, draft));
      setDraft(null);
      toast.success('Your roles were updated');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (error) body = <p className="text-danger">{error}</p>;
  else if (!community || community.spaceId !== space.id) body = <PageSpinner />;
  else if (!prompts.length)
    body = (
      <EmptyState
        icon={ListChecks}
        title="No questions here"
        description="This Space has no onboarding questions to pick roles and channels with."
      />
    );
  else
    body = (
      <>
        <p className="text-[15px] text-muted">
          Your answers decide your roles in {space.name}, and the channels that come with them.
          Change them any time.
        </p>
        {prompts.map((p) => (
          <section
            key={p.id}
            aria-labelledby={`prompt-${p.id}`}
            className="flex flex-col gap-3"
            data-testid="channels-roles-prompt"
          >
            <div>
              <h3 id={`prompt-${p.id}`} className="text-[17px] font-bold text-fg">
                {p.title}
                {p.required ? (
                  <span className="ml-1 text-danger" aria-hidden>
                    *
                  </span>
                ) : null}
              </h3>
              <p className="text-[13px] text-muted">
                {p.singleSelect ? 'Pick one.' : 'Pick all that apply.'}
                {p.required ? ' An answer is required.' : ''}
              </p>
            </div>
            <div
              role={p.singleSelect ? 'radiogroup' : 'group'}
              aria-labelledby={`prompt-${p.id}`}
              className="flex flex-wrap gap-2"
            >
              {p.options.map((o) => (
                <Chip
                  key={o.id}
                  title={o.title}
                  emoji={o.emoji}
                  description={o.description}
                  single={p.singleSelect}
                  selected={picked.has(o.id)}
                  onToggle={() => setDraft(togglePick(picked, p, o.id))}
                />
              ))}
            </div>
          </section>
        ))}
        <UnsavedBar
          editor={{ dirty, busy, save, reset: () => setDraft(null) }}
          problem={dirty ? problem : null}
        />
      </>
    );

  return (
    <GuidePane space={space} title="Channels & Roles" icon={ListChecks} testId="channels-roles">
      {body}
    </GuidePane>
  );
}
