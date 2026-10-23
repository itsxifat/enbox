/**
 * The New Post form, inline at the top of the forum (Discord): the title, the post's message,
 * one image (the usual upload path) and the forum's tags (a dropdown of chips; required when
 * the forum says so, moderated ones for moderators only). "Post" creates the thread and its
 * first message in one request and opens the post beside the forum.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type ForumInfo,
} from '@enbox/shared';
import { Button, IconButton, Input, Textarea, toast } from '@/components/ui';
import { openThread } from '@/features/threads/actions';
import { newClientId } from '@/lib/ids';
import { createObjectUrl, revokeObjectUrl } from '@/lib/media';
import { useForums } from '@/stores/forums';
import { MAX_POST_TAGS, postTags } from './format';
import { TagPicker, TagPill } from './tags';

/** Post titles (the server's limit). */
export const POST_TITLE_MAX_LENGTH = 100;
/** A post's message (the server's limit). */
export const POST_TEXT_MAX_LENGTH = 4000;

export interface NewPostComposerProps {
  forum: ChatSummary;
  info: ForumInfo;
  /** The search text when "New Post" was pressed: the title to start from. */
  initialTitle?: string;
  onClose: () => void;
}

function previewUrl(file: File): string | null {
  try {
    return createObjectUrl(file);
  } catch {
    return null;
  }
}

export function NewPostComposer({ forum, info, initialTitle = '', onClose }: NewPostComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per post being written: a retry after a lost reply cannot post it twice.
  const clientId = useRef(newClientId());
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const bits = forum.spacePermissions ?? 0;
  const moderator = hasPerm(bits, PERM.MANAGE_MESSAGES);
  const canAttach = hasPerm(bits, PERM.ATTACH_FILES);
  const required = info.settings.requireTag && info.tags.length > 0;
  const picked = postTags(info, tags);
  const url = useMemo(() => (image ? previewUrl(image) : null), [image]);
  useEffect(() => () => revokeObjectUrl(url), [url]);

  const ready = title.trim().length > 0 && (text.trim().length > 0 || !!image);

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) return setError('Give your post a title.');
    if (!text.trim() && !image) return setError('Write a message or add an image.');
    if (required && picked.length === 0) return setError('This forum requires at least one tag.');
    setError(null);
    setBusy(true);
    try {
      const post = await useForums.getState().createPost(forum.id, {
        name: title,
        text,
        appliedTags: picked.map((t) => t.id),
        image,
        clientId: clientId.current,
      });
      onClose();
      openThread(post.id, forum.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      textRef.current?.focus();
    }
    if (e.key === 'Escape') onClose();
  };
  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <form
      aria-label="New Post"
      className="card-inset flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="forum-new-post"
    >
      <Input
        aria-label="Post title"
        value={title}
        maxLength={POST_TITLE_MAX_LENGTH}
        placeholder="Post title"
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onTitleKey}
        data-testid="forum-post-title"
      />
      <Textarea
        ref={textRef}
        aria-label="Post message"
        value={text}
        maxLength={POST_TEXT_MAX_LENGTH}
        rows={3}
        autoResize
        maxRows={12}
        placeholder="Enter a message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onTextKey}
        data-testid="forum-post-text"
      />
      {image ? (
        <div className="relative w-fit">
          {url ? (
            <img src={url} alt={image.name} className="max-h-40 max-w-64 rounded-lg object-cover" />
          ) : (
            <span className="block rounded-lg bg-surface px-3 py-2 text-[13px] text-muted">{image.name}</span>
          )}
          <IconButton
            icon={X}
            label="Remove image"
            size="sm"
            variant="ghost"
            className="absolute -top-2 -right-2 bg-elevated shadow-elevated"
            onClick={() => setImage(null)}
          />
        </div>
      ) : null}
      {picked.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Selected tags">
          {picked.map((t) => (
            <TagPill key={t.id} tag={t} />
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canAttach ? (
          <>
            <IconButton icon={ImagePlus} label="Add an image" variant="ghost" onClick={() => fileRef.current?.click()} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              aria-label="Image file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (f && !f.type.startsWith('image/')) return void toast.error('Choose an image');
                setImage(f);
              }}
              data-testid="forum-post-file"
            />
          </>
        ) : null}
        <TagPicker
          tags={info.tags}
          value={tags}
          onChange={(ids) => {
            setTags(ids.slice(0, MAX_POST_TAGS));
            setError(null);
          }}
          moderator={moderator}
          required={required}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={!ready} data-testid="forum-post-submit">
            Post
          </Button>
        </div>
      </div>
    </form>
  );
}
