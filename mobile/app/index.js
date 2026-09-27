import { Redirect } from 'expo-router';
import { useAuth } from '@/stores/auth';

export default function Index() {
  const authed = useAuth((s) => s.status === 'authenticated');
  return <Redirect href={authed ? '/chats' : '/login'} />;
}
