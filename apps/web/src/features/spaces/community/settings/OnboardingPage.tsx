/**
 * Space Settings → Onboarding (MANAGE_SPACE; handing out roles also needs MANAGE_ROLES): the
 * questions new members answer when they join — one per page, pick one or several, optionally
 * required — whose options hand out roles (below my highest role), with a live preview.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type {
  ID,
  Space,
  SpaceCommunity,
  SpaceOnboarding,
  UpdateSpaceCommunityRequest,
} from '@enbox/shared';
import { Button, Input, Switch } from '@/components/ui';
import { PromptPage, togglePick } from '../OnboardingFlow';
import {
  EditorLoading,
  EmojiButton,
  RolePicker,
  RowActions,
  Section,
  UnsavedBar,
  moveItem,
  shortId,
  useCommunityEditor,
} from './shared';

export const MAX_PROMPTS = 15;
export const MAX_OPTIONS = 20;

export interface OptionDraft {
  id: string;
  title: string;
  description: string;
  emoji: string | null;
  roleIds: ID[];
}
export interface PromptDraft {
  id: string;
  title: string;
  singleSelect: boolean;
  required: boolean;
  options: OptionDraft[];
}
export interface OnboardingDraft {
  enabled: boolean;
  prompts: PromptDraft[];
}

export function onboardingDraftOf(c: SpaceCommunity): OnboardingDraft {
  const o = c.onboarding;
  return {
    enabled: o?.enabled ?? false,
    prompts: (o?.prompts ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      singleSelect: p.singleSelect,
      required: p.required,
      options: p.options.map((x) => ({
        id: x.id,
        title: x.title,
        description: x.description ?? '',
        emoji: x.emoji,
        roleIds: [...x.roleIds],
      })),
    })),
  };
}

/** The draft as the server stores it (trimmed; empty description = null). Pure. */
export function onboardingOf(d: OnboardingDraft): SpaceOnboarding {
  return {
    enabled: d.enabled,
    prompts: d.prompts.map((p) => ({
      id: p.id,
      title: p.title.trim(),
      singleSelect: p.singleSelect,
      required: p.required,
      options: p.options.map((x) => ({
        id: x.id,
        title: x.title.trim(),
        description: x.description.trim() || null,
        emoji: x.emoji || null,
        roleIds: x.roleIds,
      })),
    })),
  };
}

/** The PATCH body: all of onboarding when anything changed (compared in one shape). Pure. */
export function onboardingBody(c: SpaceCommunity, d: OnboardingDraft): UpdateSpaceCommunityRequest {
  const next = onboardingOf(d);
  return JSON.stringify(next) === JSON.stringify(onboardingOf(onboardingDraftOf(c))) ? {} : { onboarding: next };
}

/** Why the draft cannot be saved (null = fine). Pure. */
export function onboardingProblem(d: OnboardingDraft): string | null {
  if (d.enabled && d.prompts.length === 0) return 'Add a question to turn onboarding on';
  if (d.prompts.some((p) => !p.title.trim())) return 'Give every question a title';
  if (d.prompts.some((p) => p.options.length === 0)) return 'Give every question at least one option';
  if (d.prompts.some((p) => p.options.some((o) => !o.title.trim()))) return 'Give every option a title';
  return null;
}

const newOption = (): OptionDraft => ({ id: shortId('o'), title: '', description: '', emoji: null, roleIds: [] });
const newPrompt = (): PromptDraft => ({
  id: shortId('p'),
  title: '',
  singleSelect: false,
  required: false,
  options: [newOption()],
});

function OptionEditor({
  space,
  option,
  label,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  space: Space;
  option: OptionDraft;
  label: string;
  index: number;
  count: number;
  onChange: (patch: Partial<OptionDraft>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-surface p-3" data-testid="onboarding-option">
      <div className="flex items-center gap-2">
        <EmojiButton value={option.emoji} onChange={(emoji) => onChange({ emoji })} label={`${label} emoji`} />
        <Input
          aria-label={`${label} title`}
          placeholder="Title"
          maxLength={50}
          value={option.title}
          onChange={(e) => onChange({ title: e.target.value })}
          containerClassName="min-w-0 flex-1"
        />
        <RowActions index={index} count={count} what="option" onMove={onMove} onRemove={onRemove} />
      </div>
      <Input
        aria-label={`${label} description`}
        placeholder="Description (optional)"
        maxLength={100}
        value={option.description}
        onChange={(e) => onChange({ description: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-muted">Roles</span>
        <RolePicker space={space} value={option.roleIds} onChange={(roleIds) => onChange({ roleIds })} />
      </div>
    </li>
  );
}

function PromptEditor({
  space,
  prompt,
  index,
  count,
  open,
  onToggleOpen,
  onChange,
  onMove,
  onRemove,
}: {
  space: Space;
  prompt: PromptDraft;
  index: number;
  count: number;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (update: (p: PromptDraft) => PromptDraft) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const label = `Question ${index + 1}`;
  const setOptions = (update: (list: OptionDraft[]) => OptionDraft[]) => onChange((p) => ({ ...p, options: update(p.options) }));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="card-inset flex flex-col gap-3 p-3" data-testid="onboarding-prompt">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Chevron size={18} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{prompt.title.trim() || 'Untitled question'}</span>
            <span className="block text-[12px] text-muted">
              {prompt.singleSelect ? 'Pick one' : 'Pick several'} · {prompt.required ? 'Required' : 'Optional'} ·{' '}
              {prompt.options.length} {prompt.options.length === 1 ? 'option' : 'options'}
            </span>
          </span>
        </button>
        <RowActions index={index} count={count} what="question" onMove={onMove} onRemove={onRemove} />
      </div>
      {open ? (
        <div className="flex flex-col gap-3">
          <Input
            aria-label={label}
            placeholder="What do you want to ask?"
            maxLength={100}
            value={prompt.title}
            onChange={(e) => onChange((p) => ({ ...p, title: e.target.value }))}
          />
          <div className="flex flex-col px-1 sm:flex-row sm:gap-8">
            <Switch
              checked={prompt.singleSelect}
              onChange={(v) => onChange((p) => ({ ...p, singleSelect: v }))}
              label="Members pick only one"
              className="flex-1"
            />
            <Switch
              checked={prompt.required}
              onChange={(v) => onChange((p) => ({ ...p, required: v }))}
              label="Required"
              className="flex-1"
            />
          </div>
          <ol className="flex flex-col gap-2">
            {prompt.options.map((o, j) => (
              <OptionEditor
                key={o.id}
                space={space}
                option={o}
                label={`${label}, option ${j + 1}`}
                index={j}
                count={prompt.options.length}
                onChange={(patch) => setOptions((list) => list.map((x) => (x.id === o.id ? { ...x, ...patch } : x)))}
                onMove={(to) => setOptions((list) => moveItem(list, j, to))}
                onRemove={() => setOptions((list) => list.filter((x) => x.id !== o.id))}
              />
            ))}
          </ol>
          {prompt.options.length < MAX_OPTIONS ? (
            <div>
              <Button size="sm" variant="ghost" leftIcon={Plus} onClick={() => setOptions((list) => [...list, newOption()])}>
                Add an option
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function OnboardingPage({ space }: { space: Space }) {
  const editor = useCommunityEditor(space.id, onboardingDraftOf, onboardingBody);
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewPicks, setPreviewPicks] = useState<Set<string>>(() => new Set());
  const { draft } = editor;
  const previewPrompt = useMemo(() => {
    if (!draft) return null;
    const p = draft.prompts.find((x) => x.id === openId) ?? draft.prompts[0];
    return p ? onboardingOf({ enabled: true, prompts: [p] }).prompts[0]! : null;
  }, [draft, openId]);
  if (!draft) return <EditorLoading error={editor.loadError} />;
  const setPrompts = (update: (list: PromptDraft[]) => PromptDraft[]) =>
    editor.setDraft((d) => ({ ...d, prompts: update(d.prompts) }));
  // A role deleted since it was picked shows as "Deleted role" until it is removed.
  const roleIds = new Set(space.roles.map((r) => r.id));
  const problem =
    onboardingProblem(draft) ??
    (draft.prompts.some((p) => p.options.some((o) => o.roleIds.some((id) => !roleIds.has(id))))
      ? 'Remove the deleted roles from the options'
      : null);

  return (
    <div className="flex flex-col gap-8 pb-24" data-testid="onboarding-page">
      <div className="card-inset flex flex-col px-3">
        <Switch
          checked={draft.enabled}
          onChange={(v) => editor.setDraft((d) => ({ ...d, enabled: v }))}
          disabled={!draft.enabled && draft.prompts.length === 0}
          label="Turn on onboarding"
          description={
            draft.prompts.length
              ? 'New members answer these questions when they join and get the roles of their answers. Members already here are not asked.'
              : 'Add a question first.'
          }
        />
      </div>

      <Section
        title={`Questions — ${draft.prompts.length}/${MAX_PROMPTS}`}
        description="Each question gets its own page. Members cannot go on without answering a required one."
      >
        <ol className="flex flex-col gap-2">
          {draft.prompts.map((p, i) => (
            <PromptEditor
              key={p.id}
              space={space}
              prompt={p}
              index={i}
              count={draft.prompts.length}
              open={openId === p.id}
              onToggleOpen={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
              onChange={(update) => setPrompts((list) => list.map((x) => (x.id === p.id ? update(x) : x)))}
              onMove={(to) => setPrompts((list) => moveItem(list, i, to))}
              onRemove={() => setPrompts((list) => list.filter((x) => x.id !== p.id))}
            />
          ))}
        </ol>
        {draft.prompts.length < MAX_PROMPTS ? (
          <div>
            <Button
              size="sm"
              variant="soft"
              leftIcon={Plus}
              onClick={() => {
                const p = newPrompt();
                setPrompts((list) => [...list, p]);
                setOpenId(p.id);
              }}
            >
              Add a question
            </Button>
          </div>
        ) : null}
      </Section>

      {previewPrompt ? (
        <Section title="Preview" description="What new members see on this question's page (try picking).">
          <div className="card-inset p-5" role="figure" aria-label="Onboarding preview">
            <PromptPage
              prompt={previewPrompt}
              picked={previewPicks}
              headingId="onboarding-preview-question"
              onToggle={(id) => setPreviewPicks((cur) => togglePick(cur, previewPrompt, id))}
            />
          </div>
        </Section>
      ) : null}

      <UnsavedBar editor={editor} problem={problem} />
    </div>
  );
}
