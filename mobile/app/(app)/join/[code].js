/** /join/:code — invite landing (web features/invites/JoinInvitePage.tsx). */
import { useLocalSearchParams } from 'expo-router';
import { JoinInvite } from '@/features/invites/JoinInvite';

export default function JoinInviteScreen() {
  const { code } = useLocalSearchParams();
  return <JoinInvite code={typeof code === 'string' ? code : ''} />;
}
