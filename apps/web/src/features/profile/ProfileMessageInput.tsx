import { useState } from 'react';
import type { UserPublic } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { useDirectActions } from './useDirectActions';

/**
 * "Message @name" at the foot of the popout: Enter opens (creates) our direct chat, sends
 * the text there and goes to it; Enter on an empty field just opens the chat.
 */
export function ProfileMessageInput({
  user,
  name,
  onNavigate,
  className,
}: {
  user: UserPublic;
  name: string;
  onNavigate?: () => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const { busy, message } = useDirectActions(user, onNavigate);
  const label = `Message @${name}`;
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        void message(text).then((ok) => ok && setText(''));
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={label}
        aria-label={label}
        enterKeyHint="send"
        autoComplete="off"
        disabled={busy === 'message'}
        data-testid="card-message-input"
        className={cn(
          'h-10 w-full rounded-lg bg-surface-2 px-3 text-[14px] text-fg outline-none placeholder:text-subtle',
          'focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60',
        )}
      />
    </form>
  );
}
