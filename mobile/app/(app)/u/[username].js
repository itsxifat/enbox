/** /u/:username — full profile (web features/contacts/UserProfilePage.tsx). */
import { useLocalSearchParams } from 'expo-router';
import { UserProfile } from '@/features/contacts/UserProfile';

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams();
  return <UserProfile username={typeof username === 'string' ? username : ''} />;
}
