/**
 * Space Settings ▸ Server Tag (MANAGE_SPACE): the 2-4 letter tag members can wear next to
 * their name everywhere, its badge and the badge's colour, with a live preview of a chat name
 * in the light and dark themes. Save Changes sends the whole tag; Remove Tag takes it off every
 * wearer (they show it again if a tag is set later). Members pick theirs in Settings ▸
 * Profiles; whoever edits it here can wear it right away.
 */
import { useState, type CSSProperties } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { SPACE_TAG_BADGES, type Space, type SpaceTag } from '@enbox/shared';
import {
  SPACE_TAG_BADGE_ICONS,
  SPACE_TAG_BADGE_LABELS,
} from '@/components/cosmetics/TagPill/badges';
import { useWornTag } from '@/components/cosmetics/TagPill/ServerTagPill';
import { TagPill } from '@/components/cosmetics/TagPill/TagPill';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { Avatar, Button, Input, confirm, toast } from '@/components/ui';
import { ColorPicker } from '@/features/settings/profile/ColorPicker';
import { Section, UnsavedBar } from '@/features/spaces/community/settings/shared';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { removeSpaceTag, saveSpaceTag, wearSpaceTag } from './actions';
import {
  TAG_COLOR_PRESETS,
  TAG_MAX_LENGTH,
  sameTag,
  tagDraftOf,
  tagLength,
  tagProblem,
} from './model';

/** The light theme's tokens (index.css :root), so its preview stays light in the dark app. */
const LIGHT_TOKENS = {
  '--surface': '#ffffff',
  '--surface-2': '#f2f3f5',
  '--fg': '#2e3035',
  '--muted': '#5c5e66',
  '--subtle': '#6d6f78',
  colorScheme: 'light',
} as CSSProperties;

export function ServerTagSettingsPage({ space }: { space: Space }) {
  const saved = space.tag ?? null;
  const [draft, setDraft] = useState<SpaceTag>(() => tagDraftOf(saved));
  const [busy, setBusy] = useState(false);
  // The saved tag changed (my save, or another manager's): follow it unless I'm editing.
  const [base, setBase] = useState(saved);
  if (!sameTag(base, saved)) {
    setBase(saved);
    if (sameTag(draft, tagDraftOf(base))) setDraft(tagDraftOf(saved));
  }
  const set = <K extends keyof SpaceTag>(k: K, v: SpaceTag[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const text = draft.tag.trim();
  const problem = tagProblem(draft.tag);
  const dirty = !sameTag(draft, tagDraftOf(saved));
  const preview: SpaceTag = { ...draft, tag: text || 'TAG' };

  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const tag = await saveSpaceTag(space.id, {
        tag: text,
        badge: draft.badge,
        color: draft.color,
      });
      setDraft(tagDraftOf(tag));
      toast.success(saved ? 'Tag updated' : 'Tag saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove the tag?',
      message:
        'Members wearing it stop showing it. If you set a tag again later, it shows on them again.',
      confirmLabel: 'Remove Tag',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeSpaceTag(space.id);
      setDraft(tagDraftOf(null));
      toast.success('Tag removed');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-24" data-testid="server-tag-settings">
      <p className="-mt-3 text-[14px] text-muted">
        A short tag your members can wear next to their name: in every chat, the member list and
        their profile. Each member chooses theirs in Settings ▸ Profiles.
      </p>

      <Section title="Tag" description="2 to 4 letters or numbers, in any language.">
        <Input
          aria-label="Tag"
          value={draft.tag}
          onChange={(e) => set('tag', e.target.value)}
          placeholder="RKT"
          autoComplete="off"
          spellCheck={false}
          error={text && problem ? problem : undefined}
          aside={`${tagLength(draft.tag)}/${TAG_MAX_LENGTH}`}
          containerClassName="max-w-xs"
        />
      </Section>

      <Section title="Badge">
        <div
          role="group"
          aria-label="Badge"
          className="grid max-w-md grid-cols-6 gap-1.5 sm:grid-cols-8"
        >
          {SPACE_TAG_BADGES.map((b) => {
            const Icon = SPACE_TAG_BADGE_ICONS[b];
            const on = draft.badge === b;
            return (
              <button
                key={b}
                type="button"
                aria-label={SPACE_TAG_BADGE_LABELS[b]}
                aria-pressed={on}
                onClick={() => set('badge', b)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-xl outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  on ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface-2 hover:bg-hover',
                )}
              >
                <Icon size={20} color={draft.color} strokeWidth={ICON_STROKE_BOLD} aria-hidden />
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Colour">
        <ColorPicker
          label="Badge colour"
          value={draft.color}
          onChange={(c) => set('color', c)}
          presets={TAG_COLOR_PRESETS}
          fallback={TAG_COLOR_PRESETS[0]}
        />
      </Section>

      <Section title="Preview" description="How a member wearing it looks in chat.">
        <div className="grid gap-2 sm:grid-cols-2">
          <ChatPreview tag={preview} theme="light" />
          <ChatPreview tag={preview} theme="dark" />
        </div>
      </Section>

      {saved ? <WearIt space={space} tag={saved} /> : null}

      {saved ? (
        <Section title="Remove tag" description="Members wearing it stop showing it.">
          <div>
            <Button
              variant="danger"
              leftIcon={Trash2}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove Tag
            </Button>
          </div>
        </Section>
      ) : null}

      <UnsavedBar
        editor={{ dirty, busy, save, reset: () => setDraft(tagDraftOf(saved)) }}
        problem={problem}
      />
    </div>
  );
}

/** A chat message header in one theme: my avatar and name, the tag, the time. */
function ChatPreview({ tag, theme }: { tag: SpaceTag; theme: 'light' | 'dark' }) {
  const me = useMe();
  const name = me?.displayName ?? 'Member';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl bg-surface px-3 py-2.5 shadow-sm',
        theme === 'dark' && 'dark',
      )}
      style={theme === 'light' ? LIGHT_TOKENS : undefined}
      data-testid={`tag-preview-${theme}`}
    >
      <Avatar src={me?.avatarUrl ?? null} name={name} colorSeed={me?.id} size={40} decorative />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-fg">{name}</span>
          <TagPill tag={tag} />
          <span className="shrink-0 text-[11.5px] text-muted">
            Today at {formatTime(new Date())}
          </span>
        </div>
        <p className="text-[14.5px] text-fg">Hey everyone!</p>
      </div>
    </div>
  );
}

/** "Wear this tag" for whoever set it up (members pick theirs in Settings ▸ Profiles). */
function WearIt({ space, tag }: { space: Space; tag: SpaceTag }) {
  const me = useMe();
  const worn = useWornTag(me?.id);
  const [busy, setBusy] = useState(false);
  const wearing = worn?.spaceId === space.id;
  const wear = async () => {
    setBusy(true);
    try {
      await wearSpaceTag(space.id);
      toast.success('You now wear this tag');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Your tag">
      <div className="card-inset flex flex-wrap items-center gap-3 px-3 py-2.5">
        <TagPill tag={tag} size="md" />
        <span className="min-w-0 flex-1 text-[14px] text-muted">
          {wearing ? 'You wear this tag.' : 'Show it next to your name everywhere.'}
        </span>
        {wearing ? (
          <Check size={18} className="shrink-0 text-success" aria-hidden />
        ) : (
          <Button size="sm" variant="soft" loading={busy} onClick={() => void wear()}>
            Wear this tag
          </Button>
        )}
      </div>
    </Section>
  );
}
