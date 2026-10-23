/**
 * The read-only message view of a Space preview: the newest messages of one channel
 * (`GET /api/spaces/:spaceId/preview/channels/:channelId/messages`) in the Discord rows of Space
 * channels (avatar, name and time per sender group), built from the conversation's own pieces
 * (`MessageContent`, quotes, embeds, day separators, system pills) — without the toolbar,
 * menus, gestures, reaction chips to press or votes: nothing here writes. Photos and videos
 * open in a plain viewer. Pages already fetched are kept in `cache` (the route is
 * rate-limited).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Megaphone, RefreshCw } from 'lucide-react';
import type {
  ChatPermissions,
  ChatSummary,
  ID,
  Message,
  SpacePreview,
  SpacePreviewMessages,
} from '@enbox/shared';
import { Button, EmptyState, Modal, Skeleton } from '@/components/ui';
import {
  BubbleHeader,
  MessageContent,
  SenderAvatar,
  SenderName,
  rowShape,
} from '@/features/conversation/MessageRow';
import { visualFiles } from '@/features/conversation/bubbles/attachments';
import { ReactionEmoji } from '@/features/conversation/bubbles/reactions/ReactionEmoji';
import { reactionLabel } from '@/features/conversation/bubbles/reactions/model';
import { DaySeparator, SystemPill } from '@/features/conversation/bubbles/SystemPill';
import { buildRows, type Row } from '@/features/conversation/lib/rows';
import { useConversationUi } from '@/features/conversation/state';
import {
  CrosspostSource,
  OverrideAuthorName,
  OverrideAvatar,
} from '@/features/webhooks/OverrideAuthor';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';

export type PreviewChannel = SpacePreview['channels'][number];

/** What the server sends at most (PREVIEW_MESSAGE_LIMIT): a full page means older ones exist. */
export const PREVIEW_PAGE = 50;

const READ_ONLY: ChatPermissions = {
  canSend: false,
  canEditInfo: false,
  canAddMembers: false,
  canRemoveMembers: false,
  canManageAdmins: false,
  canPin: false,
  canCall: false,
  canInvite: false,
  canDeleteForEveryoneAsAdmin: false,
  canLeave: false,
  canViewMembers: false,
};
const EPOCH = new Date(0).toISOString();

/**
 * The stand-in chat the message pieces render against: a Space text channel I am not in
 * (`membership` other than active and no permissions switch off votes, embed removal and the
 * like), with the channel's topic and announcement flag.
 */
export function previewChat(spaceId: ID, c: PreviewChannel): ChatSummary {
  return {
    id: c.id,
    type: 'space_text',
    name: c.name,
    description: null,
    avatarUrl: null,
    peer: null,
    communityId: null,
    isAnnouncement: false,
    memberCount: 0,
    groupSettings: null,
    channelSettings: null,
    myRole: 'member',
    membership: 'left',
    permissions: READ_ONLY,
    inviteCode: null,
    disappearingSeconds: null,
    sharedTheme: null,
    lastMessage: null,
    lastSeq: 0,
    lastReadSeq: 0,
    unreadCount: 0,
    unreadMentionCount: 0,
    readWatermark: 0,
    deliveredWatermark: 0,
    isPinned: false,
    isArchived: false,
    mutedUntil: null,
    markedUnread: false,
    theme: null,
    wallpaper: null,
    space: {
      spaceId,
      categoryId: null,
      position: 0,
      topic: c.topic,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
      isNews: c.isNews,
    },
    spacePermissions: 0,
    notifyLevel: null,
    createdAt: EPOCH,
    createdBy: null,
    lastActivityAt: EPOCH,
  };
}

/** Reaction counts, not buttons. */
function Reactions({ reactions }: { reactions: Message['reactions'] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-1 px-1" aria-label="Reactions">
      {reactions.map((r) => (
        <li
          key={r.emoji}
          className="inline-flex h-6 items-center gap-1 rounded-lg bg-surface-2 px-1.5 text-[13px] font-semibold text-muted"
          aria-label={`${reactionLabel(r.emoji)} ${r.count}`}
        >
          <ReactionEmoji emoji={r.emoji} size={16} />
          <span className="tabular-nums" aria-hidden>
            {r.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One message, laid out like `CozyMessageRow` but read-only. */
function PreviewRow({
  row,
  chat,
  myName,
  onJump,
}: {
  row: Row;
  chat: ChatSummary;
  myName: string;
  onJump: (seq: number, messageId: string) => void;
}) {
  const m = row.message;
  if (m.type === 'system') {
    return (
      <div data-testid="preview-message" data-type="system" data-message-id={m.id}>
        {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
        <SystemPill m={m} chat={chat} />
      </div>
    );
  }
  const shape = rowShape(m, false);
  const { deleted, bare, visual } = shape;
  // No user sent it: a webhook or a crosspost shows as its author override.
  const override = m.authorOverride ?? null;
  const header = row.firstInGroup && (!!m.senderId || !!override);
  const reactions = m.reactions.length > 0 && !deleted;
  return (
    <div data-testid="preview-message" data-message-id={m.id} data-type={m.type}>
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      <div
        className={cn(
          'group/msg relative flex items-start gap-3 px-3 hover:bg-fg/[0.04] lg:px-5',
          row.firstInGroup ? 'msg-group-start-cozy pt-0.5' : 'pt-px',
          reactions ? 'pb-1' : 'pb-px',
        )}
      >
        <span className="w-10 shrink-0 self-start">
          {header && override ? (
            <OverrideAvatar override={override} selecting={false} size={40} />
          ) : header ? (
            <SenderAvatar userId={m.senderId!} selecting={false} size={40} />
          ) : (
            <span
              className="block pt-1 text-right text-[10.5px] leading-4 text-muted opacity-0 group-hover/msg:opacity-100"
              aria-hidden
            >
              {formatTime(m.createdAt)}
            </span>
          )}
        </span>
        <div className="relative min-w-0 flex-1">
          {header ? (
            <div className="flex items-baseline gap-2">
              {override ? (
                <OverrideAuthorName
                  override={override}
                  selecting={false}
                  className="text-[14.5px]"
                />
              ) : (
                <SenderName
                  userId={m.senderId!}
                  selecting={false}
                  you={myName}
                  className="text-[14.5px]"
                />
              )}
              <span className="shrink-0 text-[11.5px] text-muted">{formatTime(m.createdAt)}</span>
            </div>
          ) : null}
          {header && override?.kind === 'crosspost' && override.source ? (
            <CrosspostSource source={override.source} />
          ) : null}
          <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
          <div className={cn(!bare && (visual ? 'max-w-[min(100%,480px)]' : 'max-w-[720px]'))}>
            <MessageContent m={m} mine={row.mine} chat={chat} search={null} shape={shape} />
            {m.editedAt && !m.deletedAt ? (
              <span
                className="ml-1 text-[11px] text-subtle"
                title={new Date(m.editedAt).toLocaleString()}
              >
                (edited)
              </span>
            ) : null}
          </div>
          {reactions ? <Reactions reactions={m.reactions} /> : null}
        </div>
      </div>
    </div>
  );
}

/** A photo or video of a previewed message, opened from it (the conversation's viewer needs a chat). */
function PreviewViewer({ chatId, messages }: { chatId: ID; messages: readonly Message[] }) {
  const viewer = useConversationUi((s) => (s.viewer?.chatId === chatId ? s.viewer : null));
  const m = viewer ? messages.find((x) => x.id === viewer.messageId) : undefined;
  const file = m ? visualFiles(m)[viewer?.index ?? 0] : undefined;
  const close = useCallback(() => useConversationUi.getState().openViewer(null), []);
  // Leaving the channel never leaves its viewer open for a conversation to pick up.
  useEffect(
    () => () => {
      if (useConversationUi.getState().viewer?.chatId === chatId) close();
    },
    [chatId, close],
  );
  return (
    <Modal
      open={!!file}
      onClose={close}
      size="xl"
      sheetOnMobile={false}
      aria-label="Media viewer"
      bodyClassName="p-0"
    >
      {file ? (
        file.kind === 'video' ? (
          <video
            src={mediaUrl(file.url)}
            controls
            autoPlay
            className="max-h-[75vh] w-full bg-black"
          />
        ) : (
          <img
            src={mediaUrl(file.url)}
            alt={file.description ?? ''}
            className="max-h-[75vh] w-full object-contain"
          />
        )
      ) : null}
    </Modal>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-5 px-3 py-4 lg:px-5" aria-hidden>
      {['w-3/5', 'w-5/6', 'w-2/5', 'w-2/3'].map((w, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton circle className="size-10 shrink-0" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className={cn('h-3', w)} />
          </div>
        </div>
      ))}
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; messages: Message[] }
  | { status: 'error'; message: string };

/** The messages of `channel`, newest at the bottom (the scroller starts there). */
export function PreviewMessages({
  spaceId,
  channel,
  cache,
}: {
  spaceId: ID;
  channel: PreviewChannel;
  /** Pages fetched while the preview is open, by channel id. */
  cache: Map<ID, Message[]>;
}) {
  const [state, setState] = useState<Load>(() => {
    const hit = cache.get(channel.id);
    return hit ? { status: 'ready', messages: hit } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  const me = useAuth((s) => s.user?.id);
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => {
    const hit = cache.get(channel.id);
    if (hit) {
      setState({ status: 'ready', messages: hit });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    api
      .get<SpacePreviewMessages>(`/api/spaces/${spaceId}/preview/channels/${channel.id}/messages`, {
        signal: ctrl.signal,
      })
      .then((page) => {
        cache.set(channel.id, page.messages);
        setState({ status: 'ready', messages: page.messages });
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [spaceId, channel.id, cache, attempt]);

  const chat = useMemo(() => previewChat(spaceId, channel), [spaceId, channel]);
  const messages = state.status === 'ready' ? state.messages : null;
  const rows = useMemo(
    () =>
      messages
        ? buildRows(messages, { meId: me, hasMoreBefore: messages.length >= PREVIEW_PAGE })
        : [],
    [messages, me],
  );
  // Reply quotes jump to the quoted message when it is among these.
  const onJump = useCallback((_seq: number, messageId: string) => {
    scroller.current
      ?.querySelector(`[data-message-id="${messageId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  if (state.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          icon={RefreshCw}
          title="Couldn’t load messages"
          description={state.message}
          action={
            <Button variant="soft" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const Icon = channel.isNews ? Megaphone : Hash;
  const more = !!messages && messages.length >= PREVIEW_PAGE;
  return (
    <section
      ref={scroller}
      aria-label={`Messages in ${channel.name}`}
      aria-busy={state.status === 'loading' || undefined}
      className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto scrollbar-thin"
      data-testid="preview-messages"
    >
      {/* column-reverse: the view starts (and stays) at the newest message as images load. */}
      <div className="pb-3">
        {!messages ? (
          <LoadingRows />
        ) : more ? (
          <p className="mx-3 mt-3 rounded-lg bg-surface-2 px-3 py-2 text-center text-[13px] text-muted lg:mx-5">
            These are the latest messages. Join to read the whole history.
          </p>
        ) : (
          <div className="px-3 pt-8 pb-2 lg:px-5">
            <span className="flex size-16 items-center justify-center rounded-full bg-surface-2 text-fg">
              <Icon size={34} aria-hidden />
            </span>
            <h3 className="mt-3 text-[26px] leading-tight font-extrabold text-fg">
              Welcome to #{channel.name}!
            </h3>
            <p className="mt-1 text-[15px] text-muted">
              This is the start of the #{channel.name} channel.
            </p>
          </div>
        )}
        {rows.map((row) => (
          <PreviewRow key={row.key} row={row} chat={chat} myName={myName} onJump={onJump} />
        ))}
      </div>
      {messages ? <PreviewViewer chatId={channel.id} messages={messages} /> : null}
    </section>
  );
}
