/**
 * Space Settings → Community Overview (MANAGE_SPACE): the discovery listing (Discord asks for
 * a description and a category first), its category and up to five tags, and the vanity URL
 * (a custom invite code, unique across every invite).
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CircleCheck, CircleX, Copy, X } from 'lucide-react';
import {
  DISCOVERY_CATEGORIES,
  MAX_DISCOVERY_TAGS,
  type DiscoveryCategory,
  type Space,
  type SpaceCommunity,
  type UpdateSpaceCommunityRequest,
} from '@enbox/shared';
import { Button, Field, Input, Switch } from '@/components/ui';
import { copyLink, inviteUrl } from '@/features/groups/shared/share';
import { cn } from '@/lib/cn';
import { getServerConfig } from '@/lib/serverConfig';
import { settingsPath } from '../../settings/sections';
import { EditorLoading, Section, UnsavedBar, useCommunityEditor } from './shared';

export const VANITY_RE = /^[a-z0-9-]{3,32}$/;
const TAG_MAX_LENGTH = 24;

export interface OverviewDraft {
  isDiscoverable: boolean;
  discoveryCategory: DiscoveryCategory | null;
  discoveryTags: string[];
  vanityCode: string;
}

export function overviewDraftOf(c: SpaceCommunity): OverviewDraft {
  return {
    isDiscoverable: c.isDiscoverable,
    discoveryCategory: c.discoveryCategory,
    discoveryTags: c.discoveryTags,
    vanityCode: c.vanityCode ?? '',
  };
}

/** What changed (the PATCH body). Pure. */
export function overviewBody(c: SpaceCommunity, d: OverviewDraft): UpdateSpaceCommunityRequest {
  const out: UpdateSpaceCommunityRequest = {};
  if (d.isDiscoverable !== c.isDiscoverable) out.isDiscoverable = d.isDiscoverable;
  if (d.discoveryCategory !== c.discoveryCategory) out.discoveryCategory = d.discoveryCategory;
  if (d.discoveryTags.join('\u0000') !== c.discoveryTags.join('\u0000')) out.discoveryTags = d.discoveryTags;
  const vanity = d.vanityCode.trim().toLowerCase() || null;
  if (vanity !== c.vanityCode) out.vanityCode = vanity;
  return out;
}

/** Why the draft cannot be saved (null = fine). Pure. */
export function overviewProblem(space: Pick<Space, 'description'>, d: OverviewDraft): string | null {
  const vanity = d.vanityCode.trim().toLowerCase();
  if (vanity && !VANITY_RE.test(vanity)) return 'Vanity URL: use 3–32 lowercase letters, numbers or dashes';
  if (d.isDiscoverable && !space.description?.trim()) return 'Add a description in Overview to list your Space';
  if (d.isDiscoverable && !d.discoveryCategory) return 'Pick a category to list your Space';
  return null;
}

function Requirement({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-center gap-2 text-[14px]">
      <Icon size={18} className={ok ? 'text-success' : 'text-subtle'} aria-hidden />
      <span className={ok ? 'text-fg' : 'text-muted'}>{children}</span>
      <span className="sr-only">{ok ? '(done)' : '(missing)'}</span>
    </li>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState('');
  const full = tags.length >= MAX_DISCOVERY_TAGS;
  const add = () => {
    const tag = text.trim().toLowerCase().slice(0, TAG_MAX_LENGTH);
    setText('');
    if (!tag || full || tags.includes(tag)) return;
    onChange([...tags, tag]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl bg-surface-2 px-2 py-1.5">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pr-1 pl-2.5 text-[13px] font-medium text-brand-ink">
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="flex size-5 items-center justify-center rounded-full hover:bg-black/10"
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          id="community-tags"
          value={text}
          disabled={full}
          maxLength={TAG_MAX_LENGTH}
          onChange={(e) => setText(e.target.value.replace(',', ''))}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={full ? 'That’s the most tags' : 'Add a tag and press Enter'}
          className="h-8 min-w-[10ch] flex-1 bg-transparent px-1 text-[15px] text-fg outline-none placeholder:text-subtle"
        />
      </div>
      <p className="text-[12px] text-muted">
        {tags.length}/{MAX_DISCOVERY_TAGS} — search finds your Space by its name, description and tags.
      </p>
    </div>
  );
}

export function CommunityOverviewPage({ space }: { space: Space }) {
  const navigate = useNavigate();
  const editor = useCommunityEditor(space.id, overviewDraftOf, overviewBody);
  const [, setConfigLoaded] = useState(false);
  // Vanity links use the server's public origin, like every invite link.
  useEffect(() => {
    let live = true;
    void getServerConfig()
      .then(() => live && setConfigLoaded(true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const { draft, community } = editor;
  if (!draft || !community) return <EditorLoading error={editor.loadError} />;
  const set = <K extends keyof OverviewDraft>(k: K, v: OverviewDraft[K]) => editor.setDraft((d) => ({ ...d, [k]: v }));
  const hasDescription = !!space.description?.trim();
  const problem = overviewProblem(space, draft);
  const vanity = draft.vanityCode.trim().toLowerCase();
  const vanityBad = !!vanity && !VANITY_RE.test(vanity);

  return (
    <div className="flex flex-col gap-8 pb-24" data-testid="community-overview">
      <Section
        title="Discovery"
        description="Listed Spaces show up in Explore Spaces, where anyone on Enbox can find them and join without an invite."
      >
        <ul className="card-inset flex flex-col gap-2 p-4" aria-label="Requirements">
          <Requirement ok={hasDescription}>
            A description of your Space{' '}
            {!hasDescription ? (
              <Button size="sm" variant="ghost" className="ml-1 h-7 px-2" onClick={() => void navigate(settingsPath(space.id, 'overview'))}>
                Add one in Overview
              </Button>
            ) : null}
          </Requirement>
          <Requirement ok={!!draft.discoveryCategory}>A category</Requirement>
        </ul>
        <div className="card-inset flex flex-col px-3">
          <Switch
            checked={draft.isDiscoverable}
            onChange={(v) => set('isDiscoverable', v)}
            disabled={!hasDescription && !draft.isDiscoverable}
            label="List this Space in discovery"
            description={
              hasDescription
                ? 'It needs a category too. Turn it off at any time to unlist it.'
                : 'Add a description in Overview first.'
            }
          />
        </div>
        <Field label="Category" htmlFor="community-category" error={draft.isDiscoverable && !draft.discoveryCategory ? 'Pick a category to list your Space' : undefined}>
          <select
            id="community-category"
            value={draft.discoveryCategory ?? ''}
            onChange={(e) => set('discoveryCategory', (e.target.value || null) as DiscoveryCategory | null)}
            className="h-11 w-full rounded-xl bg-surface-2 px-3"
          >
            <option value="">Choose a category</option>
            {DISCOVERY_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags" htmlFor="community-tags">
          <TagEditor tags={draft.discoveryTags} onChange={(tags) => set('discoveryTags', tags)} />
        </Field>
      </Section>

      <Section title="Vanity URL" description="A custom invite link anyone can use to join. Each code works for one Space only.">
        <Field
          label="Invite code"
          htmlFor="community-vanity"
          error={vanityBad ? 'Use 3–32 lowercase letters, numbers or dashes' : undefined}
          hint={vanity && !vanityBad ? undefined : 'Letters, numbers and dashes, 3 to 32 of them.'}
        >
          <Input
            id="community-vanity"
            value={draft.vanityCode}
            maxLength={32}
            placeholder="my-space"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => set('vanityCode', e.target.value.replace(/\s+/g, '-').toLowerCase())}
          />
        </Field>
        <div className="flex items-center gap-2">
          <p className={cn('min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-[13px]', vanity && !vanityBad ? 'text-fg' : 'text-subtle')} data-testid="vanity-preview">
            {inviteUrl(vanity && !vanityBad ? vanity : 'your-code')}
          </p>
          {community.vanityCode ? (
            <Button size="sm" variant="soft" leftIcon={Copy} onClick={() => void copyLink(inviteUrl(community.vanityCode!), 'Vanity URL')}>
              Copy
            </Button>
          ) : null}
        </div>
      </Section>

      <UnsavedBar editor={editor} problem={problem} />
    </div>
  );
}
