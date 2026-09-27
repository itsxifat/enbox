import { StatusBar } from 'expo-status-bar';
import { StatusViewer } from '@/features/status/StatusViewer';

export default function StatusViewerScreen() {
  return (
    <>
      <StatusBar style="light" />
      <StatusViewer />
    </>
  );
}
