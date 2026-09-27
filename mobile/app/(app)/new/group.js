/** /new/group — create a group, then open it (web features/groups/NewGroupPane.tsx). */
import { useRouter } from 'expo-router';
import { GroupCreateFlow } from '@/features/groups/GroupCreateFlow';

export default function NewGroupScreen() {
  const router = useRouter();
  return (
    <GroupCreateFlow
      onCancel={() => (router.canGoBack() ? router.back() : router.replace('/new'))}
      onCreated={(chat) => router.replace(`/chats/${chat.id}`)}
    />
  );
}
