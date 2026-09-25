/**
 * Renders message text: highlighted, tappable @mentions, links (open in a new tab),
 * *bold* _italic_ ~strike~ ```mono``` and in-chat search highlights.
 */
import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquareText } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { Menu } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useUserName } from '@/stores/users';
import { openDirectChat } from '../actions';
import { parseRichText, splitHighlight, type Inline } from '../lib/richText';

function Mention({ userId }: { userId: ID }) {
  const me = useAuth((s) => s.user?.id);
  const name = useUserName(userId, { you: useAuth.getState().user?.displayName ?? 'You' });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  if (userId === me) return <span className="font-medium text-brand-ink">@{name}</span>;
  return (
    <>
      <button
        type="button"
        className="rounded font-medium text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
      >
        @{name}
      </button>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        aria-label={`Actions for ${name}`}
        items={[
          {
            label: `Message ${name}`,
            icon: MessageSquareText,
            onSelect: () =>
              void openDirectChat(userId).then((id) => {
                if (id) navigate(`/chats/${id}`);
              }),
          },
        ]}
      />
    </>
  );
}

function Text({ text, highlight }: { text: string; highlight?: string | null }) {
  if (!highlight) return <>{text}</>;
  const parts = splitHighlight(text, highlight);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-warning/35 text-inherit">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Segments({ segments, highlight }: { segments: Inline[]; highlight?: string | null }) {
  return (
    <>
      {segments.map((s, i) => {
        switch (s.t) {
          case 'text':
            return <Text key={i} text={s.text} highlight={highlight} />;
          case 'link':
            return (
              <a
                key={i}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="break-all text-brand-ink underline decoration-brand-ink/40 underline-offset-2 hover:decoration-brand-ink"
              >
                <Text text={s.text} highlight={highlight} />
              </a>
            );
          case 'mention':
            return <Mention key={i} userId={s.userId} />;
          case 'bold':
            return (
              <strong key={i} className="font-semibold">
                <Segments segments={s.children} highlight={highlight} />
              </strong>
            );
          case 'italic':
            return (
              <em key={i}>
                <Segments segments={s.children} highlight={highlight} />
              </em>
            );
          case 'strike':
            return (
              <s key={i}>
                <Segments segments={s.children} highlight={highlight} />
              </s>
            );
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-black/5 px-1 font-mono text-[0.92em] dark:bg-white/10"
              >
                <Segments segments={s.children} highlight={highlight} />
              </code>
            );
        }
      })}
    </>
  );
}

export const RichText = memo(function RichText({
  text,
  highlight,
}: {
  text: string;
  highlight?: string | null;
}) {
  const segments = useMemo(() => parseRichText(text), [text]);
  return <Segments segments={segments} highlight={highlight} />;
});
