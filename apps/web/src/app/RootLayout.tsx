import { Suspense } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { DialogHost, PageSpinner, Toaster } from '@/components/ui';
import { useBus } from '@/hooks/useBus';

/** Top of the route tree: global hosts (toasts, confirm dialogs) and bus-driven navigation. */
export function RootLayout() {
  const navigate = useNavigate();
  useBus('navigate', ({ to, replace }) => {
    void navigate(to, { replace });
  });
  return (
    <>
      <Suspense fallback={<PageSpinner className="h-dvh" />}>
        <Outlet />
      </Suspense>
      <Toaster />
      <DialogHost />
    </>
  );
}
