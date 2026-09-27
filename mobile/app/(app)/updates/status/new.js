import { StatusBar } from 'expo-status-bar';
import { StatusComposer } from '@/features/status/StatusComposer';

export default function StatusComposerScreen() {
  return (
    <>
      <StatusBar style="light" />
      <StatusComposer />
    </>
  );
}
