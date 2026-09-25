/** Plain text with clickable links (descriptions). */
import { linkify } from './links';

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className ?? 'break-words whitespace-pre-wrap'}>
      {linkify(text).map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-ink underline-offset-2 hover:underline"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
