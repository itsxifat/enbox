/**
 * Space Settings sections and who may open them (the server enforces the same bits). Shared by
 * the settings screen and the Space menus (rail context menu: Space Settings ▸).
 */
import { PERM, hasPerm, type ID, type Space } from '@enbox/shared';

export type SettingsSectionId = 'overview' | 'safety' | 'roles' | 'emoji' | 'members' | 'invites' | 'bans' | 'audit-log';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  show: (space: Space) => boolean;
}

const has = (s: Space, ...perms: number[]) => perms.some((p) => hasPerm(s.myPermissions, p));

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'overview', label: 'Overview', show: (s) => has(s, PERM.MANAGE_SPACE) },
  { id: 'safety', label: 'Safety Setup', show: (s) => has(s, PERM.MANAGE_SPACE) },
  { id: 'roles', label: 'Roles', show: (s) => has(s, PERM.MANAGE_ROLES) },
  { id: 'emoji', label: 'Emoji', show: (s) => has(s, PERM.MANAGE_EMOJI) },
  {
    id: 'members',
    label: 'Members',
    show: (s) =>
      has(s, PERM.KICK_MEMBERS, PERM.BAN_MEMBERS, PERM.MANAGE_ROLES, PERM.MODERATE_MEMBERS, PERM.MANAGE_NICKNAMES),
  },
  { id: 'invites', label: 'Invites', show: (s) => has(s, PERM.CREATE_INVITE) },
  { id: 'bans', label: 'Bans', show: (s) => has(s, PERM.BAN_MEMBERS) },
  { id: 'audit-log', label: 'Audit Log', show: (s) => has(s, PERM.VIEW_AUDIT_LOG) },
];

/** The sections I can open. */
export function visibleSettingsSections(space: Space): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => s.show(space));
}

/** Space Settings appears in the Space menus for managers and moderators (Discord). */
export function canOpenSpaceSettings(space: Space): boolean {
  return has(
    space,
    PERM.MANAGE_SPACE,
    PERM.MANAGE_ROLES,
    PERM.KICK_MEMBERS,
    PERM.BAN_MEMBERS,
    PERM.VIEW_AUDIT_LOG,
    PERM.MODERATE_MEMBERS,
    PERM.MANAGE_NICKNAMES,
    PERM.MANAGE_EMOJI,
  );
}

export const settingsPath = (spaceId: ID, section?: SettingsSectionId) =>
  `/spaces/${spaceId}/settings${section ? `/${section}` : ''}`;
