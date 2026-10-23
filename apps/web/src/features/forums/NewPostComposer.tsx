/**
 * The New Post form, inline at the top of the forum (Discord): the title, the post's message,
 * its files (up to MAX_ATTACHMENTS: the picker, a drop on the form or a paste; pictures and
 * videos get alt text and lead the post) and the forum's tags (a dropdown of chips; required
 * when the forum says so, moderated ones for moderators only). A media channel takes pictures
 * and videos only, and every post needs one. "Post" uploads the files, then creates the thread
 * and its first message in one request and opens the post beside the forum.
 */
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { FileText, ImagePlus, Paperclip, Play, X } from 'lucide-react';
import { MAX_ALT_TEXT_LENGTH, PERM, hasPerm, type ChatSummary, type ForumInfo } from '@enbox/shared';
import { Button, IconButton, Input, Textarea, toast } from '@/components/ui';
import { MAX_ATTACHMENTS, NO_UPLOAD_PERMISSION, TOO_MANY_ATTACHMENTS, dragHasFiles } from '@/features/conversation/dropzone/files';
import { isVisualMedia } from '@/features/conversation/lib/mediaProcessing';
import { openThread } from '@/features/threads/actions';
import { newClientId } from '@/lib/ids';
import { cn } from '@/lib/cn';
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

/** A file of the post being written: its preview (pictures and videos) and alt text. */
interface PostFile {
  id: string;
  file: File;
  visual: boolean;
  url: string | null;
  description: string;
}

let nextFileId = 0;

function previewUrl(file: File): string | null {
  try {
    return createObjectUrl(file);
  } catch {
    return null;
  }
}

function FileTile({
  item,
  onRemove,
  onDescribe,
}: {
  item: PostFile;
  onRemove: () => void;
  onDescribe: (description: string) => void;
}) {
  const video = item.file.type.startsWith('video/');
  return (
    <li className="flex w-36 shrink-0 flex-col gap-1.5" data-testid="forum-post-file-tile">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface">
        {item.visual && item.url && !video ? (
          <img src={item.url} alt={item.description || item.file.name} className="size-full object-cover" />
        ) : item.visual && item.url ? (
          <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" aria-label={item.file.name} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-muted">
            <FileText size={26} aria-hidden />
            <span className="w-full truncate text-center text-[12px]">{item.file.name}</span>
          </div>
        )}
        {video ? (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-black/55 text-white">
            <Play size={12} aria-hidden />
          </span>
        ) : null}
        <IconButton
          icon={X}
          label={`Remove ${item.file.name}`}
          size="sm"
          variant="glass"
          className="absolute top-1 right-1"
          onClick={onRemove}
        />
      </div>
      {item.visual ? (
        <input
          aria-label={`Alt text for ${item.file.name}`}
          value={item.description}
          maxLength={MAX_ALT_TEXT_LENGTH}
          placeholder="Alt text"
          onChange={(e) => onDescribe(e.target.value)}
          className="h-8 w-full rounded-lg bg-surface-2 px-2 text-[13px] text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-brand"
        />
      ) : null}
    </li>
  );
}

export function NewPostComposer({ forum, info, initialTitle = '', onClose }: NewPostComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<PostFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per post being written: a retry after a lost reply cannot post it twice.
  const clientId = useRef(newClientId());
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const urls = useRef(new Set<string>());
  const bits = forum.spacePermissions ?? 0;
  const moderator = hasPerm(bits, PERM.MANAGE_MESSAGES);
  const canAttach = hasPerm(bits, PERM.ATTACH_FILES);
  const media = !!info.settings.media;
  const required = info.settings.requireTag && info.tags.length > 0;
  const picked = postTags(info, tags);
  const hasVisual = files.some((f) => f.visual);
  // The previews go with the form.
  useEffect(() => {
    const live = urls.current;
    return () => live.forEach((u) => revokeObjectUrl(u));
  }, []);

  const ready = title.trim().length > 0 && (media ? hasVisual : text.trim().length > 0 || files.length > 0);

  const addFiles = (list: File[]) => {
    if (!list.length || busy) return;
    if (!canAttach) return void toast.error(NO_UPLOAD_PERMISSION);
    const accepted = media ? list.filter(isVisualMedia) : list;
    if (accepted.length < list.length) toast.error('Only pictures and videos can be posted here');
    if (!accepted.length) return;
    if (files.length + accepted.length > MAX_ATTACHMENTS) toast.error(TOO_MANY_ATTACHMENTS);
    const room = accepted.slice(0, Math.max(0, MAX_ATTACHMENTS - files.length));
    const added = room.map((file): PostFile => {
      const visual = isVisualMedia(file);
      const url = visual ? previewUrl(file) : null;
      if (url) urls.current.add(url);
      return { id: `post-file-${++nextFileId}`, file, visual, url, description: '' };
    });
    setFiles((cur) => [...cur, ...added]);
    setError(null);
  };

  const removeFile = (id: string) => {
    const gone = files.find((f) => f.id === id);
    if (gone?.url) {
      revokeObjectUrl(gone.url);
      urls.current.delete(gone.url);
    }
    setFiles((cur) => cur.filter((f) => f.id !== id));
  };

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) return setError('Give your post a title.');
    if (media && !hasVisual) return setError('Add a picture or a video: every post here shows one.');
    if (!text.trim() && !files.length) return setError('Write a message or add a file.');
    if (required && picked.length === 0) return setError('This forum requires at least one tag.');
    setError(null);
    setBusy(true);
    try {
      const post = await useForums.getState().createPost(forum.id, {
        name: title,
        text,
        appliedTags: picked.map((t) => t.id),
        files: files.map((f) => ({ file: f.file, description: f.description })),
        clientId: clientId.current,
      });
      onClose();
      openThread(post.id, forum.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) return;
    e.preventDefault();
    addFiles(pasted);
  };
  // A drop on the form is ours (refused with a toast without ATTACH_FILES), never the browser's.
  const onDragOver = (e: DragEvent<HTMLFormElement>) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (canAttach) setDragging(true);
  };
  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    setDragging(false);
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
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
      className={cn('card-inset flex flex-col gap-3 p-4 transition-shadow', dragging && 'ring-2 ring-brand')}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
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
        onPaste={onPaste}
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
        placeholder={media ? 'Add a caption (optional)' : 'Enter a message'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onTextKey}
        onPaste={onPaste}
        data-testid="forum-post-text"
      />
      {files.length ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Files">
          {files.map((f) => (
            <FileTile
              key={f.id}
              item={f}
              onRemove={() => removeFile(f.id)}
              onDescribe={(description) =>
                setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, description } : x)))
              }
            />
          ))}
        </ul>
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
            <IconButton
              icon={media ? ImagePlus : Paperclip}
              label={media ? 'Add pictures or videos' : 'Add files'}
              variant="ghost"
              disabled={files.length >= MAX_ATTACHMENTS}
              onClick={() => fileRef.current?.click()}
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={media ? 'image/*,video/*' : undefined}
              hidden
              aria-label={media ? 'Pictures or videos' : 'Files'}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = '';
                addFiles(list);
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
