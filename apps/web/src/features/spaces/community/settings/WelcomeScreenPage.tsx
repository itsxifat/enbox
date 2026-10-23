/**
 * Space Settings → Welcome Screen (MANAGE_SPACE): what new members see the first time they
 * open the Space — a line about it and up to five recommended channels (each with a short
 * description and an emoji), with a live preview. Only text channels everyone can see.
 */
import { useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import {
  PERM,
  computeBasePermissions,
  computeChannelPermissions,
  hasPerm,
  type ChatSummary,
  type ID,
  type Space,
  type SpaceCommunity,
  type UpdateSpaceCommunityRequest,
  type WelcomeScreen,
} from '@enbox/shared';
import { Button, Field, Input, Switch, Textarea } from '@/components/ui';
import { useSpaceChannels, useSpaces } from '@/stores/spaces';
import { WelcomeContent } from '../WelcomeModal';
import {
  EditorLoading,
  EmojiButton,
  RowActions,
  Section,
  UnsavedBar,
  moveItem,
  shortId,
  useCommunityEditor,
} from './shared';

export const WELCOME_MAX_CHANNELS = 5;
const WELCOME_DESCRIPTION_MAX = 140;
const CHANNEL_DESCRIPTION_MAX = 50;

export interface WelcomeDraft {
  enabled: boolean;
  description: string;
  /** `key`: a stable row key (not sent). */
  channels: { key: string; channelId: ID | ''; description: string; emoji: string | null }[];
}

export function welcomeDraftOf(c: SpaceCommunity): WelcomeDraft {
  const w = c.welcomeScreen;
  return {
    enabled: w?.enabled ?? false,
    description: w?.description ?? '',
    channels: (w?.channels ?? []).map((x) => ({ key: shortId('w'), ...x })),
  };
}

function screenOf(d: WelcomeDraft): WelcomeScreen {
  return {
    enabled: d.enabled,
    description: d.description.trim() || null,
    channels: d.channels.map((c) => ({ channelId: c.channelId, description: c.description.trim(), emoji: c.emoji || null })),
  };
}

/**
 * The PATCH body: the whole screen when anything changed. Pure. Both sides go through
 * `screenOf` (jsonb does not keep key order, so the saved copy is compared in the same shape).
 */
export function welcomeBody(c: SpaceCommunity, d: WelcomeDraft): UpdateSpaceCommunityRequest {
  const next = screenOf(d);
  return JSON.stringify(next) === JSON.stringify(screenOf(welcomeDraftOf(c))) ? {} : { welcomeScreen: next };
}

/** Why the draft cannot be saved (null = fine). Pure. */
export function welcomeProblem(d: WelcomeDraft): string | null {
  if (d.channels.some((c) => !c.channelId)) return 'Pick a channel for every recommendation';
  if (d.channels.some((c) => !c.description.trim())) return 'Describe every recommended channel';
  if (new Set(d.channels.map((c) => c.channelId)).size !== d.channels.length) return 'Recommend each channel once';
  return null;
}

/** Text channels new members (@everyone, no roles) can see: the ones a welcome screen may show. */
export function useWelcomeCandidates(space: Space): ChatSummary[] {
  const channels = useSpaceChannels(space.id);
  return useMemo(() => {
    const everyone = space.roles.find((r) => r.isDefault);
    if (!everyone) return [];
    const who = { everyoneRoleId: everyone.id, memberRoleIds: [] as ID[], viewerId: '' };
    const base = computeBasePermissions({ ...who, ownerId: space.ownerId, roles: space.roles });
    return channels.filter(
      (c) =>
        (c.type === 'space_text' || c.type === 'space_forum') &&
        !!c.space &&
        hasPerm(
          computeChannelPermissions(base, { ...who, channelType: c.type, overwrites: c.space.overwrites }),
          PERM.VIEW_CHANNEL,
        ),
    );
  }, [channels, space.roles, space.ownerId]);
}

export function WelcomeScreenPage({ space }: { space: Space }) {
  const editor = useCommunityEditor(space.id, welcomeDraftOf, welcomeBody);
  const candidates = useWelcomeCandidates(space);
  const names = useMemo(() => new Map(candidates.map((c) => [c.id, c.name ?? 'channel'])), [candidates]);
  const loaded = useSpaces((s) => !!s.channelsLoaded[space.id]);
  useEffect(() => {
    if (!loaded)
      void useSpaces
        .getState()
        .loadSpace(space.id)
        .catch(() => undefined);
  }, [loaded, space.id]);
  const { draft } = editor;
  if (!draft) return <EditorLoading error={editor.loadError} />;
  // A recommended channel deleted or made private since: it has to be replaced.
  const unavailable = (id: ID | '') => loaded && !!id && !names.has(id);
  const problem =
    welcomeProblem(draft) ??
    (draft.channels.some((c) => unavailable(c.channelId)) ? 'Replace the channels that are gone or private' : null);
  const setChannels = (update: (list: WelcomeDraft['channels']) => WelcomeDraft['channels']) =>
    editor.setDraft((d) => ({ ...d, channels: update(d.channels) }));
  const patchRow = (i: number, patch: Partial<WelcomeDraft['channels'][number]>) =>
    setChannels((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const preview = draft.channels.flatMap((c) =>
    c.channelId ? [{ id: c.channelId, name: names.get(c.channelId) ?? 'channel', description: c.description.trim() || 'Description', emoji: c.emoji }] : [],
  );

  return (
    <div className="flex flex-col gap-8 pb-24" data-testid="welcome-screen-page">
      <div className="card-inset flex flex-col px-3">
        <Switch
          checked={draft.enabled}
          onChange={(v) => editor.setDraft((d) => ({ ...d, enabled: v }))}
          label="Show the welcome screen"
          description="New members see it the first time they open the Space on a device."
        />
      </div>

      <Field label="Description" htmlFor="welcome-description" hint="What is this Space about? Leave it empty to use the Space description.">
        <Textarea
          id="welcome-description"
          rows={2}
          maxLength={WELCOME_DESCRIPTION_MAX}
          value={draft.description}
          onChange={(e) => editor.setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </Field>

      <Section
        title={`Recommended channels — ${draft.channels.length}/${WELCOME_MAX_CHANNELS}`}
        description="Point new members to the channels to start with. Only text channels everyone can see can be recommended."
      >
        <ol className="flex flex-col gap-2">
          {draft.channels.map((c, i) => (
            <li key={c.key} className="card-inset flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid="welcome-row">
              <div className="flex items-center gap-2 sm:contents">
                <EmojiButton value={c.emoji} onChange={(emoji) => patchRow(i, { emoji })} label="Channel emoji" />
                <select
                  aria-label={`Channel ${i + 1}`}
                  value={c.channelId}
                  onChange={(e) => patchRow(i, { channelId: e.target.value })}
                  className="h-11 min-w-0 flex-1 rounded-xl bg-surface px-3 sm:max-w-[34%]"
                >
                  <option value="">Pick a channel</option>
                  {c.channelId && !names.has(c.channelId) ? (
                    <option value={c.channelId}>{loaded ? 'Unavailable channel' : 'Loading…'}</option>
                  ) : null}
                  {candidates.map((ch) => (
                    <option
                      key={ch.id}
                      value={ch.id}
                      disabled={ch.id !== c.channelId && draft.channels.some((x) => x.channelId === ch.id)}
                    >
                      #{ch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 sm:contents">
                <Input
                  aria-label={`Description of channel ${i + 1}`}
                  placeholder="What happens there?"
                  maxLength={CHANNEL_DESCRIPTION_MAX}
                  value={c.description}
                  onChange={(e) => patchRow(i, { description: e.target.value })}
                  containerClassName="min-w-0 flex-1"
                />
                <RowActions
                  index={i}
                  count={draft.channels.length}
                  what="channel"
                  onMove={(to) => setChannels((list) => moveItem(list, i, to))}
                  onRemove={() => setChannels((list) => list.filter((_, j) => j !== i))}
                />
              </div>
            </li>
          ))}
        </ol>
        {draft.channels.length < WELCOME_MAX_CHANNELS ? (
          <div>
            <Button
              size="sm"
              variant="soft"
              leftIcon={Plus}
              onClick={() =>
                setChannels((list) => [...list, { key: shortId('w'), channelId: '', description: '', emoji: null }])
              }
            >
              Add a channel
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="Preview">
        <div className="card-inset mx-auto w-full max-w-md p-6" aria-label="Welcome screen preview" role="figure">
          <WelcomeContent
            spaceName={space.name}
            iconUrl={space.iconUrl}
            description={draft.description.trim() || space.description}
            channels={preview}
          />
        </div>
      </Section>

      <UnsavedBar editor={editor} problem={problem} />
    </div>
  );
}
