/**
 * One channel post (web features/channels/ChannelPost.tsx): channel identity (no sender
 * names/ticks), text, media, polls, location, contact cards, reactions (counts only) and the
 * post actions (react, copy, star, edit, delete) from the side buttons or a long press.
 */
import { memo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import {
  AlertCircle,
  Check,
  Clock3,
  Copy,
  EllipsisVertical,
  Pencil,
  Plus,
  RotateCcw,
  SmilePlus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react-native';
import {
  QUICK_REACTIONS,
  canDeleteForEveryone,
  canEditMessage,
  renderMentions,
  systemEventText,
} from '@enbox/shared';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { ActionSheet, IconButton, Modal, Press, T, confirm, toast } from '@/components/ui';
import { isActionable, retry, setStarred } from '@/features/conversation/actions';
import { AudioFileBody, VoiceBody } from '@/features/conversation/bubbles/AudioBody';
import { ContactBody, FileBody, LocationBody } from '@/features/conversation/bubbles/CardBodies';
import { MediaBody } from '@/features/conversation/bubbles/MediaBody';
import { RichText } from '@/features/conversation/bubbles/Text';
import { useConversationUi } from '@/features/conversation/state';
import { EmojiPanel } from '@/features/emoji/EmojiPanel';
import { EditTextModal } from '@/features/groups/shared/dialogs';
import { copyText } from '@/features/groups/shared/share';
import { formatTime } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { nameOf } from '@/stores/users';
import { alpha, useTheme } from '@/theme';
import { deletePost, editPost, reactToPost, voteInPoll } from './channelApi';

export function SystemChip({ m }) {
  const { tw, c, shadow } = useTheme();
  return (
    <View
      style={[
        tw`my-2 self-center rounded-xl px-3 py-1`,
        { backgroundColor: alpha(c.surface, 0.9) },
        shadow.bubble,
      ]}
    >
      <T style={tw`text-center text-[12.5px] text-muted`}>
        {m.system ? systemEventText(m.system, (id) => nameOf(id), 'channel') : ''}
      </T>
    </View>
  );
}

/** Quick reactions strip + "more" (the full emoji panel) for a post. */
function ReactionStrip({ current, mode, onPick, onMore }) {
  const { tw, c } = useTheme();
  return (
    <View style={tw`flex-row items-center justify-between rounded-full bg-surface-2 p-1`}>
      {QUICK_REACTIONS.map((e) => (
        <Press
          key={e}
          accessibilityLabel={current === e ? `Remove reaction ${e}` : `React ${e}`}
          onPress={() => onPick(current === e ? null : e)}
          style={[
            tw`size-11 items-center justify-center rounded-full`,
            current === e ? tw`bg-brand-soft` : null,
          ]}
        >
          <T style={{ fontSize: 24, lineHeight: 30 }}>{e}</T>
        </Press>
      ))}
      {mode === 'all' ? (
        <Press
          accessibilityLabel="More reactions"
          onPress={onMore}
          style={tw`size-11 items-center justify-center rounded-full`}
        >
          <Icon icon={Plus} size={22} color={c.muted} />
        </Press>
      ) : null}
    </View>
  );
}

export const ChannelPost = memo(function ChannelPost({ m, ctx }) {
  const { tw, c, shadow, chatFontSize } = useTheme();
  const { width: vw } = useWindowDimensions();
  const [sheet, setSheet] = useState(null); // 'menu' | 'react'
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const me = getMyId() ?? '';
  const chat = ctx.chat;
  const canReact = ctx.reactions !== 'none' && !m.deletedAt && !m.pending && !m.failed && !!chat;
  const canEdit = !!chat && !m.pending && canEditMessage(m, chat, me);
  const canDelete = !!chat && !m.pending && canDeleteForEveryone(m, chat, me);
  const canStar = !!chat && isActionable(m) && !m.deletedAt;
  const text = m.text ? renderMentions(m.text, (id) => nameOf(id)) : '';
  const maxWidth = Math.min(vw * 0.88, 520) - 48;

  const react = (emoji) => {
    void reactToPost(m, emoji).catch((e) => toast.error(e));
  };

  const items = [
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
          if (ok) void deletePost(m).catch((e) => toast.error(e));
        }),
    },
  ];
  const hasMenu = items.some(Boolean) || canReact;
  const showMore = !!chat && items.some(Boolean);
  const openViewer = () =>
    chat && useConversationUi.getState().openViewer({ chatId: chat.id, messageId: m.id });

  return (
    <View style={tw`max-w-full items-start self-start`} accessibilityLabel="Post">
      <View style={tw`max-w-full flex-row items-end gap-1.5`}>
        <Press
          feedback={false}
          onLongPress={hasMenu && chat ? () => setSheet('menu') : undefined}
          delayLongPress={400}
          style={[
            tw`overflow-hidden rounded-2xl bg-bubble-in`,
            { borderTopLeftRadius: 6, maxWidth },
            m.failed ? { borderWidth: 1, borderColor: c.danger } : null,
            shadow.bubble,
          ]}
        >
          {m.deletedAt ? (
            <T style={[tw`px-3 py-2 text-muted`, { fontStyle: 'italic', fontSize: chatFontSize }]}>
              This post was deleted
            </T>
          ) : (
            <>
              <PostMedia m={m} maxWidth={maxWidth} onOpen={openViewer} />
              {m.type === 'poll' && m.poll ? <PollView m={m} canVote={ctx.canVote} /> : null}
              {m.type === 'location' && m.location ? (
                <View style={tw`p-1.5`}>
                  <LocationBody m={m} width={maxWidth - 12} />
                </View>
              ) : null}
              {m.type === 'contact' && m.contact ? (
                <View style={tw`p-1.5`}>
                  <ContactBody m={m} width={maxWidth - 12} />
                </View>
              ) : null}
              {text ? (
                <View style={tw`px-3 pt-2`}>
                  <T style={{ fontSize: chatFontSize, lineHeight: chatFontSize * 1.375 }}>
                    <RichText text={text} />
                  </T>
                </View>
              ) : null}
            </>
          )}
          <View style={tw`flex-row items-center justify-end gap-1 px-3 pt-0.5 pb-1.5`}>
            {m.editedAt && !m.deletedAt ? (
              <T style={[tw`text-[11px]`, { color: c['bubble-in-meta'] }]}>Edited</T>
            ) : null}
            <T style={[tw`text-[11px]`, { color: c['bubble-in-meta'] }]}>
              {m.pending || m.failed ? '' : formatTime(m.createdAt)}
            </T>
            {m.pending ? <Icon icon={Clock3} size={12} color={c['bubble-in-meta']} /> : null}
            {m.failed ? (
              <Press
                feedback={false}
                onPress={() => retry(m.chatId, m)}
                style={tw`flex-row items-center gap-1`}
              >
                <Icon icon={AlertCircle} size={12} color={c.danger} />
                <T style={tw`text-[11px] font-medium text-danger`}>Failed · Retry</T>
                <Icon icon={RotateCcw} size={12} color={c.danger} />
              </Press>
            ) : null}
          </View>
        </Press>
        {canReact || showMore ? (
          <View style={tw`gap-1`}>
            {showMore ? (
              <IconButton
                icon={EllipsisVertical}
                label="Post options"
                size="sm"
                style={{ backgroundColor: alpha(c.surface, 0.7) }}
                onPress={() => setSheet('menu')}
              />
            ) : null}
            {canReact ? (
              <IconButton
                icon={SmilePlus}
                label="React"
                size="sm"
                style={{ backgroundColor: alpha(c.surface, 0.7) }}
                onPress={() => setSheet('react')}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      <Reactions m={m} canReact={canReact} onPress={() => setSheet('react')} />
      <ActionSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        header={
          canReact ? (
            <ReactionStrip
              current={m.myReaction ?? null}
              mode={ctx.reactions === 'all' ? 'all' : 'quick'}
              onPick={(e) => {
                setSheet(null);
                react(e);
              }}
              onMore={() => {
                setSheet(null);
                setEmojiOpen(true);
              }}
            />
          ) : null
        }
        items={sheet === 'react' ? [] : items}
      />
      <Modal
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        hideClose
        scroll={false}
        bodyStyle={tw`px-0 py-0`}
      >
        <EmojiPanel
          height={360}
          onPick={(e) => {
            setEmojiOpen(false);
            react(e === m.myReaction ? null : e);
          }}
        />
      </Modal>
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
    </View>
  );
});

function Reactions({ m, canReact, onPress }) {
  const { tw, c, shadow } = useTheme();
  if (!m.reactions.length || m.deletedAt) return null;
  const total = m.reactions.reduce((n, r) => n + r.count, 0);
  const top = [...m.reactions].sort((a, b) => b.count - a.count).slice(0, 4);
  return (
    <Press
      disabled={!canReact}
      feedback={false}
      onPress={onPress}
      accessibilityLabel={`${total} reactions${m.myReaction ? `, you reacted ${m.myReaction}` : ''}`}
      style={[
        tw`z-10 -mt-1.5 ml-2 h-7 flex-row items-center gap-1 rounded-full border px-2`,
        m.myReaction
          ? { backgroundColor: c['brand-soft'], borderColor: alpha(c.brand, 0.5) }
          : { backgroundColor: c.elevated, borderColor: c.line },
        shadow.bubble,
      ]}
    >
      {top.map((r) => (
        <T key={r.emoji} style={{ fontSize: 15, lineHeight: 19 }}>
          {r.emoji}
        </T>
      ))}
      <T style={[tw`ml-0.5 text-[12px] font-medium text-muted`, { fontVariant: ['tabular-nums'] }]}>
        {total}
      </T>
    </Press>
  );
}

function PostMedia({ m, maxWidth, onOpen }) {
  const { tw } = useTheme();
  const media = m.media;
  if (!media) return null;
  if (m.type === 'image' || m.type === 'video') {
    return <MediaBody m={m} onOpen={onOpen} radius={0} maxWidth={maxWidth} />;
  }
  if (m.type === 'voice')
    return (
      <View style={tw`px-3 pt-3`}>
        <VoiceBody m={m} mine={false} width={maxWidth - 24} />
      </View>
    );
  if (m.type === 'audio')
    return (
      <View style={tw`px-3 pt-3`}>
        <AudioFileBody m={m} mine={false} width={maxWidth - 24} />
      </View>
    );
  if (m.type === 'file')
    return (
      <View style={tw`p-1.5`}>
        <FileBody m={m} mine={false} width={maxWidth - 12} />
      </View>
    );
  return null;
}

function PollView({ m, canVote }) {
  const { tw, c } = useTheme();
  const poll = m.poll;
  const mine = new Set(poll.myOptionIds ?? []);
  const max = Math.max(1, ...poll.options.map((o) => o.voteCount));
  const vote = (id) => {
    let next;
    if (poll.allowMultiple) next = mine.has(id) ? [...mine].filter((x) => x !== id) : [...mine, id];
    else next = mine.has(id) ? [] : [id];
    void voteInPoll(m, next).catch((e) => toast.error(e));
  };
  return (
    <View style={[tw`px-3 pt-3`, { minWidth: 260 }]} accessibilityLabel={`Poll: ${poll.question}`}>
      <T style={tw`text-[15.5px] font-semibold leading-snug`}>{poll.question}</T>
      <T style={tw`mt-0.5 text-[12px] text-muted`}>
        {poll.allowMultiple ? 'Select one or more' : 'Select one'}
      </T>
      <View style={tw`mt-2 gap-2`}>
        {poll.options.map((o) => {
          const selected = mine.has(o.id);
          return (
            <Press
              key={o.id}
              disabled={!canVote || !!m.deletedAt}
              onPress={() => vote(o.id)}
              feedback={false}
              accessibilityRole={poll.allowMultiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${o.text}, ${o.voteCount} ${o.voteCount === 1 ? 'vote' : 'votes'}`}
              style={tw`flex-row items-start gap-2.5 rounded-lg py-1`}
            >
              <View
                style={[
                  tw`mt-0.5 size-5 items-center justify-center border-2`,
                  poll.allowMultiple ? tw`rounded-md` : tw`rounded-full`,
                  selected
                    ? { borderColor: c.brand, backgroundColor: c.brand }
                    : { borderColor: c['line-strong'] },
                ]}
              >
                {selected ? (
                  <Icon
                    icon={Check}
                    size={12}
                    strokeWidth={ICON_STROKE_BOLD}
                    color={c['on-brand']}
                  />
                ) : null}
              </View>
              <View style={tw`min-w-0 flex-1`}>
                <View style={tw`flex-row items-baseline justify-between gap-2`}>
                  <T style={tw`shrink text-[14.5px]`}>{o.text}</T>
                  <T
                    style={[
                      tw`text-[12.5px] font-medium text-muted`,
                      { fontVariant: ['tabular-nums'] },
                    ]}
                  >
                    {o.voteCount}
                  </T>
                </View>
                <View style={tw`mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2`}>
                  <View
                    style={[
                      tw`h-full rounded-full`,
                      {
                        width: `${o.voteCount ? Math.max(4, (o.voteCount / max) * 100) : 0}%`,
                        backgroundColor: selected ? c.brand : alpha(c.brand, 0.4),
                      },
                    ]}
                  />
                </View>
              </View>
            </Press>
          );
        })}
      </View>
      <T style={tw`mt-2 text-center text-[12.5px] text-muted`}>
        {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
      </T>
    </View>
  );
}
