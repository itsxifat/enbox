import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const TemplatePreviewPage = lazyNamed(() => import('./TemplatePreviewPage'), 'TemplatePreviewPage');

const detail: RouteHandle = { detail: true };

/** /template/:code: build a new Space from a template. */
export const templatesRoutes: RouteObject[] = [
  {
    path: 'template/:code',
    handle: detail,
    element: (
      <FullView>
        <TemplatePreviewPage />
      </FullView>
    ),
  },
];
