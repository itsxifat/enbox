/**
 * A post of the forum list (Discord's post cards). List: its tags, title, the author and the
 * first two lines of the post, then the default reaction with its count (a click reacts), the
 * reply count and the age of the last activity — or of the post, when sorted by creation —
 * with the post's image as a thumbnail. Gallery: the image (or the start of the text) leads.
 * The whole card opens the post beside the forum: its title is the button, stretched over the
 * card; the reaction stays clickable on top.
 */
import { EllipsisVertical, Link2, MessageSquare, MessagesSquare, Tag as TagIcon } from 'lucide-react';
import { PERM, hasPerm, type ChatSummary, type ForumInfo, type Message, type ReactionSummary } from '@enbox/shared';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { UserAvatar } from '@/components/common/UserAvatar';
import { DropdownMenu, IconButton, toast, type MenuEntry } from '@/components/ui';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { isMyReaction, sameReaction } from '@/features/conversation/bubbles/reactions/model';
import { copyThreadLink } from '@/features/threads/actions';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useForums, useFirstMessage, type ForumLayout, type ForumSort } from '@/stores/forums';
import { useSpaceAuthor } from '@/stores/spaces';
import { threadRights, useThreads } from '@/stores/threads';
import { useUserName } from '@/stores/users';
import { MAX_POST_TAGS, postTags, shortAgo } from './format';
import { TagPill } from './tags';

export interface PostCardProps {
  post: ChatSummary;
  forum: ForumInfo;
  sort: ForumSort;
  layout: ForumLayout;
  /** Open in the side panel. */
  active: boolean;
  onOpen: () => void;
}

/** The author as the Space shows them: nickname, else their name; their top role's colour. */
function AuthorName({ spaceId, userId }: { spaceId: string | undefined; userId: string }) {
  const author = useSpaceAuthor(spaceId, userId);
  const myName = useAuth((s) => s.user?.displayName);
  const name = useUserName(userId, { you: myName ?? 'You' });
  return (
    <span className="shrink-0 font-semibold text-fg" style={author?.color ? { color: author.color } : undefined}>
      {author?.nickname || name}
    </span>
  );
}

/** The reaction a card offers: the forum's default one, else the post's most used one. */
function cardReaction(forum: ForumInfo, first: Message | null): { emoji: string; summary: ReactionSummary | undefined } | null {
  const emoji = forum.settings.defaultReaction;
  if (emoji) return { emoji, summary: first?.reactions.find((r) => sameReaction(r.emoji, emoji)) };
  const top = first?.reactions.reduce<ReactionSummary | undefined>((a, r) => (!a || r.count > a.count ? r : a), undefined);
  return top ? { emoji: top.emoji, summary: top } : null;
}

function ReactionButton({ post, forum, first }: { post: ChatSummary; forum: ForumInfo; first: Message | null }) {
  const me = useAuth((s) => s.user?.id);
  const r = cardReaction(forum, first);
  if (!r) return null;
  const count = r.summary?.count ?? 0;
  const mine = !!first && isMyReaction(first, me, r.emoji);
  // A new emoji needs ADD_REACTIONS; joining one already there only needs to see it.
  const can =
    !!first && !first.deletedAt && post.membership === 'active' && (count > 0 || hasPerm(post.spacePermissions, PERM.ADD_REACTIONS));
  return (
    <button
      type="button"
      disabled={!can}
      aria-pressed={mine}
      aria-label={`${count} ${count === 1 ? 'reaction' : 'reactions'} with ${r.emoji}${mine ? ', including yours' : ''}`}
      onClick={() => {
        if (first) void useForums.getState().toggleReaction(post, first, r.emoji);
      }}
      className={cn(
        'relative z-10 inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[13px] font-semibold transition-colors disabled:cursor-default',
        mine ? 'bg-brand-soft text-brand-ink ring-1 ring-brand/50' : 'bg-surface text-muted enabled:hover:bg-line',
      )}
      data-testid="forum-post-reaction"
    >
      <EmojiGlyph emoji={r.emoji} size={16} />
      {count > 0 ? <span>{count}</span> : null}
    </button>
  );
}

/** "Name: the first lines of the post", the post's text as markdown (inline). */
function Preview({ post, first, className }: { post: ChatSummary; first: Message | null; className?: string }) {
  const ownerId = post.thread?.ownerId ?? post.createdBy;
  let body: React.ReactNode = null;
  if (first?.deletedAt) body = <span className="italic">The original post was deleted</span>;
  else if (first?.text) body = <RichText text={first.text} inline />;
  else if (first?.media) body = <span className="italic">{first.media.kind === 'image' ? 'Image' : 'Attachment'}</span>;
  if (!ownerId && !body) return null;
  return (
    <p className={cn('text-[14px] leading-5 break-words text-muted', className)} data-testid="forum-post-preview">
      {ownerId ? (
        <>
          <AuthorName spaceId={post.space?.spaceId} userId={ownerId} />
          {body ? ': ' : null}
        </>
      ) : null}
      {body}
    </p>
  );
}

function Meta({ post, forum, first, sort }: { post: ChatSummary; forum: ForumInfo; first: Message | null; sort: ForumSort }) {
  const count = post.thread?.messageCount ?? 0;
  const at = sort === 'created' ? post.createdAt : post.lastActivityAt;
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
      <ReactionButton post={post} forum={forum} first={first} />
      <span className="inline-flex items-center gap-1" aria-label={`${count} ${count === 1 ? 'reply' : 'replies'}`}>
        <MessageSquare size={15} aria-hidden />
        {count.toLocaleString()}
      </span>
      <span aria-hidden>·</span>
      <time dateTime={at} title={new Date(at).toLocaleString()}>
        {shortAgo(at)}
      </time>
    </div>
  );
}

/**
 * The card's "…" menu: Open Post, Edit Tags (the author while the post is unlocked, or a
 * moderator; moderated tags only for moderators) and Copy Link.
 */
function PostMenu({ post, forum, onOpen }: { post: ChatSummary; forum: ForumInfo; onOpen: () => void }) {
  const me = useAuth((s) => s.user?.id);
  const rights = threadRights(post, me);
  const worn = post.thread?.appliedTags ?? [];
  const known = postTags(forum, worn).map((t) => t.id);
  const spaceId = post.space?.spaceId;
  const parentId = post.thread?.parentId;
  const setTags = (ids: string[]) =>
    void useThreads
      .getState()
      .updateThread(post.id, { appliedTags: forum.tags.filter((t) => ids.includes(t.id)).map((t) => t.id) })
      .catch((e: unknown) => toast.error(e));
  const items: MenuEntry[] = [
    { label: 'Open Post', icon: MessagesSquare, onSelect: onOpen },
    rights.canEdit && forum.tags.length > 0 && {
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
      ? { label: 'Copy Link', icon: Link2, onSelect: () => copyThreadLink(spaceId, parentId, post.id) }
      : null,
  ];
  return (
    <DropdownMenu
      aria-label={`Options for ${post.name ?? 'post'}`}
      items={items}
      trigger={(p) => (
        <IconButton
          {...p}
          icon={EllipsisVertical}
          label="Post options"
          size="sm"
          variant="ghost"
          className={cn(
            'relative z-10 shrink-0',
            !p.active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        />
      )}
    />
  );
}

function TitleButton({ post, onOpen, className }: { post: ChatSummary; onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand",
        className,
      )}
    >
      {post.name}
    </button>
  );
}

export function PostCard({ post, forum, sort, layout, active, onOpen }: PostCardProps) {
  const first = useFirstMessage(post);
  const tags = postTags(forum, post.thread?.appliedTags);
  const image = first && !first.deletedAt && first.media?.kind === 'image' ? first.media : null;
  const src = image ? mediaUrl(image.thumbnailUrl ?? image.url) : undefined;
  const unread = post.lastReadSeq > 0 && post.lastSeq > post.lastReadSeq;
  const ownerId = post.thread?.ownerId ?? post.createdBy;
  const tagRow = tags.length ? (
    <div className="flex flex-wrap gap-1" aria-label="Tags">
      {tags.map((t) => (
        <TagPill key={t.id} tag={t} />
      ))}
    </div>
  ) : null;

  if (layout === 'gallery')
    return (
      <article
        className={cn(
          'card-inset group relative flex min-w-0 flex-col overflow-hidden transition-colors hover:bg-hover',
          active && 'ring-2 ring-brand',
        )}
        data-testid="forum-post-card"
        data-post-id={post.id}
        aria-current={active ? 'true' : undefined}
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface">
          {src ? (
            <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" data-testid="forum-post-cover" />
          ) : (
            <Preview post={post} first={first} className="line-clamp-6 p-3" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          {tagRow}
          <div className="flex min-w-0 items-start gap-1">
            <h3 className={cn('line-clamp-2 min-w-0 flex-1 text-[15px] leading-5 text-fg', unread ? 'font-extrabold' : 'font-bold')}>
              <TitleButton post={post} onOpen={onOpen} />
            </h3>
            <PostMenu post={post} forum={forum} onOpen={onOpen} />
          </div>
          <div className="mt-auto flex min-w-0 items-center gap-1.5 pt-1 text-[13px]">
            {ownerId ? <UserAvatar userId={ownerId} size={20} decorated={false} /> : null}
            {ownerId ? (
              <span className="min-w-0 truncate">
                <AuthorName spaceId={post.space?.spaceId} userId={ownerId} />
              </span>
            ) : null}
          </div>
          <Meta post={post} forum={forum} first={first} sort={sort} />
        </div>
      </article>
    );

  return (
    <article
      className={cn(
        'card-inset group relative flex min-w-0 gap-3 p-4 transition-colors hover:bg-hover',
        active && 'ring-2 ring-brand',
      )}
      data-testid="forum-post-card"
      data-post-id={post.id}
      aria-current={active ? 'true' : undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {tagRow}
        <div className="flex min-w-0 items-center gap-1">
          <h3 className={cn('flex min-w-0 flex-1 items-center gap-2 text-[16px] leading-6 text-fg', unread ? 'font-extrabold' : 'font-bold')}>
            {unread ? <span aria-label="New replies" className="size-2 shrink-0 rounded-full bg-brand" /> : null}
            <TitleButton post={post} onOpen={onOpen} className="min-w-0 truncate" />
          </h3>
          <PostMenu post={post} forum={forum} onOpen={onOpen} />
        </div>
        <div className="flex min-w-0 items-start gap-1.5">
          {ownerId ? <UserAvatar userId={ownerId} size={20} decorated={false} className="mt-px shrink-0" /> : null}
          <Preview post={post} first={first} className="line-clamp-2 min-w-0" />
        </div>
        <div className="mt-1">
          <Meta post={post} forum={forum} first={first} sort={sort} />
        </div>
      </div>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-20 shrink-0 self-center rounded-lg object-cover"
          data-testid="forum-post-thumbnail"
        />
      ) : null}
    </article>
  );
}
