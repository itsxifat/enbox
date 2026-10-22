/**
 * Chats routes — OWNED BY FEATURE AGENT 2 (chat list + conversation).
 *
 * `conversationChildren` mounts the conversation in the main pane under any list that
 * opens chats (/chats/:chatId, /archived/:chatId, /starred/:chatId). On phones
 * `handle.detail` makes the conversation full screen and hides the bottom tabs.
 * `?m=<seq>&mid=<id>` opens the chat at a message (see links.ts `messageLink`).
 */
import { Navigate, type RouteObject } from 'react-router';
import { SplitView } from '@/components/layout/SplitView';
import type { RouteHandle } from '@/app/routeHandle';
import { lazyNamed } from '@/lib/lazy';
import { ArchivedPane } from './ArchivedPane';
import { ChatListPane } from './ChatListPane';

// The conversation (bubbles, composer, media tooling) is the heaviest screen: code-split it
// so the chat list paints first.
const ConversationPane = lazyNamed(
  () => import('@/features/conversation/ConversationPane'),
  'ConversationPane',
);
const StarredPane = lazyNamed(() => import('./StarredPane'), 'StarredPane');
const FriendsPage = lazyNamed(() => import('@/features/home/FriendsPage'), 'FriendsPage');

const detail: RouteHandle = { detail: true };

export const conversationChildren: RouteObject[] = [
  { path: ':chatId', element: <ConversationPane />, handle: detail },
];

export const chatsRoutes: RouteObject[] = [
  // Desktop: Home's DM sidebar lists the chats; the main pane is Friends until one opens.
  {
    path: 'chats',
    element: <SplitView list={<ChatListPane />} desktopList={false} empty={<FriendsPage />} />,
    children: conversationChildren,
  },
  { path: 'friends', element: <Navigate to="/chats" replace /> },
  {
    path: 'archived',
    element: <SplitView list={<ArchivedPane />} />,
    children: conversationChildren,
  },
  {
    path: 'starred',
    element: <SplitView list={<StarredPane />} />,
    children: conversationChildren,
  },
];
