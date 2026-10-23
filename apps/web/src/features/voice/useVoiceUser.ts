import { userDisplayName } from '@enbox/shared';
import { withSpaceProfile } from '@/features/spaces/serverProfile/merge';
import { useSpaceAuthor } from '@/stores/spaces';
import { useUser } from '@/stores/users';

/** A participant as the Space shows them: nickname, and the per-Space avatar and decoration. */
export function useVoiceUser(spaceId: string, userId: string) {
  const user = useUser(userId);
  const author = useSpaceAuthor(spaceId, userId);
  return {
    name: author?.nickname || userDisplayName(user),
    user: user ? withSpaceProfile(user, author?.profile, author?.nickname) : undefined,
  };
}
