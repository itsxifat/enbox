import { useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import { userDisplayName } from '@enbox/shared';
import { StyledName } from '@/components/cosmetics';
import { DecorationPreview, NameplateRow } from '@/features/collectibles/previews';
import type { ProfileCardUser } from '@/features/profile/model';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';

/**
 * The editor's live preview, fed by the draft: my profile card (its effect on loop), a chat
 * message (decorated avatar, name in its font) and a member-list row with the
 * nameplate behind it. Wide editors keep it sticky on the right; narrow ones (phones) show it
 * as a collapsible card above the form.
 */
export function PreviewPanel({ user }: { user: ProfileCardUser }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-preview-body"
        onClick={() => setOpen((o) => !o)}
        className="card-inset flex items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand @3xl:hidden"
        data-testid="preview-toggle"
      >
        <Eye size={18} className="shrink-0 text-muted" aria-hidden />
        <span className="flex-1 text-[15px] font-medium text-fg">Preview</span>
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div
        id="profile-preview-body"
        className={cn('flex flex-col gap-4', !open && 'hidden @3xl:flex')}
      >
        <h3 className="section-label hidden @3xl:block">Preview</h3>
        <ProfilePreview user={user} />
      </div>
    </div>
  );
}

export function ProfilePreview({ user }: { user: ProfileCardUser }) {
  const name = userDisplayName(user);
  return (
    <>
      {/* `preview`: no actions, and the card loops the profile effect itself. */}
      <div className="overflow-hidden rounded-2xl shadow-sm" data-testid="profile-preview">
        <ProfileCard user={user} self preview className="rounded-2xl" />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="section-label">Message</h3>
        <div className="card-inset flex items-start gap-3 px-3 py-2.5" data-testid="sample-message">
          <DecorationPreview user={user} id={user.avatarDecoration ?? null} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <StyledName
                name={name}
                style={user.nameStyle}
                mode="font"
                className="truncate text-[14.5px] font-medium text-fg"
              />
              <span className="shrink-0 text-[11.5px] text-muted">
                Today at {formatTime(new Date())}
              </span>
            </div>
            <p className="text-[14.5px] break-words text-fg">Look at my new profile!</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="section-label">Member list</h3>
        <div className="card-inset p-1.5" data-testid="sample-member">
          <NameplateRow
            user={user}
            id={user.nameplate ?? null}
            subtitle={user.pronouns ?? undefined}
          />
        </div>
      </section>
    </>
  );
}
