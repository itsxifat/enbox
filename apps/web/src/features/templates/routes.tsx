import type { RouteObject } from 'react-router';
import { lazyNamed } from '@/lib/lazy';

const TemplatePreviewPage = lazyNamed(() => import('./TemplatePreviewPage'), 'TemplatePreviewPage');

/** /template/:code: build a new Space from a template. */
export const templatesRoutes: RouteObject[] = [
  { path: 'template/:code', element: <TemplatePreviewPage /> },
];
