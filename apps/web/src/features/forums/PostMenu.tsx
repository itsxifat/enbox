/**
 * A post's "…" menu on its card or tile (Discord's post menu), as my rights allow: Open Post,
 * Follow / Unfollow, Close / Reopen and Edit Title (the author while the post is unlocked, or
 * a moderator), Lock / Unlock and Pin / Unpin (moderators), Edit Tags (moderated tags only for
 * moderators), Copy Link, Download (its first file, unless the forum hides downloads) and
 * Delete Post (the author while unlocked, or a moderator; asks first). Also the marks a card
 * shows next to its tags: Pinned, Closed and Locked.
 */
import { useState } from 'react';
import {
  Archive,
  Download,
  EllipsisVertical,
  Link2,
  Lock,
  MessagesSquare,
  Pin,
  Tag as TagIcon,
} from 'lucide-react';
import type { ChatSummary, ForumInfo, Message } from '@enbox/shared';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { DropdownMenu, IconButton, toast, type MenuEntry } from '@/components/ui';
import { copyThreadLink, deleteThreadItem, threadMenuItems } from '@/features/threads/actions';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { threadRights, useThreads } from '@/stores/threads';
import { EditTitleDialog } from './EditTitleDialog';
import { MAX_POST_TAGS, postTags } from './format';
import { downloadFile, postFile } from './media';

export function PostMenu({
  post,
  forum,
  first,
  onOpen,
  overMedia = false,
}: {
  post: ChatSummary;
  forum: ForumInfo;
  first: Message | null;
  onOpen: () => void;
  /** On a picture: the glass button. */
  overMedia?: boolean;
}) {
  const me = useAuth((s) => s.user?.id);
  const [editing, setEditing] = useState(false);
  const rights = threadRights(post, me, { post: true });
  const worn = post.thread?.appliedTags ?? [];
  const known = postTags(forum, worn).map((t) => t.id);
  const spaceId = post.space?.spaceId;
  const parentId = post.thread?.parentId;
  const file = forum.settings.hideDownloads ? null : postFile(first);
  const setTags = (ids: string[]) =>
    void useThreads
      .getState()
      .updateThread(post.id, {
        appliedTags: forum.tags.filter((t) => ids.includes(t.id)).map((t) => t.id),
      })
      .catch((e: unknown) => toast.error(e));
  const items: MenuEntry[] = [
    { label: 'Open Post', icon: MessagesSquare, onSelect: onOpen },
    ...threadMenuItems(post, me, { post: true, onRename: () => setEditing(true) }),
    rights.canEdit &&
      forum.tags.length > 0 && {
        label: 'Edit Tags',
        icon: TagIcon,
        submenu: forum.tags.map((t) => {
          const on = known.includes(t.id);
          return {
            label: (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {t.emoji ? <EmojiGlyph emoji={t.emoji} size={16} /> : null}
                <span className="truncate">{t.name}</span>
              </span>
            ),
            checked: on,
            keepOpen: true,
            disabled: (t.moderated && !rights.moderator) || (!on && known.length >= MAX_POST_TAGS),
            onSelect: () => setTags(on ? known.filter((x) => x !== t.id) : [...known, t.id]),
          };
        }),
      },
    spaceId && parentId
      ? {
          label: 'Copy Link',
          icon: Link2,
          onSelect: () => copyThreadLink(spaceId, parentId, post.id),
        }
      : null,
    file ? { label: 'Download', icon: Download, onSelect: () => downloadFile(file) } : null,
    rights.canDelete && 'separator',
    rights.canDelete && deleteThreadItem(post, 'Post'),
  ];
  return (
    <>
      <DropdownMenu
        aria-label={`Options for ${post.name ?? 'post'}`}
        items={items}
        trigger={(p) => (
          <IconButton
            {...p}
            icon={EllipsisVertical}
            label="Post options"
            size="sm"
            variant={overMedia ? 'glass' : 'ghost'}
            className={cn(
              'relative z-10 shrink-0',
              !p.active &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          />
        )}
      />
      {editing ? <EditTitleDialog post={post} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

/** The marks of a post: Pinned (the forum's top post), Closed and Locked. */
export function PostMarks({ post, className }: { post: ChatSummary; className?: string }) {
  const info = post.thread;
  if (!info?.pinned && !info?.archived && !info?.locked) return null;
  const mark =
    'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-semibold';
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {info.pinned ? (
        <span className={cn(mark, 'bg-brand-soft text-brand-ink')} data-testid="post-pinned">
          <Pin size={12} aria-hidden />
          Pinned
        </span>
      ) : null}
      {info.archived ? (
        <span className={cn(mark, 'bg-surface-2 text-muted')} data-testid="post-closed">
          <Archive size={12} aria-hidden />
          Closed
        </span>
      ) : null}
      {info.locked ? (
        <span className={cn(mark, 'bg-surface-2 text-muted')} data-testid="post-locked">
          <Lock size={12} aria-hidden />
          Locked
        </span>
      ) : null}
    </span>
  );
}
