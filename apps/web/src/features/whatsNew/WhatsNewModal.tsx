import { Button, Modal } from '@/components/ui';
import { CHANGELOG } from './changelog';
import { closeWhatsNew, useWhatsNew } from './store';

/** "October 23, 2026" for a YYYY-MM-DD date (local, so no timezone moves it a day). */
export function changelogDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * What's New: every changelog entry, newest first; the ones since my last visit (when it
 * opened on its own after an update) carry a NEW tag.
 */
export function WhatsNewModal() {
  const since = useWhatsNew((s) => s.since);
  return (
    <Modal
      open
      onClose={closeWhatsNew}
      title="What’s New"
      description="The latest changes to Enbox."
      size="lg"
      footer={<Button onClick={closeWhatsNew}>Got it</Button>}
    >
      <ol className="flex flex-col gap-6 pb-2" data-testid="whats-new">
        {CHANGELOG.map((entry) => {
          const fresh = since !== null && entry.version > since;
          const titleId = `whats-new-${entry.version}`;
          return (
            <li key={entry.version} aria-labelledby={titleId} data-testid="whats-new-entry">
              <p className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-subtle uppercase">
                <time dateTime={entry.date}>{changelogDate(entry.date)}</time>
                {fresh ? (
                  <span className="rounded bg-brand px-1.5 text-[10px] leading-4 font-bold text-on-brand">NEW</span>
                ) : null}
              </p>
              <h3 id={titleId} className="mt-1 text-[17px] leading-snug font-bold text-fg">
                {entry.title}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {entry.items.map((item) => (
                  <li key={item.title} className="flex gap-2.5 text-[14px] leading-relaxed text-muted">
                    <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand" />
                    <span>
                      <span className="font-semibold text-fg">{item.title}.</span> {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
