/**
 * The desktop User Settings nav (Discord's layout) over the existing sections: USER SETTINGS,
 * APP SETTINGS, then an untitled block with Help and the red Log Out. Keybinds is an action
 * (the shortcuts list), not a page. The search box filters items by label and keywords.
 */
import { SETTINGS_SECTIONS, type SettingsNavGroupId } from '../sections';

export type SettingsNavAction = 'keybinds' | 'logout';

export interface SettingsNavItem {
  /** The section id, or the action. */
  key: string;
  label: string;
  /** Matched by the search besides the label. */
  keywords: readonly string[];
  /** Sections: their route. */
  to?: string;
  /** Not a page: open the shortcuts list, or log out. */
  action?: SettingsNavAction;
  danger?: boolean;
}

export interface SettingsNavGroup {
  id: SettingsNavGroupId;
  /** Uppercase header; null for the last block. */
  title: string | null;
  items: SettingsNavItem[];
}

const KEYBINDS: SettingsNavItem = {
  key: 'keybinds',
  label: 'Keybinds',
  keywords: ['keyboard shortcuts', 'hotkeys', 'keys'],
  action: 'keybinds',
};

const LOGOUT: SettingsNavItem = {
  key: 'logout',
  label: 'Log Out',
  keywords: ['sign out', 'logout'],
  action: 'logout',
  danger: true,
};

/** Nav order per block; a section missing here lands at the end of its group. */
const ORDER: Record<SettingsNavGroupId, readonly string[]> = {
  user: ['account', 'profile', 'privacy', 'devices'],
  app: ['chats', 'accessibility', 'voice', 'notifications', KEYBINDS.key, 'storage'],
  more: ['help', LOGOUT.key],
};

const TITLES: Record<SettingsNavGroupId, string | null> = {
  user: 'User Settings',
  app: 'App Settings',
  more: null,
};

const GROUP_IDS: readonly SettingsNavGroupId[] = ['user', 'app', 'more'];

function buildNav(): SettingsNavGroup[] {
  const extras: Record<string, SettingsNavItem> = {
    [KEYBINDS.key]: KEYBINDS,
    [LOGOUT.key]: LOGOUT,
  };
  return GROUP_IDS.map((id) => {
    const sections = SETTINGS_SECTIONS.filter((s) => s.group === id);
    const rank = (key: string) => {
      const i = ORDER[id].indexOf(key);
      return i < 0 ? ORDER[id].length : i;
    };
    const items: SettingsNavItem[] = [
      ...sections.map((s) => ({
        key: s.id,
        label: s.navTitle ?? s.title,
        keywords: [s.title, s.description, ...s.keywords],
        to: `/settings/${s.id}`,
      })),
      ...ORDER[id].filter((k) => extras[k]).map((k) => extras[k]!),
    ];
    // Stable: unlisted sections keep their registry order at the end.
    items.sort((a, b) => rank(a.key) - rank(b.key));
    return { id, title: TITLES[id], items };
  });
}

export const SETTINGS_NAV: readonly SettingsNavGroup[] = buildNav();

/** Lowercase, accents and curly apostrophes folded ("Café’s" → "cafe's"). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[‘’]/g, "'").toLowerCase();
}

/** Whether every word of `query` occurs in the item's label or keywords. */
export function matchesSettingsItem(item: SettingsNavItem, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold([item.label, ...item.keywords].join(' \n '));
  return words.every((w) => haystack.includes(w));
}

/** The nav with only the items matching `query` (groups left empty disappear). */
export function filterSettingsNav(
  query: string,
  groups: readonly SettingsNavGroup[] = SETTINGS_NAV,
): SettingsNavGroup[] {
  if (!query.trim()) return [...groups];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((item) => matchesSettingsItem(item, query)) }))
    .filter((g) => g.items.length > 0);
}
