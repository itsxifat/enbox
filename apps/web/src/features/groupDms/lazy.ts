/** The group DM picker and member list load when first opened (render under <Suspense>). */
import { lazyNamed } from '@/lib/lazy';

export const SelectFriendsPopover = lazyNamed(
  () => import('./SelectFriendsPopover'),
  'SelectFriendsPopover',
);
export const GroupDmMembersSheet = lazyNamed(
  () => import('./GroupDmMembers'),
  'GroupDmMembersSheet',
);
