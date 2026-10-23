/**
 * The phone You tab (Discord mobile): my profile card — availability ("Set Status"), custom
 * status and Edit Profile live on it — then Friends, Collectibles, Updates and Calls (no tabs
 * of their own on phones) and Settings. Desktop has no You tab: /you goes Home there.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ChevronRight, Settings, Sparkles, Users } from 'lucide-react';
import { CallsIcon, UpdatesIcon } from '@/components/icons';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  tabBadgeText,
  useTabBadges,
  type BadgeKey,
  type TabBadge,
} from '@/components/layout/useTabBadges';
import { Badge, IconButton, type IconType } from '@/components/ui';
import { PresenceNoteDialog, ProfileCard, selfCardUser } from '@/features/profile';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useMe } from '@/stores/auth';

interface RowDef {
  to: string;
  icon: IconType;
  label: string;
  /** Which badge (if any) the row shows. */
  badge?: BadgeKey;
}

const GROUPS: RowDef[][] = [
  [
    { to: '/you/friends', icon: Users, label: 'Friends', badge: 'friends' },
    { to: '/collectibles', icon: Sparkles, label: 'Collectibles' },
  ],
  [
    { to: '/updates', icon: UpdatesIcon, label: 'Updates', badge: 'updates' },
    { to: '/calls', icon: CallsIcon, label: 'Calls', badge: 'calls' },
  ],
  [{ to: '/settings', icon: Settings, label: 'Settings' }],
];

function RowBadge({ id, badge }: { id: BadgeKey; badge: TabBadge | undefined }) {
  const label = tabBadgeText(id, badge) ?? undefined;
  if (badge?.count) return <Badge count={badge.count} size="sm" tone="danger" label={label} />;
  if (badge?.dot) return <Badge dot tone="danger" label={label} />;
  return null;
}

function Row({ row, badge }: { row: RowDef; badge: TabBadge | undefined }) {
  const Icon = row.icon;
  return (
    <li>
      {/* In-app state: the page's Back arrow comes back here. */}
      <Link
        to={row.to}
        state={IN_APP_NAV}
        className="flex min-h-13 items-center gap-4 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        data-testid={`you-row-${row.label.toLowerCase()}`}
      >
        <Icon size={22} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[16px] text-fg">{row.label}</span>
        {row.badge ? <RowBadge id={row.badge} badge={badge} /> : null}
        <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

export function YouPage() {
  const me = useMe();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const badges = useTabBadges();
  const [noteOpen, setNoteOpen] = useState(false);
  if (desktop) return <Navigate to="/chats" replace />;
  if (!me) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="you-page">
      <PaneHeader
        title="You"
        large
        actions={
          <IconButton
            icon={Settings}
            label="Settings"
            onClick={() => void navigate('/settings', { state: IN_APP_NAV })}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-3 pt-1 pb-6">
          <ProfileCard
            user={selfCardUser(me)}
            self
            onSetStatus={() => setNoteOpen(true)}
            className="w-full rounded-2xl"
          />
          {GROUPS.map((rows) => (
            <ul key={rows[0]!.to} className="card-inset flex flex-col p-1">
              {rows.map((r) => (
                <Row key={r.to} row={r} badge={r.badge ? badges[r.badge] : undefined} />
              ))}
            </ul>
          ))}
        </div>
      </div>
      <PresenceNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} />
    </div>
  );
}
