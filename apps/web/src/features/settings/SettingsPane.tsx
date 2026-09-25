/**
 * PLACEHOLDER (agent 1 owns this file): Settings tab list (/settings).
 */
import { useParams } from 'react-router';
import { ChevronRight, LogOut } from 'lucide-react';
import { Avatar, ListItem, confirm } from '@/components/ui';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { useAuth, useMe } from '@/stores/auth';
import { SETTINGS_SECTIONS } from './sections';

export function SettingsPane() {
  const me = useMe();
  const { section } = useParams();
  const logout = async () => {
    if (
      await confirm({
        title: 'Log out of Enbox?',
        message: 'You can log back in any time.',
        confirmLabel: 'Log out',
        danger: true,
      })
    ) {
      await useAuth.getState().logout();
    }
  };
  return (
    <>
      <PaneHeader title="Settings" large />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        {me ? (
          <ListItem
            to="/settings/profile"
            active={section === 'profile'}
            leading={
              <Avatar src={me.avatarUrl} name={me.displayName} colorSeed={me.id} size="xl" />
            }
            title={<span className="text-[18px]">{me.displayName}</span>}
            subtitle={me.about}
            end={<ChevronRight size={18} className="text-subtle" aria-hidden />}
          />
        ) : null}
        <div className="h-2" />
        {SETTINGS_SECTIONS.filter((s) => s.id !== 'profile').map((s) => (
          <ListItem
            key={s.id}
            to={`/settings/${s.id}`}
            active={section === s.id}
            divider={false}
            leading={<s.icon size={22} className="mx-3 text-muted" aria-hidden />}
            title={s.title}
            subtitle={s.description}
          />
        ))}
        <ListItem
          onClick={() => void logout()}
          divider={false}
          leading={<LogOut size={22} className="mx-3 text-danger" aria-hidden />}
          title={<span className="text-danger">Log out</span>}
        />
      </div>
    </>
  );
}
