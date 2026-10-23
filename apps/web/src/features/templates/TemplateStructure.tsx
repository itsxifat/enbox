/**
 * What a template builds: its channels by category (uncategorised first, sidebar order) and
 * its roles (highest first, colour dots). Shared by Space Settings ▸ Space Template and the
 * /template/:code page.
 */
import { Hash, Megaphone, MessagesSquare, Podcast, Volume2, type LucideIcon } from 'lucide-react';
import type { SpaceTemplateSnapshot, TemplateChannel } from '@enbox/shared';

const ICONS: Record<TemplateChannel['type'], LucideIcon> = {
  space_text: Hash,
  space_voice: Volume2,
  space_forum: MessagesSquare,
  space_stage: Podcast,
};

function ChannelLine({ c }: { c: TemplateChannel }) {
  const Icon = c.type === 'space_text' && c.isNews ? Megaphone : ICONS[c.type];
  return (
    <li className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[14px] text-muted">
      <Icon size={16} className="shrink-0 opacity-80" aria-hidden />
      <span className="truncate">{c.name}</span>
    </li>
  );
}

export function TemplateStructure({ snapshot }: { snapshot: SpaceTemplateSnapshot }) {
  const top = snapshot.channels.filter((c) => c.category === null);
  const roles = snapshot.roles.filter((r) => !r.isDefault).reverse();
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="template-structure">
      <section className="card-inset p-3" aria-label="Channels">
        <h3 className="section-label mb-2 px-2">Channels</h3>
        {top.length ? (
          <ul className="mb-2">
            {top.map((c, i) => (
              <ChannelLine key={`t${i}`} c={c} />
            ))}
          </ul>
        ) : null}
        {snapshot.categories.map((cat, index) => (
          <div key={`${index}:${cat.name}`} className="mb-2">
            <p className="px-2 pt-1 text-[12px] font-bold tracking-wide text-subtle uppercase">
              {cat.name}
            </p>
            <ul>
              {snapshot.channels
                .filter((c) => c.category === index)
                .map((c, i) => (
                  <ChannelLine key={`${index}:${i}`} c={c} />
                ))}
            </ul>
          </div>
        ))}
        {snapshot.channels.length === 0 ? (
          <p className="px-2 text-[14px] text-muted">No channels</p>
        ) : null}
      </section>
      <section className="card-inset p-3" aria-label="Roles">
        <h3 className="section-label mb-2 px-2">Roles</h3>
        <ul>
          {roles.map((r, i) => (
            <li
              key={`${i}:${r.name}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-[14px]"
            >
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full bg-line-strong"
                style={r.color ? { backgroundColor: r.color } : undefined}
              />
              <span className="truncate">{r.name}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 rounded-md px-2 py-1 text-[14px] text-muted">
            <span aria-hidden className="size-3 shrink-0 rounded-full bg-line-strong" />
            @everyone
          </li>
        </ul>
      </section>
    </div>
  );
}
