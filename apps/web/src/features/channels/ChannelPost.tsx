/**
 * One channel post (channel identity, no sender names/ticks): text, media, polls, location,
 * contact cards, reactions (counts only) and admin actions.
 */
import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  Clock3,
  Copy,
  Download,
  EllipsisVertical,
  FileText,
  MapPin,
  Pencil,
  RotateCcw,
  SmilePlus,
  Star,
  StarOff,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  canDeleteForEveryone,
  canEditMessage,
  formatBytes,
  renderMentions,
  systemEventText,
  type ChatSummary,
  type Message,
} from '@enbox/shared';
import { IconButton, Menu, confirm, toast, type MenuAnchor, type MenuEntry } from '@/components/ui';
import { Lightbox } from '@/features/groups/shared/MediaGallery';
import { RichText } from '@/features/groups/shared/RichText';
import { copyText } from '@/features/groups/shared/share';
import { EditTextModal } from '@/features/groups/shared/dialogs';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { fitWithin } from '@/lib/media';
import { getMyId } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { isActionable, retry, setStarred } from '@/features/conversation/actions';
import { nameOf } from '@/stores/users';
import { deletePost, editPost, reactToPost, voteInPoll } from './channelApi';
import { ReactionPicker } from './ReactionPicker';

export interface PostContext {
  /** The followed chat (null in the non-follower preview). */
  chat: ChatSummary | null;
  /** 'none' also for previews (not following). */
  reactions: 'all' | 'quick' | 'none';
  /** Can vote in polls (following). */
  canVote: boolean;
}

export function SystemChip({ m }: { m: Message }) {
  return (
    <div className="my-2 self-center rounded-xl bg-surface/90 px-3 py-1 text-center text-[12.5px] text-muted shadow-bubble backdrop-blur">
      {m.system ? systemEventText(m.system, (id) => nameOf(id), 'channel') : ''}
    </div>
  );
}

export function ChannelPost({ m, ctx }: { m: ClientMessage; ctx: PostContext }) {
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const me = getMyId() ?? '';
  const chat = ctx.chat;
  const canReact = ctx.reactions !== 'none' && !m.deletedAt && !m.pending && !m.failed && !!chat;
  const canEdit = !!chat && !m.pending && canEditMessage(m, chat, me);
  const canDelete = !!chat && !m.pending && canDeleteForEveryone(m, chat, me);
  // Any follower can star a visible post (the channel info "Starred messages" page lists them).
  const canStar = !!chat && isActionable(m) && !m.deletedAt;
  const text = m.text ? renderMentions(m.text, (id) => nameOf(id)) : '';

  const react = (emoji: string | null) => {
    void reactToPost(m, emoji).catch((e: unknown) => toast.error(e));
  };

  const items: MenuEntry[] = [
    canReact && {
      label: 'React',
      icon: SmilePlus,
      onSelect: () => {
        const el = document.getElementById(`post-${m.id}`);
        if (el) setPicker(el);
      },
    },
    !!text && {
      label: 'Copy text',
      icon: Copy,
      onSelect: () => void copyText(text).then((ok) => ok && toast.success('Copied')),
    },
    canStar && {
      label: m.starred ? 'Unstar' : 'Star',
      icon: m.starred ? StarOff : Star,
      onSelect: () => void setStarred([m], !m.starred),
    },
    canEdit && { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true) },
    canDelete && {
      label: 'Delete for everyone',
      icon: Trash2,
      danger: true,
      onSelect: () =>
        void confirm({
          title: 'Delete this post?',
          message: 'It will be deleted for all followers.',
          confirmLabel: 'Delete',
          danger: true,
        }).then((ok) => {
          if (ok) void deletePost(m).catch((e: unknown) => toast.error(e));
        }),
    },
  ];
  const hasMenu = items.some(Boolean);
  // Followers get the options button too (Star, Copy text), not only admins (Edit, Delete).
  const showMore = !!chat && hasMenu;

  const onContextMenu = (e: MouseEvent) => {
    if (!hasMenu) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <article
      className="group/post relative flex max-w-full flex-col items-start self-start"
      aria-label="Post"
      data-testid="channel-post"
      data-message-id={m.id}
      data-seq={m.seq || undefined}
    >
      <div className="flex max-w-full items-end gap-1.5">
        <div
          id={`post-${m.id}`}
          onContextMenu={onContextMenu}
          className={cn(
            'relative w-fit max-w-[min(88vw,520px)] overflow-hidden rounded-2xl rounded-tl-md bg-bubble-in text-fg shadow-bubble',
            m.failed && 'ring-1 ring-danger',
          )}
        >
          {m.deletedAt ? (
            <p className="px-3 py-2 text-chat text-muted italic">This post was deleted</p>
          ) : (
            <>
              <PostMedia m={m} onOpen={() => setLightbox(true)} />
              {m.type === 'poll' && m.poll ? <PollView m={m} canVote={ctx.canVote} /> : null}
              {m.type === 'location' && m.location ? <LocationCard m={m} /> : null}
              {m.type === 'contact' && m.contact ? <ContactCard m={m} /> : null}
              {text ? (
                <div className="px-3 pt-2 text-chat leading-snug">
                  <RichText text={text} />
                </div>
              ) : null}
            </>
          )}
          <div className="flex items-center justify-end gap-1 px-3 pt-0.5 pb-1.5 text-[11px] text-bubble-in-meta">
            {m.editedAt && !m.deletedAt ? <span>Edited</span> : null}
            <span>{m.pending || m.failed ? '' : formatTime(m.createdAt)}</span>
            {m.pending ? <Clock3 size={12} aria-label="Sending" /> : null}
            {m.failed ? (
              <button
                type="button"
                onClick={() => retry(m.chatId, m)}
                className="flex items-center gap-1 font-medium text-danger"
              >
                <AlertCircle size={12} aria-hidden /> Failed · Retry
                <RotateCcw size={11} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
        {canReact || showMore ? (
          <div className="flex shrink-0 flex-col gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover/post:opacity-100 lg:group-focus-within/post:opacity-100">
            {showMore ? (
              <IconButton
                icon={EllipsisVertical}
                label="Post options"
                size="sm"
                variant="ghost"
                className="bg-surface/70 backdrop-blur"
                aria-haspopup="menu"
                onClick={(e) => setMenu(e.currentTarget)}
              />
            ) : null}
            {canReact ? (
              <IconButton
                icon={SmilePlus}
                label="React"
                size="sm"
                variant="ghost"
                className="bg-surface/70 backdrop-blur"
                onClick={(e) =>
                  setPicker(document.getElementById(`post-${m.id}`) ?? e.currentTarget)
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <Reactions m={m} canReact={canReact} onToggle={(anchor) => setPicker(anchor)} />
      {canReact ? (
        <ReactionPicker
          anchor={picker}
          mode={ctx.reactions === 'all' ? 'all' : 'quick'}
          current={m.myReaction ?? null}
          onPick={react}
          onClose={() => setPicker(null)}
        />
      ) : null}
      <Menu
        open={!!menu}
        anchor={menu}
        onClose={() => setMenu(null)}
        items={items}
        aria-label="Post options"
      />
      {canEdit ? (
        <EditTextModal
          open={editing}
          onClose={() => setEditing(false)}
          title="Edit post"
          label={m.type === 'text' ? 'Text' : 'Caption'}
          initial={m.text ?? ''}
          maxLength={m.type === 'text' ? 65536 : 4096}
          multiline
          required={m.type === 'text'}
          onSave={async (v) => {
            await editPost(m, v);
            toast.success('Post edited');
          }}
        />
      ) : null}
      <Lightbox message={lightbox ? m : null} onClose={() => setLightbox(false)} />
    </article>
  );
}

function Reactions({
  m,
  canReact,
  onToggle,
}: {
  m: Message;
  canReact: boolean;
  onToggle: (anchor: HTMLElement) => void;
}) {
  if (!m.reactions.length || m.deletedAt) return null;
  const total = m.reactions.reduce((n, r) => n + r.count, 0);
  const top = [...m.reactions].sort((a, b) => b.count - a.count).slice(0, 4);
  const content: ReactNode = (
    <>
      {top.map((r) => (
        <span key={r.emoji} className="text-[15px] leading-none">
          {r.emoji}
        </span>
      ))}
      <span className="ml-0.5 text-[12px] font-medium text-muted tabular-nums">{total}</span>
    </>
  );
  const cls = cn(
    'relative z-[1] -mt-1.5 ml-2 inline-flex h-7 items-center gap-1 rounded-full border border-line bg-elevated px-2 shadow-bubble',
    m.myReaction && 'border-brand/50 bg-brand-soft',
  );
  if (!canReact)
    return (
      <span className={cls} aria-label={`${total} reactions`}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      className={cn(cls, 'hover:brightness-95 focus-visible:outline-2 focus-visible:outline-brand')}
      onClick={(e) => onToggle(e.currentTarget)}
      aria-label={`${total} reactions${m.myReaction ? `, you reacted ${m.myReaction}` : ''}. Change reaction`}
    >
      {content}
    </button>
  );
}

function PostMedia({ m, onOpen }: { m: ClientMessage; onOpen: () => void }) {
  const media = m.media;
  if (!media && !m.localUrl) return null;
  if (m.type === 'image') {
    const size = fitWithin(media?.width ?? 0, media?.height ?? 0, 520, 440);
    const src = m.localUrl ?? mediaUrl(media?.url);
    return (
      <button
        type="button"
        onClick={onOpen}
        className="relative block max-w-full overflow-hidden bg-surface-2"
        style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
        aria-label="Open photo"
      >
        <img src={src} alt={m.text ?? ''} className="size-full object-cover" loading="lazy" />
        {m.uploadProgress !== undefined && m.pending ? (
          <UploadVeil value={m.uploadProgress} />
        ) : null}
      </button>
    );
  }
  if (m.type === 'video') {
    const size = fitWithin(media?.width ?? 0, media?.height ?? 0, 520, 440);
    return (
      <div
        className="relative max-w-full bg-black"
        style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
      >
        <video
          src={m.localUrl ?? mediaUrl(media?.url)}
          poster={mediaUrl(media?.thumbnailUrl)}
          controls
          preload="metadata"
          className="size-full"
        />
        {m.uploadProgress !== undefined && m.pending ? (
          <UploadVeil value={m.uploadProgress} />
        ) : null}
      </div>
    );
  }
  if (m.type === 'audio' || m.type === 'voice') {
    return (
      <div className="px-3 pt-3">
        <audio
          src={m.localUrl ?? mediaUrl(media?.url)}
          controls
          preload="metadata"
          className="w-[min(72vw,320px)]"
        />
      </div>
    );
  }
  if (m.type === 'file' && media) {
    return (
      <a
        href={mediaUrl(media.url)}
        target="_blank"
        rel="noopener noreferrer"
        download={media.fileName ?? undefined}
        className="m-1.5 flex min-w-[240px] items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 hover:brightness-95"
      >
        <FileText size={26} className="shrink-0 text-brand-ink" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium">
            {media.fileName ?? 'Document'}
          </span>
          <span className="block text-[12px] text-muted">{formatBytes(media.size)}</span>
        </span>
        <Download size={18} className="shrink-0 text-muted" aria-hidden />
      </a>
    );
  }
  return null;
}

function UploadVeil({ value }: { value: number }) {
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-semibold text-white">
      {Math.round(value * 100)}%
    </span>
  );
}

function LocationCard({ m }: { m: Message }) {
  const l = m.location!;
  const href = `https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=16/${l.latitude}/${l.longitude}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="m-1.5 flex min-w-[240px] items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 hover:brightness-95"
    >
      <MapPin size={24} className="shrink-0 text-danger" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-medium">{l.name ?? 'Location'}</span>
        <span className="block truncate text-[12px] text-muted">
          {l.address ?? `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`}
        </span>
      </span>
    </a>
  );
}

function ContactCard({ m }: { m: Message }) {
  const c = m.contact!;
  return (
    <div className="m-1.5 flex min-w-[220px] items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
        <UserRound size={20} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-medium">{c.name}</span>
        <span className="block truncate text-[12px] text-muted">
          {c.phone ?? (c.username ? `@${c.username}` : '')}
        </span>
      </span>
    </div>
  );
}

function PollView({ m, canVote }: { m: Message; canVote: boolean }) {
  const poll = m.poll!;
  const mine = new Set(poll.myOptionIds ?? []);
  const max = Math.max(1, ...poll.options.map((o) => o.voteCount));
  const vote = (id: string) => {
    let next: string[];
    if (poll.allowMultiple) next = mine.has(id) ? [...mine].filter((x) => x !== id) : [...mine, id];
    else next = mine.has(id) ? [] : [id];
    void voteInPoll(m, next).catch((e: unknown) => toast.error(e));
  };
  return (
    <div className="min-w-[260px] px-3 pt-3" role="group" aria-label={`Poll: ${poll.question}`}>
      <p className="text-[15.5px] leading-snug font-semibold">{poll.question}</p>
      <p className="mt-0.5 text-[12px] text-muted">
        {poll.allowMultiple ? 'Select one or more' : 'Select one'}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {poll.options.map((o) => {
          const selected = mine.has(o.id);
          const pct = poll.totalVoters ? Math.round((o.voteCount / poll.totalVoters) * 100) : 0;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={!canVote || !!m.deletedAt}
                onClick={() => vote(o.id)}
                role={poll.allowMultiple ? 'checkbox' : 'radio'}
                aria-checked={selected}
                aria-label={`${o.text}, ${o.voteCount} ${o.voteCount === 1 ? 'vote' : 'votes'}`}
                className="group/opt flex w-full items-start gap-2.5 rounded-lg py-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default"
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 transition-colors',
                    poll.allowMultiple ? 'rounded-md' : 'rounded-full',
                    selected ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
                  )}
                  aria-hidden
                >
                  {selected ? <Check size={12} strokeWidth={3.5} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[14.5px]">{o.text}</span>
                    <span className="text-[12.5px] font-medium text-muted tabular-nums">
                      {o.voteCount}
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={cn(
                        'block h-full rounded-full transition-[width] duration-300',
                        selected ? 'bg-brand' : 'bg-brand/40',
                      )}
                      style={{
                        width: `${o.voteCount ? Math.max(4, (o.voteCount / max) * 100) : 0}%`,
                      }}
                      title={`${pct}%`}
                    />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-center text-[12.5px] text-muted">
        {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
      </p>
    </div>
  );
}
