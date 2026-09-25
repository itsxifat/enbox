/**
 * My status updates (/updates/status/mine): every live status of mine with its time and
 * view count; open one in the viewer, delete, or add another.
 */
import { useNavigate } from 'react-router';
import { Camera, Eye, Pencil, Trash2 } from 'lucide-react';
import type { Status } from '@enbox/shared';
import { UpdatesIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, IconButton, ListSection, confirm, toast } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useStatus, useStatusLists } from '@/stores/status';
import { useMediaPicker } from './StatusSection';
import { StatusThumb } from './StatusRing';

async function remove(status: Status) {
  const ok = await confirm({
    title: 'Delete this status update?',
    message: 'It will also be deleted for everyone who received it.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await useStatus.getState().deleteStatus(status.id);
    toast.success('Status deleted');
  } catch (e) {
    toast.error(e);
  }
}

export function MyStatusPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const me = useMe();
  const { mine } = useStatusLists();
  const picker = useMediaPicker();
  const newest = [...mine].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="my-status-pane">
      <PaneHeader
        title="My status"
        subtitle={mine.length ? `${mine.length} update${mine.length === 1 ? '' : 's'}` : undefined}
        back={desktop ? undefined : '/updates'}
        border
        actions={
          <>
            <IconButton
              icon={Pencil}
              label="New text status"
              onClick={() => navigate('/updates/status/new')}
            />
            <IconButton icon={Camera} label="New photo or video status" onClick={picker.open} />
          </>
        }
      />
      {picker.element}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6 scrollbar-thin">
        <div className="mx-auto max-w-2xl">
          {newest.length === 0 ? (
            <EmptyState
              icon={UpdatesIcon}
              title="No status updates"
              description="Share text, photos and videos with your contacts. They disappear after 24 hours."
            />
          ) : (
            <ListSection title="Your updates">
              {newest.map((s) => (
                <div
                  key={s.id}
                  className="group/li flex items-center gap-3 px-3 hover:bg-hover lg:px-3.5"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={() =>
                      me && navigate(`/updates/status/${me.id}`, { state: { startId: s.id } })
                    }
                    aria-label={`Open status from ${formatRelativeShort(s.createdAt)}`}
                  >
                    <span className="size-12 shrink-0 overflow-hidden rounded-full ring-2 ring-line-strong ring-offset-2 ring-offset-surface">
                      <StatusThumb status={s} size={48} />
                    </span>
                    <span className="min-w-0 flex-1 border-b border-line py-2 group-last/li:border-transparent">
                      <span className="block truncate text-[15.5px] font-medium text-fg">
                        {s.type === 'text'
                          ? s.text
                          : s.text || (s.type === 'image' ? 'Photo' : 'Video')}
                      </span>
                      <span className="flex items-center gap-2 text-[13.5px] text-muted">
                        {formatRelativeShort(s.createdAt)}
                        <span
                          className="inline-flex items-center gap-1"
                          aria-label={`${s.viewCount ?? 0} views`}
                        >
                          <Eye size={14} aria-hidden /> {s.viewCount ?? 0}
                        </span>
                      </span>
                    </span>
                  </button>
                  <IconButton icon={Trash2} label="Delete status" onClick={() => void remove(s)} />
                </div>
              ))}
            </ListSection>
          )}
          <p className="px-6 pt-4 text-center text-[12.5px] text-subtle">
            Your status updates disappear after 24 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
