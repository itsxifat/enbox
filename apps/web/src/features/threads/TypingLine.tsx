/**
 * Discord's typing line under a conversation: "Alice is typing…", "Alice and Bob are typing…",
 * "Several people are typing…", from the chat's typing state (`useTypingUsers(chatId)`, fed
 * by `chat:typing` for any chat id — the thread panel passes the thread's). Names follow the
 * Space's nicknames. Renders nothing while nobody types.
 */
import type { ReactNode } from 'react';
import type { ID } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { useTypingUsers } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { nameOf } from '@/stores/users';

/** The line's words around the (bold) names; more than three typers read "Several people". */
export function typingParts(
  names: readonly string[],
  recording = false,
): { names: string[]; joiners: string[]; tail: string } | null {
  if (!names.length) return null;
  const verb = recording ? 'recording audio…' : 'typing…';
  if (names.length > 3) return { names: [], joiners: [], tail: `Several people are ${verb}` };
  const joiners = names.length === 1 ? [] : names.length === 2 ? [' and '] : [', ', ' and '];
  return { names: [...names], joiners, tail: ` ${names.length === 1 ? 'is' : 'are'} ${verb}` };
}

/** Plain text of the line (tests, titles). */
export function typingText(names: readonly string[], recording = false): string {
  const p = typingParts(names, recording);
  if (!p) return '';
  return p.names.map((n, i) => (i ? p.joiners[i - 1] : '') + n).join('') + p.tail;
}

function displayName(id: ID, spaceId: ID | null | undefined): string {
  const nick = spaceId ? useSpaces.getState().members[spaceId]?.[id]?.nickname : null;
  return nick || nameOf(id);
}

export function TypingLine({
  chatId,
  spaceId,
  className,
}: {
  chatId: ID;
  /** Names come from this Space's nicknames. */
  spaceId?: ID | null;
  className?: string;
}) {
  const typing = useTypingUsers(chatId);
  const entries = Object.entries(typing);
  const parts = typingParts(
    entries.map(([id]) => displayName(id, spaceId)),
    entries.length > 0 && entries.every(([, t]) => t.state === 'recording'),
  );
  if (!parts) return null;
  const line: ReactNode[] = [];
  parts.names.forEach((n, i) => {
    if (i) line.push(parts.joiners[i - 1]);
    line.push(
      <strong key={`n${i}`} className="font-semibold text-fg">
        {n}
      </strong>,
    );
  });
  return (
    <div
      className={cn('flex h-5 items-center gap-1.5 px-4 text-[12.5px] text-muted', className)}
      data-testid="typing-line"
    >
      <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="min-w-0 truncate">
        {line}
        {parts.tail}
      </span>
    </div>
  );
}
