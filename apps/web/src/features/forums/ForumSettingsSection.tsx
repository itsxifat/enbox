/**
 * The Forum section of a forum channel's settings (Discord's forum options): the post
 * guidelines (markdown, shown above the posts), the tags (up to MAX_FORUM_TAGS, each with an
 * emoji, a name and "moderators only"), the default reaction offered on every post, the
 * default sort order and layout (media channels: their grid, and whether the viewer offers
 * downloads instead), and whether posts must wear a tag. Saved together with one channel
 * PATCH; tag ids are made here and kept, so renaming a tag keeps it on its posts.
 */
import { Suspense, useMemo, useState } from 'react';
import { Lock, Plus, SmilePlus, Trash2, X } from 'lucide-react';
import {
  FORUM_GUIDELINES_MAX_LENGTH,
  FORUM_TAG_NAME_MAX_LENGTH,
  MAX_FORUM_TAGS,
  type ChatSummary,
  type ForumSettings,
  type ForumTag,
  type ID,
} from '@enbox/shared';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { Button, Checkbox, Field, IconButton, Input, RadioGroup, Spinner, Switch, Textarea, toast } from '@/components/ui';
import { LazyEmojiPicker } from '@/features/conversation/lazy';
import { updateChannel } from '@/features/spaces/actions';
import { forumOf } from '@/stores/forums';
import { newTagId } from './format';

/** Where an emoji picker is open: a tag's emoji or the default reaction. */
type Picking = { kind: 'tag'; id: string } | { kind: 'reaction' } | null;

function EmojiPicker({ chat, onPick }: { chat: ChatSummary; onPick: (emoji: string) => void }) {
  return (
    <div className="card-inset h-[320px] overflow-hidden" data-testid="forum-emoji-picker">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-brand-ink">
            <Spinner />
          </div>
        }
      >
        <LazyEmojiPicker height="100%" custom={chat} onPick={onPick} />
      </Suspense>
    </div>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function ForumSettingsSection({ spaceId, chat }: { spaceId: ID; chat: ChatSummary }) {
  const saved = forumOf(chat);
  const [tags, setTags] = useState<ForumTag[]>(saved.tags);
  const [settings, setSettings] = useState<ForumSettings>(saved.settings);
  const [guidelines, setGuidelines] = useState(saved.settings.guidelines ?? '');
  const [picking, setPicking] = useState<Picking>(null);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const next: ForumSettings = useMemo(
    () => ({ ...settings, guidelines: guidelines.trim() ? guidelines : null }),
    [settings, guidelines],
  );
  const cleanTags = tags.map((t) => ({ ...t, name: t.name.trim() }));
  const dirty = !same(cleanTags, saved.tags) || !same(next, saved.settings);
  const emptyName = cleanTags.some((t) => !t.name);
  const set = (patch: Partial<ForumSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const editTag = (id: string, patch: Partial<ForumTag>) =>
    setTags((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addTag = () => {
    if (tags.length >= MAX_FORUM_TAGS) return;
    setTags((list) => [...list, { id: newTagId(list.map((t) => t.id)), name: '', emoji: null, moderated: false }]);
  };

  const reset = () => {
    setTags(saved.tags);
    setSettings(saved.settings);
    setGuidelines(saved.settings.guidelines ?? '');
    setPicking(null);
    setShowErrors(false);
  };

  const save = async () => {
    if (emptyName) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      await updateChannel(spaceId, chat.id, { forumTags: cleanTags, forumSettings: next });
      setShowErrors(false);
      toast.success('Forum settings saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="forum-settings">
      <Field
        label="Post Guidelines"
        htmlFor="forum-guidelines"
        hint="Shown above the posts. Markdown works: **bold**, lists, links."
      >
        <Textarea
          id="forum-guidelines"
          value={guidelines}
          maxLength={FORUM_GUIDELINES_MAX_LENGTH}
          rows={4}
          autoResize
          maxRows={10}
          placeholder="Let people know how to post here"
          onChange={(e) => setGuidelines(e.target.value)}
        />
      </Field>

      <section aria-labelledby="forum-tags-title">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 id="forum-tags-title" className="text-[12px] font-bold tracking-wide text-muted uppercase">
            Tags ({tags.length}/{MAX_FORUM_TAGS})
          </h3>
          <Button size="sm" variant="soft" leftIcon={Plus} onClick={addTag} disabled={tags.length >= MAX_FORUM_TAGS}>
            Add Tag
          </Button>
        </div>
        <p className="mb-2 text-[13px] text-muted">
          People pick tags for their posts, and everyone can filter the posts by tag. Moderator tags can only be added
          or removed by members who can manage messages.
        </p>
        {tags.length ? (
          <ul className="card-inset flex flex-col p-1" aria-label="Tags">
            {tags.map((t, i) => (
              <li key={t.id} className="flex flex-col gap-2 rounded-lg px-2 py-2" data-testid="forum-tag-row">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={t.emoji ? `Change the emoji of ${t.name || 'this tag'}` : `Add an emoji to ${t.name || 'this tag'}`}
                    onClick={() => setPicking(picking?.kind === 'tag' && picking.id === t.id ? null : { kind: 'tag', id: t.id })}
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {t.emoji ? <EmojiGlyph emoji={t.emoji} size={22} /> : <SmilePlus size={18} aria-hidden />}
                  </button>
                  <Input
                    aria-label={`Tag ${i + 1} name`}
                    value={t.name}
                    maxLength={FORUM_TAG_NAME_MAX_LENGTH}
                    placeholder="Tag name"
                    autoFocus={!t.name && i === tags.length - 1}
                    error={showErrors && !t.name.trim() ? 'Give the tag a name' : undefined}
                    onChange={(e) => editTag(t.id, { name: e.target.value })}
                    containerClassName="min-w-0 flex-1"
                  />
                  <Checkbox
                    checked={t.moderated}
                    onChange={(moderated) => editTag(t.id, { moderated })}
                    label={
                      <span className="inline-flex items-center gap-1 text-[13px] whitespace-nowrap">
                        <Lock size={13} aria-hidden />
                        Mods only
                      </span>
                    }
                  />
                  {t.emoji ? (
                    <IconButton icon={X} label={`Remove the emoji of ${t.name || 'this tag'}`} size="sm" onClick={() => editTag(t.id, { emoji: null })} />
                  ) : null}
                  <IconButton
                    icon={Trash2}
                    label={`Delete tag ${t.name || i + 1}`}
                    size="sm"
                    className="text-danger"
                    onClick={() => {
                      setTags((list) => list.filter((x) => x.id !== t.id));
                      if (picking?.kind === 'tag' && picking.id === t.id) setPicking(null);
                    }}
                  />
                </div>
                {picking?.kind === 'tag' && picking.id === t.id ? (
                  <EmojiPicker
                    chat={chat}
                    onPick={(emoji) => {
                      editTag(t.id, { emoji });
                      setPicking(null);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="card-inset px-3 py-4 text-center text-[13px] text-muted">No tags yet.</p>
        )}
      </section>

      <Switch
        checked={settings.requireTag}
        onChange={(requireTag) => set({ requireTag })}
        label="Require tags"
        description="People must pick at least one tag when they create a post."
      />
      {settings.media ? (
        <Switch
          checked={!!settings.hideDownloads}
          onChange={(hideDownloads) => set({ hideDownloads })}
          label="Hide media download options"
          description="Takes the download buttons out of the media viewer and the post menus. People can still save what they see."
        />
      ) : null}

      <Field label="Default Reaction" hint="Shown on every post card, one click to react.">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicking(picking?.kind === 'reaction' ? null : { kind: 'reaction' })}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-[14px] font-medium hover:bg-line focus-visible:outline-2 focus-visible:outline-brand"
            aria-label={settings.defaultReaction ? `Default reaction: ${settings.defaultReaction}. Change it` : 'Choose a default reaction'}
          >
            {settings.defaultReaction ? <EmojiGlyph emoji={settings.defaultReaction} size={22} /> : <SmilePlus size={18} aria-hidden />}
            {settings.defaultReaction ? 'Change' : 'Choose an emoji'}
          </button>
          {settings.defaultReaction ? (
            <Button size="sm" variant="ghost" onClick={() => set({ defaultReaction: null })}>
              Remove
            </Button>
          ) : null}
        </div>
        {picking?.kind === 'reaction' ? (
          <div className="mt-2">
            <EmojiPicker
              chat={chat}
              onPick={(emoji) => {
                set({ defaultReaction: emoji });
                setPicking(null);
              }}
            />
          </div>
        ) : null}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <RadioGroup
          label="Default Sort Order"
          name="forum-sort"
          value={settings.defaultSort}
          onChange={(defaultSort) => set({ defaultSort })}
          options={[
            { value: 'activity', label: 'Recent Activity', description: 'Posts with the newest replies first' },
            { value: 'created', label: 'Creation Time', description: 'The newest posts first' },
          ]}
        />
        {settings.media ? null : (
          <RadioGroup
            label="Default Layout"
            name="forum-layout"
            value={settings.layout}
            onChange={(layout) => set({ layout })}
            options={[
              { value: 'list', label: 'List', description: 'Titles with the first lines of each post' },
              { value: 'gallery', label: 'Gallery', description: 'A grid led by each post’s image' },
            ]}
          />
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty || busy} onClick={reset}>
          Reset
        </Button>
        <Button loading={busy} disabled={!dirty} onClick={() => void save()} data-testid="forum-settings-save">
          Save Changes
        </Button>
      </div>
    </div>
  );
}
