import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';
import { IconProvider } from './components/icons';
import { router } from './app/router';
import { installAudioUnlock } from './lib/notify';
import { registerServiceWorker } from './lib/sw';
import { bindRealtimeToAuth } from './realtime';
import { initAuthTabSync, useAuth } from './stores/auth';
import { initTheme } from './stores/ui';

initTheme();
installAudioUnlock();
initAuthTabSync();
bindRealtimeToAuth();
void useAuth.getState().bootstrap();
void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconProvider>
      <RouterProvider router={router} />
    </IconProvider>
  </StrictMode>,
);
