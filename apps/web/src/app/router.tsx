/**
 * Route tree. Feature folders export their own `RouteObject[]` from `routes.tsx`; this
 * file only composes them — feature agents should not need to edit it.
 *
 *   /login, /register                       features/auth        (agent 1)
 *   /chats[/:chatId], /archived, /starred   features/chats       (agent 2)
 *   /updates[/channels/:chatId]             features/updates → channels (agent 3), status (agent 4)
 *   /spaces[/:spaceId[/:chatId]]            features/spaces (communities became Spaces)
 *   /calls                                  features/calls       (agent 4)
 *   /collectibles                           features/collectibles
 *   /settings[/:section]                    features/settings    (agent 1; a layer on desktop)
 *   /you[/friends], /notifications          features/you         (phone tabs)
 *   /new                                    features/contacts    (agent 1)
 *   /new/group                              features/groups      (agent 3)
 *   /join/:code                             features/invites     (agent 3)
 *   /friend/:code                           features/friends     (friend invite links)
 */
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { authRoutes } from '@/features/auth/routes';
import { callsRoutes } from '@/features/calls/routes';
import { chatsRoutes } from '@/features/chats/routes';
import { collectiblesRoutes } from '@/features/collectibles/routes';
import { contactsRoutes } from '@/features/contacts/routes';
import { discoverRoutes } from '@/features/discover/routes';
import { groupsRoutes } from '@/features/groups/routes';
import { invitesRoutes } from '@/features/invites/routes';
import { friendsRoutes } from '@/features/friends/routes';
import { profileRoutes } from '@/features/profile/routes';
import { previewRoutes } from '@/features/preview/routes';
import { requestsRoutes } from '@/features/requests/routes';
import { settingsRoutes } from '@/features/settings/routes';
import { youRoutes } from '@/features/you/routes';
import { spacesRoutes } from '@/features/spaces/routes';
import { templatesRoutes } from '@/features/templates/routes';
import { updatesRoutes } from '@/features/updates/routes';
import { PublicOnly, RequireAuth } from './guards';
import { RootLayout } from './RootLayout';
import { NotFound, RouteError } from './RouteError';

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { element: <PublicOnly />, children: authRoutes },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            errorElement: <RouteError />,
            children: [
              { index: true, element: <Navigate to="/chats" replace /> },
              ...chatsRoutes,
              ...updatesRoutes,
              ...spacesRoutes,
              ...callsRoutes,
              ...collectiblesRoutes,
              ...settingsRoutes,
              ...youRoutes,
              ...contactsRoutes,
              ...groupsRoutes,
              ...invitesRoutes,
              ...friendsRoutes,
              ...discoverRoutes,
              ...profileRoutes,
              ...requestsRoutes,
              ...templatesRoutes,
              ...previewRoutes,
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
