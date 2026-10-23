/**
 * App-wide notification surfaces, mounted once in AppShell: the "enable desktop notifications"
 * bar, the in-app message banners (top right) and the Remind Me custom time picker. Due
 * reminders are toasts (./reminderToast.ts).
 */
import { ReminderDialogHost } from '@/features/bookmarks/ReminderDialog';
import { MessageBanners } from './MessageBanners';
import { PermissionBanner } from './PermissionBanner';

export function NotificationsHost() {
  return (
    <>
      <PermissionBanner />
      <MessageBanners />
      <ReminderDialogHost />
    </>
  );
}
