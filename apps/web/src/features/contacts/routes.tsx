/**
 * Contacts routes — OWNED BY FEATURE AGENT 1.
 *
 *   /new            "New chat" (replaces the list pane; phone: full screen without tabs)
 *   /u/:username    public profile link (shared from Settings → Profile)
 */
import type { RouteObject } from 'react-router';
import { MessageSquarePlus } from 'lucide-react';
import type { RouteHandle } from '@/app/routeHandle';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { FullView, SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const NewChatPane = lazyNamed(() => import('./NewChatPane'), 'NewChatPane');
const UserProfilePage = lazyNamed(() => import('./UserProfilePage'), 'UserProfilePage');

const hideTabs: RouteHandle = { hideTabs: true };
const detail: RouteHandle = { detail: true };

export const contactsRoutes: RouteObject[] = [
  {
    path: 'new',
    element: (
      <SplitView
        list={<NewChatPane />}
        empty={
          <MainEmpty
            icon={MessageSquarePlus}
            title="Start a new chat"
            description="Pick a contact, search anyone by their @username or phone number, or message yourself to keep notes."
          />
        }
      />
    ),
    handle: hideTabs,
  },
  {
    path: 'u/:username',
    element: (
      <FullView>
        <UserProfilePage />
      </FullView>
    ),
    handle: detail,
  },
];
